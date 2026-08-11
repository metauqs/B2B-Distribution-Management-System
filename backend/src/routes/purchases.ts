import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, syncPriceListFromPurchase, PurchaseItemForSync } from '../lib/business';
import { stockIn, recalcAvgCostFromHistory } from '../lib/inventoryService';
import { parseInputDateToUtc } from '../lib/businessDate';
import { postPurchaseLedger } from '../lib/financialLedgerService';

const router = Router();

// GET /api/purchases
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { limit: limitQuery } = req.query;
    const limit = Math.min(parseInt(String(limitQuery ?? '50')), 200);

    const purchases = await prisma.purchase.findMany({
      where: { ...(branchId ? { branchId } : {}), deletedAt: null },
      include: { supplier: { select: { id: true, name: true } }, items: true },
      orderBy: { date: 'asc' },
      take: limit,
    });

    return res.json({ success: true, data: purchases });
  } catch (err: any) {
    console.error('Error in GET /api/purchases:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load purchases', data: [] });
  }
});

// POST /api/purchases
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || null;

    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { supplierId, items = [], paid = 0, transportCost = 0, notes, date } = req.body;

    if (!supplierId || !items.length) {
      return res.status(400).json({ success: false, error: 'Supplier and items are required' });
    }

    if (!date) return res.status(400).json({ success: false, error: 'Purchase date is required' });

    for (const item of items) {
      if (!item.itemName && !item.name) {
        return res.status(400).json({ success: false, error: 'Product name is required for all items' });
      }
      if (item.qty <= 0) {
        return res.status(400).json({ success: false, error: `Quantity for ${item.itemName ?? item.name} must be greater than zero` });
      }
      if (item.rate <= 0) {
        return res.status(400).json({ success: false, error: `Buy rate for ${item.itemName ?? item.name} must be greater than zero` });
      }
    }

    const mergedItemsMap: Record<string, any> = {};
    for (const item of items) {
      const key = item.productId ? item.productId : (item.itemName ?? item.name).toLowerCase().trim();
      if (mergedItemsMap[key]) {
        const existing = mergedItemsMap[key];
        const totalQty = existing.qty + item.qty;
        const avgRate = ((existing.qty * existing.rate) + (item.qty * item.rate)) / totalQty;
        existing.qty = totalQty;
        existing.rate = avgRate;
      } else {
        mergedItemsMap[key] = { ...item };
      }
    }
    const finalItems = Object.values(mergedItemsMap);

    let finalSupplierId = supplierId;
    let isMandi = supplierId === 'mandi';
    if (supplierId === 'mandi') {
      let mandiSupplier = await prisma.supplier.findFirst({
        where: { name: 'Mandi', branchId, deletedAt: null }
      });
      if (!mandiSupplier) {
        mandiSupplier = await prisma.supplier.create({
          data: { name: 'Mandi', branchId, status: 'ACTIVE' }
        });
      }
      finalSupplierId = mandiSupplier.id;
    } else {
      const selectedSupplier = await prisma.supplier.findUnique({
        where: { id: supplierId }
      });
      if (selectedSupplier && selectedSupplier.name.toLowerCase() === 'mandi') {
        isMandi = true;
      }
    }

    const subtotal = finalItems.reduce((s: number, i: any) => s + i.qty * i.rate, 0);
    const total = subtotal + (transportCost ?? 0);

    if (!isMandi && paid > total) {
      return res.status(400).json({
        success: false,
        error: `Amount paid (Rs ${paid.toLocaleString()}) cannot exceed total purchase amount (Rs ${total.toLocaleString()})`
      });
    }

    const finalPaid = isMandi ? total : paid;
    const balance = total - finalPaid;
    const status = finalPaid >= total ? 'PAID' : finalPaid > 0 ? 'PARTIAL' : 'PENDING';

    const pDate = parseInputDateToUtc(date);

    const purchase = await prisma.$transaction(async tx => {
      const p = await tx.purchase.create({
        data: {
          supplierId: finalSupplierId,
          branchId,
          date: pDate,
          subtotal,
          transportCost: transportCost ?? 0,
          total,
          paid: finalPaid,
          balance,
          status: status as any,
          notes: notes ?? undefined,
          items: {
            create: finalItems.map((i: any) => ({
              productId: i.productId ?? undefined,
              itemName: i.itemName ?? i.name,
              qty: i.qty,
              unit: i.unit ?? 'KG',
              rate: i.rate,
              amount: i.qty * i.rate,
            })),
          },
        },
        include: { items: true, supplier: { select: { id: true, name: true } } },
      });

      await Promise.all(
        finalItems
          .filter((item: any) => item.productId)
          .map((item: any) =>
            stockIn(tx, {
              productId: item.productId,
              branchId,
              qty: item.qty,
              rate: item.rate,
              unit: item.unit ?? 'KG',
              refType: 'purchase',
              refId: p.id,
              purchaseId: p.id,
              supplierId: finalSupplierId,
              userId: userId ?? undefined,
              date: pDate,
            })
          )
      );

      // Post to Financial Ledger automatically
      await postPurchaseLedger(tx, {
        branchId,
        purchaseId: p.id,
        supplierId: finalSupplierId,
        date: p.date,
        subtotal: p.subtotal,
        transportCost: p.transportCost,
        total: p.total,
        paid: p.paid,
      });

      return p;
    }, { maxWait: 15000, timeout: 600000 });

    await writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Purchase', entityId: purchase.id, newData: { supplierId: finalSupplierId, total } });
    return res.status(201).json({ success: true, data: purchase });
  } catch (err: any) {
    console.error('Error in POST /api/purchases:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to save purchase' });
  }
});

