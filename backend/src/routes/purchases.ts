import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, syncPriceListFromPurchase, PurchaseItemForSync } from '../lib/business';
import { stockIn } from '../lib/inventoryService';

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

    const pDate = new Date(date);
    pDate.setHours(12, 0, 0, 0);

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
              date: pDate,
            })
          )
      );

      const syncItems: PurchaseItemForSync[] = finalItems.map((i: any) => ({
        productId: i.productId ?? null,
        itemName: i.itemName ?? i.name,
        unit: i.unit ?? 'KG',
        rate: i.rate,
      }));
      await syncPriceListFromPurchase(tx, branchId, userId, pDate, syncItems);

      return p;
    }, { maxWait: 10000, timeout: 30000 });

    await writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Purchase', entityId: purchase.id, newData: { supplierId: finalSupplierId, total } });
    return res.status(201).json({ success: true, data: purchase });
  } catch (err: any) {
    console.error('Error in POST /api/purchases:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to save purchase' });
  }
});

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
      where: { id, deletedAt: null, branchId }
    });
    if (!purchase) return res.status(404).json({ success: false, error: 'Purchase not found' });

    await prisma.purchase.update({
      where: { id },
      data: { deletedAt: new Date() }
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
