import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { recordWastage, manualAdjust } from '../lib/inventoryService';

const router = Router();

// GET /api/inventory
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) ?? undefined;
    const { search } = req.query;

    const where: any = { ...(branchId ? { branchId } : {}) };

    const inventory = await prisma.inventory.findMany({
      where,
      include: { product: { select: { id: true, name: true, urduName: true, category: true, defaultUnit: true, minStock: true, availability: true } } },
      orderBy: { product: { name: 'asc' } },
    });

    const todayStart = new Date(Date.now() - 5 * 60 * 60 * 1000);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const todayMoves = await prisma.stockMovement.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        date: { gte: todayStart, lte: todayEnd },
      },
      select: { type: true, qty: true },
    });

    const todayStockIn = todayMoves.filter(m => m.qty > 0).reduce((s, m) => s + m.qty, 0);
    const todayStockOut = todayMoves.filter(m => m.qty < 0 && m.type !== 'WASTAGE').reduce((s, m) => s + Math.abs(m.qty), 0);
    const todayWastage = todayMoves.filter(m => m.type === 'WASTAGE').reduce((s, m) => s + Math.abs(m.qty), 0);

    const data = inventory
      .filter(inv => !search || inv.product?.name.toLowerCase().includes(String(search).toLowerCase()) || inv.product?.urduName?.includes(String(search)))
      .map(inv => ({
        ...inv,
        stockStatus: inv.qty <= 0
          ? 'OUT_OF_STOCK'
          : inv.qty <= (inv.product?.minStock ?? 0)
          ? 'LOW'
          : 'OK',
        totalValue: inv.qty * inv.avgCost,
      }));

    const summary = {
      totalProducts: data.length,
      totalQty: data.reduce((s, i) => s + i.qty, 0),
      lowStockCount: data.filter(i => i.stockStatus === 'LOW').length,
      outOfStockCount: data.filter(i => i.stockStatus === 'OUT_OF_STOCK').length,
      totalValue: data.reduce((s, i) => s + i.totalValue, 0),
      todayStockIn,
      todayStockOut,
      todayWastage,
    };

    return res.json({ success: true, data, summary });
  } catch (err: any) {
    console.error('[GET /api/inventory]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load inventory' });
  }
});

// POST /api/inventory (wastage entry)
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { productId, itemName, qty, unit, reason, date } = req.body;

    if (!qty || qty <= 0) {
      return res.status(400).json({ success: false, error: 'Quantity must be > 0' });
    }
    if (!itemName && !productId) {
      return res.status(400).json({ success: false, error: 'Product name is required' });
    }

    let resolvedName = itemName;
    if (!resolvedName && productId) {
      const prod = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });
      resolvedName = prod?.name ?? 'Unknown';
    }

    const result = await prisma.$transaction(async tx => {
      return recordWastage(tx, {
        productId: productId ?? null,
        itemName: resolvedName ?? 'Unknown',
        branchId,
        qty,
        unit: unit ?? 'KG',
        reason: reason ?? undefined,
        date: date ? new Date(date) : new Date(),
      });
    }, { maxWait: 10000, timeout: 30000 });

    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    console.error('[POST /api/inventory wastage]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to record wastage' });
  }
});

// POST /api/inventory/adjust (manual stock adjustment)
router.post('/adjust', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { productId, adjustedQty, reason } = req.body;

    if (!productId) {
      return res.status(400).json({ success: false, error: 'Product is required' });
    }
    if (adjustedQty === undefined || adjustedQty === null || adjustedQty < 0) {
      return res.status(400).json({ success: false, error: 'Adjusted quantity must be 0 or more' });
    }

    const existing = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId, branchId } },
    });
    const systemQty = existing?.qty ?? 0;

    const result = await prisma.$transaction(async tx => {
      return manualAdjust(tx, {
        productId,
        branchId,
        systemQty,
        adjustedQty: Number(adjustedQty),
        reason: reason?.trim() || 'Physical count adjustment',
      });
    }, { maxWait: 10000, timeout: 30000 });

    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    console.error('[POST /api/inventory/adjust]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to adjust stock' });
  }
});

// GET /api/inventory/movements (stock movement history)
router.get('/movements', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) ?? undefined;
    const { productId, type, from, to, limit: limitQuery } = req.query;
    const limit = Math.min(parseInt(String(limitQuery ?? '200')), 500);

    const where: any = {
      ...(branchId ? { branchId } : {}),
      ...(productId ? { productId: String(productId) } : {}),
      ...(type && type !== 'all' ? { type: type as any } : {}),
    };

    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(String(from));
      if (to) {
        const d = new Date(String(to));
        d.setHours(23, 59, 59, 999);
        where.date.lte = d;
      }
    }

    const movements = await prisma.stockMovement.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, urduName: true, defaultUnit: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    const data = movements.map(m => ({
      id: m.id,
      date: m.date,
      productId: m.productId,
      productName: m.product?.name ?? '—',
      productUrdu: m.product?.urduName ?? '',
      unit: m.product?.defaultUnit ?? 'KG',
      type: m.type,
      qty: m.qty,
      stockIn: m.qty > 0 ? m.qty : 0,
      stockOut: m.qty < 0 ? Math.abs(m.qty) : 0,
      refType: m.refType ?? '',
      refId: m.refId ?? '',
      note: m.note ?? '',
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error('[GET /api/inventory/movements]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load movements' });
  }
});

export default router;