// PATCH /api/purchases/:id & PUT /api/purchases/:id
const handleUpdatePurchase = async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || null;
    const { id } = req.params;

    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const existingPurchase = await prisma.purchase.findFirst({
      where: { id, deletedAt: null, branchId },
      include: { items: true }
    });

    if (!existingPurchase) {
      return res.status(404).json({ success: false, error: 'Purchase record not found' });
    }

    const { supplierId, items = [], paid = 0, transportCost = 0, notes, date } = req.body;

    if (!supplierId || !items.length) {
      return res.status(400).json({ success: false, error: 'Supplier and items are required' });
    }

    if (!date) return res.status(400).json({ success: false, error: 'Purchase date is required' });

    for (const item of items) {
      if (!item.itemName && !item.name) {
        return res.status(400).json({ success: false, error: 'Product name is required for all items' });
      }
      if (item.qty <= 0) {
        return res.status(400).json({ success: false, error: `Quantity for ${item.itemName ?? item.name} must be greater than zero` });
      }
      if (item.rate <= 0) {
        return res.status(400).json({ success: false, error: `Buy rate for ${item.itemName ?? item.name} must be greater than zero` });
      }
    }

    const mergedItemsMap: Record<string, any> = {};
    for (const item of items) {
      const key = item.productId ? item.productId : (item.itemName ?? item.name).toLowerCase().trim();
      if (mergedItemsMap[key]) {
        const existing = mergedItemsMap[key];
        const totalQty = existing.qty + item.qty;
        const avgRate = ((existing.qty * existing.rate) + (item.qty * item.rate)) / totalQty;
        existing.qty = totalQty;
        existing.rate = avgRate;
      } else {
        mergedItemsMap[key] = { ...item };
      }
    }
    const finalItems = Object.values(mergedItemsMap);

    let finalSupplierId = supplierId;
    let isMandi = supplierId === 'mandi';
    if (supplierId === 'mandi') {
      let mandiSupplier = await prisma.supplier.findFirst({
        where: { name: 'Mandi', branchId, deletedAt: null }
      });
      if (!mandiSupplier) {
        mandiSupplier = await prisma.supplier.create({
          data: { name: 'Mandi', branchId, status: 'ACTIVE' }
        });
      }
      finalSupplierId = mandiSupplier.id;
    } else {
      const selectedSupplier = await prisma.supplier.findUnique({
        where: { id: supplierId }
      });
      if (selectedSupplier && selectedSupplier.name.toLowerCase() === 'mandi') {
        isMandi = true;
      }
    }

    const subtotal = finalItems.reduce((s: number, i: any) => s + i.qty * i.rate, 0);
    const total = subtotal + (transportCost ?? 0);

    if (!isMandi && paid > total) {
      return res.status(400).json({
        success: false,
        error: `Amount paid (Rs ${paid.toLocaleString()}) cannot exceed total purchase amount (Rs ${total.toLocaleString()})`
      });
    }

    const finalPaid = isMandi ? total : paid;
    const balance = total - finalPaid;
    const status = finalPaid >= total ? 'PAID' : finalPaid > 0 ? 'PARTIAL' : 'PENDING';

    const pDate = parseInputDateToUtc(date);

    const updatedPurchase = await prisma.$transaction(async tx => {
      // 1. Reverse previous stock movements for old purchase items
      //    Revert qty AND remove the price history records so avgCost recalc is clean
      const productIdsToRecalc = new Set<string>();

      for (const oldItem of existingPurchase.items) {
        if (oldItem.productId) {
          productIdsToRecalc.add(oldItem.productId);

          const inv = await tx.inventory.findUnique({
            where: { productId_branchId: { productId: oldItem.productId, branchId } }
          });
          if (inv) {
            const revertedQty = Math.max(0, inv.qty - oldItem.qty);
            await tx.inventory.update({
              where: { id: inv.id },
              data: { qty: revertedQty }
            });
          }

          // Remove StockMovement & PurchasePriceHistory entries for this purchase so stockIn executes cleanly
          await tx.stockMovement.deleteMany({
            where: { refType: 'purchase', refId: id, productId: oldItem.productId }
          });
          await tx.purchasePriceHistory.deleteMany({
            where: { purchaseId: id, productId: oldItem.productId }
          });
        }
      }

      // 2. Remove old purchase items
      await tx.purchaseItem.deleteMany({
        where: { purchaseId: id }
      });

      // 3. Update main Purchase record
      const p = await tx.purchase.update({
        where: { id },
        data: {
          supplierId: finalSupplierId,
          date: pDate,
          subtotal,
          transportCost: transportCost ?? 0,
          total,
          paid: finalPaid,
          balance,
          status: status as any,
          notes: notes ?? undefined,
          items: {
            create: finalItems.map((i: any) => ({
              productId: i.productId ?? undefined,
              itemName: i.itemName ?? i.name,
              qty: i.qty,
              unit: i.unit ?? 'KG',
              rate: i.rate,
              amount: i.qty * i.rate,
            })),
          },
        },
        include: { items: true, supplier: { select: { id: true, name: true } } },
      });

      // 4. Apply new stockIn & update currentBuyPrice + moving average cost
      await Promise.all(
        finalItems
          .filter((item: any) => item.productId)
          .map((item: any) =>
            stockIn(tx, {
              productId: item.productId,
              branchId,
              qty: item.qty,
              rate: item.rate,
              unit: item.unit ?? 'KG',
              refType: 'purchase',
              refId: p.id,
              purchaseId: p.id,
              supplierId: finalSupplierId,
              userId: userId ?? undefined,
              date: pDate,
            })
          )
      );

      // 5. Recalculate avgCost from full history for all affected products
      //    This ensures weighted average is correct even after mid-history edits
      const allProductIds = new Set<string>(
        [...productIdsToRecalc, ...finalItems.filter((i: any) => i.productId).map((i: any) => i.productId)]
      );
      await Promise.all(
        Array.from(allProductIds).map(pid => recalcAvgCostFromHistory(tx, pid, branchId))
      );

      return p;
    }, { maxWait: 15000, timeout: 600000 });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'UPDATE',
      entity: 'Purchase',
      entityId: updatedPurchase.id,
      oldData: { total: existingPurchase.total, supplierId: existingPurchase.supplierId },
      newData: { total: updatedPurchase.total, supplierId: finalSupplierId }
    });

    return res.json({ success: true, data: updatedPurchase });
  } catch (err: any) {
    console.error('Error in PATCH/PUT /api/purchases/:id:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update purchase' });
  }
};

