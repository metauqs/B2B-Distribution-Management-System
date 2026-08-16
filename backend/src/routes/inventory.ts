import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { recordWastage, manualAdjust, recalculateProductStock } from '../lib/inventoryService';
import { getCurrentBusinessDateRange } from '../lib/businessDate';

const router = Router();

// GET /api/inventory
router.get('/', async (req: Request, res: Response) => {
  try {
    let branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) {
      const firstBranch = await prisma.branch.findFirst();
      branchId = firstBranch?.id ?? '';
    }
    const { search } = req.query;

    // 1. Fetch all active products from master catalog
    const allProducts = await prisma.product.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        urduName: true,
        emoji: true,
        imageUrl: true,
        category: true,
        defaultUnit: true,
        minStock: true,
        availability: true,
      },
    });

    // 2. Fetch existing inventory records for this branch
    const existingInventory = await prisma.inventory.findMany({
      where: { ...(branchId ? { branchId } : {}) },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            urduName: true,
            emoji: true,
            imageUrl: true,
            category: true,
            defaultUnit: true,
            minStock: true,
            availability: true,
          },
        },
      },
    });

    const inventoryMap = new Map(existingInventory.map(inv => [inv.productId, inv]));

    // 3. Merge: Every product in master catalog gets an inventory entry
    const mergedInventory = allProducts.map(prod => {
      const inv = inventoryMap.get(prod.id);
      if (inv) {
        return {
          ...inv,
          product: inv.product ?? prod,
        };
      }
      return {
        id: `virtual-${prod.id}`,
        productId: prod.id,
        branchId: branchId ?? '',
        qty: 0,
        reservedQty: 0,
        avgCost: 0,
        currentBuyPrice: 0,
        previousBuyPrice: 0,
        lastPurchaseDate: null,
        lastPurchaseQty: 0,
        minStock: prod.minStock ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        product: prod,
      };
    });

    const { start: todayStart, end: todayEnd } = getCurrentBusinessDateRange();

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

    const data = mergedInventory
      .filter(inv => !search || inv.product?.name.toLowerCase().includes(String(search).toLowerCase()) || inv.product?.urduName?.includes(String(search)))
      .map(inv => {
        const availableQty = Math.max(0, inv.qty - (inv.reservedQty ?? 0));
        const effectiveMinStock = inv.minStock > 0 ? inv.minStock : (inv.product?.minStock ?? 0);
        const stockStatus = inv.qty <= 0
          ? 'OUT_OF_STOCK'
          : inv.qty <= effectiveMinStock
          ? 'LOW'
          : 'OK';
        
        const avgBuyCost = (inv.avgCost && inv.avgCost > 0)
          ? inv.avgCost
          : (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0);
        const latestPurchasePrice = inv.currentBuyPrice > 0 ? inv.currentBuyPrice : avgBuyCost;
        const totalValue = Math.max(0, inv.qty) * avgBuyCost;

        return {
          ...inv,
          avgCost: avgBuyCost,
          currentBuyPrice: latestPurchasePrice,
          latestPurchasePrice,
          availableQty,
          stockStatus,
          effectiveMinStock,
          totalValue,
        };
      });

    const summary = {
      totalProducts: data.length,
      totalQty: data.reduce((s, i) => s + i.qty, 0),
      totalAvailableQty: data.reduce((s, i) => s + i.availableQty, 0),
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

// GET /api/inventory/price-history (Purchase buy price history)
router.get('/price-history', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) ?? undefined;
    const { productId, limit: limitQuery } = req.query;
    const limit = Math.min(parseInt(String(limitQuery ?? '100')), 500);

    const where: any = {
      ...(branchId ? { branchId } : {}),
      ...(productId ? { productId: String(productId) } : {}),
    };

    const history = await prisma.purchasePriceHistory.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, urduName: true, defaultUnit: true, imageUrl: true, emoji: true } },
        supplier: { select: { id: true, name: true } },
        purchase: { select: { id: true, date: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    return res.json({ success: true, data: history });
  } catch (err: any) {
    console.error('[GET /api/inventory/price-history]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load purchase price history' });
  }
});

// POST /api/inventory (Wastage entry)
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { productId, itemName, qty, unit, reason, remarks, date } = req.body;

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
        qty: Number(qty),
        unit: unit ?? 'KG',
        reason: reason ?? undefined,
        remarks: remarks ?? undefined,
        userId,
        date: date ? new Date(date) : new Date(),
      });
    }, { maxWait: 10000, timeout: 30000 });

    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    console.error('[POST /api/inventory wastage]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to record wastage' });
  }
});

// POST /api/inventory/adjust (Manual stock adjustment)
router.post('/adjust', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { productId, adjustedQty, adjustmentType, reason, remarks } = req.body;

    if (!productId) {
      return res.status(400).json({ success: false, error: 'Product is required' });
    }
    if (adjustedQty === undefined || adjustedQty === null || isNaN(Number(adjustedQty))) {
      return res.status(400).json({ success: false, error: 'Valid adjustment quantity is required' });
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
        adjustmentType: adjustmentType ?? 'SET',
        reason: reason?.trim() || 'Physical count adjustment',
        remarks: remarks?.trim() || undefined,
        userId,
      });
    }, { maxWait: 10000, timeout: 30000 });

    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    console.error('[POST /api/inventory/adjust]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to adjust stock' });
  }
});

