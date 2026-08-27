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
    const limit = limitQuery ? Math.min(parseInt(String(limitQuery)), 500) : 100;

    const purchases = await prisma.purchase.findMany({
      where: { ...(branchId ? { branchId } : {}), deletedAt: null },
      select: {
        id: true,
        date: true,
        total: true,
        paid: true,
        transportCost: true,
        notes: true,
        supplierId: true,
        createdAt: true,
        supplier: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            productId: true,
            itemName: true,
            unit: true,
            qty: true,
            rate: true,
            amount: true,
            product: { select: { id: true, name: true, urduName: true, emoji: true, imageUrl: true } },
          },
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
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

    const numPaid = Number(paid || 0);
    const numTransport = Number(transportCost || 0);
    if (isNaN(numPaid) || !isFinite(numPaid) || numPaid < 0) {
      return res.status(400).json({ success: false, error: 'Paid amount cannot be negative' });
    }
    if (isNaN(numTransport) || !isFinite(numTransport) || numTransport < 0) {
      return res.status(400).json({ success: false, error: 'Transport cost cannot be negative' });
    }

    for (const item of items) {
      if (!item.itemName && !item.name) {
        return res.status(400).json({ success: false, error: 'Product name is required for all items' });
      }
      const itemQty = Number(item.qty);
      const itemRate = Number(item.rate);
      if (isNaN(itemQty) || !isFinite(itemQty) || itemQty <= 0) {
        return res.status(400).json({ success: false, error: `Quantity for ${item.itemName ?? item.name} must be a positive number` });
      }
      if (isNaN(itemRate) || !isFinite(itemRate) || itemRate <= 0) {
        return res.status(400).json({ success: false, error: `Buy rate for ${item.itemName ?? item.name} must be a positive number` });
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

    const numPaid = Number(paid || 0);
    const numTransport = Number(transportCost || 0);
    if (isNaN(numPaid) || !isFinite(numPaid) || numPaid < 0) {
      return res.status(400).json({ success: false, error: 'Paid amount cannot be negative' });
    }
    if (isNaN(numTransport) || !isFinite(numTransport) || numTransport < 0) {
      return res.status(400).json({ success: false, error: 'Transport cost cannot be negative' });
    }

    for (const item of items) {
      if (!item.itemName && !item.name) {
        return res.status(400).json({ success: false, error: 'Product name is required for all items' });
      }
      const itemQty = Number(item.qty);
      const itemRate = Number(item.rate);
      if (isNaN(itemQty) || !isFinite(itemQty) || itemQty <= 0) {
        return res.status(400).json({ success: false, error: `Quantity for ${item.itemName ?? item.name} must be a positive number` });
      }
      if (isNaN(itemRate) || !isFinite(itemRate) || itemRate <= 0) {
        return res.status(400).json({ success: false, error: `Buy rate for ${item.itemName ?? item.name} must be a positive number` });
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
      // 1. Calculate item deltas between old purchase items and new purchase items
      const oldItemsMap = new Map<string, { qty: number; rate: number; itemName: string }>();
      for (const item of existingPurchase.items) {
        if (item.productId) {
          const prev = oldItemsMap.get(item.productId) || { qty: 0, rate: item.rate, itemName: item.itemName };
          oldItemsMap.set(item.productId, { qty: prev.qty + item.qty, rate: item.rate, itemName: item.itemName });
        }
      }

      const newItemsMap = new Map<string, { qty: number; rate: number; unit: string; itemName: string }>();
      for (const item of finalItems) {
        if (item.productId) {
          const prev = newItemsMap.get(item.productId) || { qty: 0, rate: item.rate, unit: item.unit ?? 'KG', itemName: item.itemName ?? item.name };
          newItemsMap.set(item.productId, { qty: prev.qty + item.qty, rate: item.rate, unit: item.unit ?? 'KG', itemName: item.itemName ?? item.name });
        }
      }

      const allAffectedProductIds = new Set<string>([...oldItemsMap.keys(), ...newItemsMap.keys()]);

      for (const pid of allAffectedProductIds) {
        const oldInfo = oldItemsMap.get(pid);
        const newInfo = newItemsMap.get(pid);
        const oldQty = oldInfo?.qty ?? 0;
        const newQty = newInfo?.qty ?? 0;
        const deltaQty = newQty - oldQty;

        // If quantity changed, adjust inventory and create a clean PURCHASE_EDIT delta movement
        if (Math.abs(deltaQty) > 0.0001) {
          const inv = await tx.inventory.findUnique({
            where: { productId_branchId: { productId: pid, branchId } }
          });
          const prevStock = inv?.qty ?? 0;
          const newStock = Math.max(0, prevStock + deltaQty);

          await tx.inventory.upsert({
            where: { productId_branchId: { productId: pid, branchId } },
            update: { qty: newStock },
            create: { productId: pid, branchId, qty: newStock, avgCost: 0 }
          });

          await tx.stockMovement.create({
            data: {
              productId: pid,
              branchId,
              type: deltaQty > 0 ? 'PURCHASE' : 'ADJUSTMENT',
              qty: deltaQty,
              previousStock: prevStock,
              newStock,
              refType: 'purchase_edit',
              refId: id,
              note: `Purchase edit (${id.slice(-6)}): ${deltaQty > 0 ? '+' : ''}${deltaQty} ${newInfo?.unit || 'KG'} (${oldQty} -> ${newQty})`
            }
          });
        }

        // Remove old price history for this purchase and re-record if item exists in new purchase
        await tx.purchasePriceHistory.deleteMany({
          where: { purchaseId: id, productId: pid }
        });

        if (newInfo && newQty > 0) {
          await tx.purchasePriceHistory.create({
            data: {
              productId: pid,
              branchId,
              purchaseId: id,
              supplierId: finalSupplierId,
              date: pDate,
              buyPrice: newInfo.rate,
              qty: newInfo.qty
            }
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

      // 4. Recalculate avgCost from full history for all affected products
      for (const pid of allAffectedProductIds) {
        await recalcAvgCostFromHistory(tx, pid, branchId);
      }

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

          // Create an offsetting movement to reverse the original purchase stock-in
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              branchId,
              type: 'ADJUSTMENT',
              qty: -item.qty,
              note: `Reversal for deleted purchase ${id}`,
              refType: 'purchase_delete',
              refId: id
            }
          });

          // Remove price history entries for this purchase so avgCost recalculates correctly
          await tx.purchasePriceHistory.deleteMany({
            where: { purchaseId: id, productId: item.productId }
          });

          // Also delete the original PURCHASE StockMovements
          await tx.stockMovement.deleteMany({
            where: { refType: 'purchase', refId: id, productId: item.productId }
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