router.patch('/:id', handleUpdatePurchase);
router.put('/:id', handleUpdatePurchase);

// DELETE /api/purchases/:id (Soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch' });
  }

  const { id } = req.params;

  try {
    const purchase = await prisma.purchase.findFirst({
      where: { id, deletedAt: null, branchId },
      include: { items: true }
    });
    if (!purchase) return res.status(404).json({ success: false, error: 'Purchase not found' });

    await prisma.$transaction(async tx => {
      const productIdsToRecalc: string[] = [];

      // Revert stock for deleted items, remove price history, and recalc avgCost
      for (const item of purchase.items) {
        if (item.productId) {
          productIdsToRecalc.push(item.productId);

          const inv = await tx.inventory.findUnique({
            where: { productId_branchId: { productId: item.productId, branchId } }
          });
          if (inv) {
            await tx.inventory.update({
              where: { id: inv.id },
              data: { qty: Math.max(0, inv.qty - item.qty) }
            });
          }

          // Remove price history entries for this purchase so avgCost recalculates correctly
          await tx.purchasePriceHistory.deleteMany({
            where: { purchaseId: id, productId: item.productId }
          });
        }
      }

      await tx.purchase.update({
        where: { id },
        data: { deletedAt: new Date() }
      });

      // Recalculate avgCost from remaining purchase history for all affected products
      await Promise.all(
        productIdsToRecalc.map(pid => recalcAvgCostFromHistory(tx, pid, branchId))
      );
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'DELETE',
      entity: 'Purchase',
      entityId: id,
      oldData: { total: purchase.total }
    });

    return res.json({ success: true, message: 'Purchase deleted successfully' });
  } catch (err: any) {
    console.error('[DELETE /api/purchases/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to delete purchase' });
  }
});

export default router;