// POST /api/inventory/reset — Reset all inventory stock to 0 for fresh manual setup
router.post('/reset', async (req: Request, res: Response) => {
  try {
    let branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) {
      const firstBranch = await prisma.branch.findFirst();
      branchId = firstBranch?.id ?? '';
    }

    const userId = (req.headers['x-user-id'] as string) || null;

    const inventories = await prisma.inventory.findMany({
      where: { ...(branchId ? { branchId } : {}) }
    });

    let resetCount = 0;
    for (const inv of inventories) {
      if (inv.qty !== 0 || inv.reservedQty !== 0) {
        await manualAdjust(prisma, {
          productId: inv.productId,
          branchId: inv.branchId,
          systemQty: inv.qty,
          adjustedQty: 0,
          adjustmentType: 'SET',
          reason: 'Admin reset inventory stock to 0 to start fresh',
          userId: userId ?? undefined,
        });

        await prisma.inventory.update({
          where: { id: inv.id },
          data: {
            reservedQty: 0,
            currentBuyPrice: 0,
            previousBuyPrice: 0,
            lastPurchaseDate: null,
            lastPurchaseQty: 0,
          }
        });

        resetCount++;
      }
    }

    return res.json({
      success: true,
      message: `Inventory successfully reset. ${resetCount} items updated to 0 stock.`,
      resetCount,
    });
  } catch (err: any) {
    console.error('[POST /api/inventory/reset]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to reset inventory' });
  }
});

// POST /api/inventory/reconcile — Run single-source-of-truth inventory reconciliation
router.post('/reconcile', async (req: Request, res: Response) => {
  try {
    let branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) {
      const firstBranch = await prisma.branch.findFirst();
      branchId = firstBranch?.id ?? '';
    }

    const products = await prisma.product.findMany({ select: { id: true } });

    let reconciledCount = 0;
    for (const p of products) {
      await recalculateProductStock(prisma, p.id, branchId);
      reconciledCount++;
    }

    return res.json({
      success: true,
      message: `Single Source of Truth Reconciliation complete. ${reconciledCount} product inventory records synchronized.`,
      reconciledCount,
    });
  } catch (err: any) {
    console.error('[POST /api/inventory/reconcile]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to reconcile inventory' });
  }
});

// POST /api/inventory/buy-price (Admin manual buy price adjustment)
router.post('/buy-price', async (req: Request, res: Response) => {
  try {
    let branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) {
      const firstBranch = await prisma.branch.findFirst();
      branchId = firstBranch?.id ?? '';
    }

    const { productId, newBuyPrice, reason } = req.body;

    if (!productId) {
      return res.status(400).json({ success: false, error: 'Product is required' });
    }
    if (newBuyPrice === undefined || newBuyPrice === null || isNaN(Number(newBuyPrice)) || Number(newBuyPrice) < 0) {
      return res.status(400).json({ success: false, error: 'Valid non-negative buy price is required' });
    }

    const price = Number(newBuyPrice);

    const existing = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId, branchId } },
    });

    const oldBuyPrice = existing?.currentBuyPrice ?? 0;

    // This is an intentional direct update for price-only adjustments,
    // as inventoryService currently does not have a dedicated 'update price only' method.
    const updated = await prisma.inventory.upsert({
      where: { productId_branchId: { productId, branchId } },
      update: {
        previousBuyPrice: oldBuyPrice > 0 ? oldBuyPrice : (existing?.previousBuyPrice ?? 0),
        currentBuyPrice: price,
        avgCost: price,
      },
      create: {
        productId,
        branchId,
        qty: 0,
        currentBuyPrice: price,
        previousBuyPrice: 0,
        avgCost: price,
      },
    });

    // Record entry in PurchasePriceHistory
    await prisma.purchasePriceHistory.create({
      data: {
        productId,
        branchId,
        buyPrice: price,
        qty: existing?.qty ?? 0,
        date: new Date(),
      },
    });

    return res.json({
      success: true,
      data: {
        productId,
        oldBuyPrice,
        newBuyPrice: price,
        inventory: updated,
      },
    });
  } catch (err: any) {
    console.error('[POST /api/inventory/buy-price]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update buy price' });
  }
});

// GET /api/inventory/movements (Stock movement history audit log)
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
        product: { select: { id: true, name: true, urduName: true, defaultUnit: true, imageUrl: true, emoji: true } },
        user: { select: { id: true, name: true } },
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
      imageUrl: m.product?.imageUrl ?? null,
      emoji: m.product?.emoji ?? null,
      unit: m.product?.defaultUnit ?? 'KG',
      type: m.type,
      qty: m.qty,
      previousStock: m.previousStock,
      newStock: m.newStock,
      stockIn: m.qty > 0 ? m.qty : 0,
      stockOut: m.qty < 0 ? Math.abs(m.qty) : 0,
      refType: m.refType ?? '',
      refId: m.refId ?? '',
      userName: m.user?.name ?? 'System',
      note: m.note ?? '',
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error('[GET /api/inventory/movements]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load movements' });
  }
});

export default router;
