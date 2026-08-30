import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, syncPriceListFromPurchase, PurchaseItemForSync } from '../lib/business';
import { stockIn, recalcAvgCostFromHistory } from '../lib/inventoryService';
import { parseInputDateToUtc } from '../lib/businessDate';
import { postPurchaseLedger } from '../lib/financialLedgerService';
import { getCachedActiveProducts } from './pricelist';

const router = Router();

// ── In-Memory cache for purchases (20s TTL) ───────────────────────────────
const PURCHASE_CACHE = new Map<string, { ts: number; data: any }>();
const PURCHASE_CACHE_TTL = 120000;
const PURCHASE_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearPurchaseCache(): void {
  PURCHASE_CACHE.clear();
  PURCHASE_IN_FLIGHT.clear();
}

// GET /api/purchases
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { limit: limitQuery, page } = req.query;
    const limit = limitQuery ? Math.min(parseInt(String(limitQuery)), 500) : 100;

    const cacheKey = `${branchId || 'all'}_${limit}_${page || '1'}`;
    const cached = PURCHASE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < PURCHASE_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (PURCHASE_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await PURCHASE_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchPurchasesPromise = (async () => {
      const rawBranchId = branchId || '';
      const [purchases, activeProducts] = await Promise.all([
        prisma.$queryRaw<Array<{
          id: string;
          date: Date;
          subtotal: number;
          total: number;
          paid: number;
          balance: number;
          status: string;
          transportCost: number;
          notes: string | null;
          supplierId: string;
          createdAt: Date;
          supplier: { id: string; name: string } | null;
          items: Array<{
            id: string;
            productId: string | null;
            itemName: string;
            unit: string;
            qty: number;
            rate: number;
            amount: number;
            product?: any;
          }>;
        }>>`
          SELECT 
            p.id,
            p.date,
            p.subtotal::float as subtotal,
            p.total::float as total,
            p.paid::float as paid,
            p.balance::float as balance,
            p.status,
            p."transportCost"::float as "transportCost",
            p.notes,
            p."supplierId",
            p."createdAt",
            CASE WHEN s.id IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name) ELSE NULL END as supplier,
            COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'id', pi.id,
                    'productId', pi."productId",
                    'itemName', pi."itemName",
                    'unit', pi.unit,
                    'qty', pi.qty::float,
                    'rate', pi.rate::float,
                    'amount', pi.amount::float
                  )
                )
                FROM purchase_items pi
                WHERE pi."purchaseId" = p.id
              ),
              '[]'::json
            ) as items
          FROM purchases p
          LEFT JOIN suppliers s ON s.id = p."supplierId"
          WHERE (${rawBranchId} = '' OR p."branchId" = ${rawBranchId})
            AND p."deletedAt" IS NULL
          ORDER BY p.date DESC, p."createdAt" DESC
          LIMIT ${limit}
        `,
        getCachedActiveProducts(),
      ]);

      const productMap = new Map<string, any>();
      for (const p of activeProducts) {
        productMap.set(p.id, {
          id: p.id,
          name: p.name,
          urduName: p.urduName,
          emoji: p.emoji,
          imageUrl: p.imageUrl,
        });
      }

      for (const purchase of purchases) {
        if (Array.isArray(purchase.items)) {
          for (const item of purchase.items) {
            item.product = item.productId ? (productMap.get(item.productId) || null) : null;
          }
        }
      }

      return purchases;
    })();

    PURCHASE_IN_FLIGHT.set(cacheKey, fetchPurchasesPromise);
    try {
      const purchases = await fetchPurchasesPromise;
      if (PURCHASE_CACHE.size > 50) PURCHASE_CACHE.clear();
      PURCHASE_CACHE.set(cacheKey, { ts: Date.now(), data: purchases });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: purchases });
    } finally {
      PURCHASE_IN_FLIGHT.delete(cacheKey);
    }
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
    clearPurchaseCache();
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

    clearPurchaseCache();
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

          await tx.purchasePriceHistory.deleteMany({
            where: { purchaseId: id, productId: item.productId }
          });

          await tx.stockMovement.deleteMany({
            where: { refType: 'purchase', refId: id, productId: item.productId }
          });
        }
      }

      await tx.purchase.update({
        where: { id },
        data: { deletedAt: new Date() }
      });

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

    clearPurchaseCache();
    return res.json({ success: true, message: 'Purchase deleted successfully' });
  } catch (err: any) {
    console.error('[DELETE /api/purchases/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to delete purchase' });
  }
});

export default router;
