import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { recordWastage, manualAdjust, recalculateProductStock } from '../lib/inventoryService';
import { getCurrentBusinessDateRange, getBusinessDateRange } from '../lib/businessDate';

const router = Router();

// ── In-Memory cache for inventory queries (30s TTL) ─────────────────────────
const INVENTORY_CACHE = new Map<string, { ts: number; data: any }>();
const INVENTORY_CACHE_TTL = 30000;
const INVENTORY_IN_FLIGHT = new Map<string, Promise<any>>();

const MOVEMENTS_CACHE = new Map<string, { ts: number; data: any }>();
const MOVEMENTS_CACHE_TTL = 30000;
const MOVEMENTS_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearInventoryCache(): void {
  INVENTORY_CACHE.clear();
  INVENTORY_IN_FLIGHT.clear();
  MOVEMENTS_CACHE.clear();
  MOVEMENTS_IN_FLIGHT.clear();
}

// GET /api/inventory
router.get('/', async (req: Request, res: Response) => {
  try {
    let branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) {
      const firstBranch = await prisma.branch.findFirst();
      branchId = firstBranch?.id ?? '';
    }
    const { search } = req.query;

    const cacheKey = `${branchId || 'all'}_${search || 'all'}`;
    const cached = INVENTORY_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < INVENTORY_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (INVENTORY_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await INVENTORY_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchInventoryPromise = (async () => {
      // 1. Fetch active products and branch inventory in parallel
      const [allProducts, existingInventory] = await Promise.all([
        prisma.product.findMany({
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
        }),
        prisma.inventory.findMany({
          where: { ...(branchId ? { branchId } : {}) },
          select: {
            id: true,
            productId: true,
            branchId: true,
            qty: true,
            reservedQty: true,
            avgCost: true,
            currentBuyPrice: true,
            previousBuyPrice: true,
            lastPurchaseDate: true,
            lastPurchaseQty: true,
            updatedAt: true,
          },
        }),
      ]);

      const inventoryMap = new Map(existingInventory.map(inv => [inv.productId, inv]));

      // 3. Merge: Every product in master catalog gets an inventory entry
      const mergedInventory = allProducts.map(prod => {
        const inv = inventoryMap.get(prod.id);
        if (inv) {
          return {
            ...inv,
            product: prod,
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
          const effectiveMinStock = ((inv as any).minStock && (inv as any).minStock > 0) ? (inv as any).minStock : (inv.product?.minStock ?? 0);
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

      return { success: true, data, summary };
    })();

    INVENTORY_IN_FLIGHT.set(cacheKey, fetchInventoryPromise);
    try {
      const responsePayload = await fetchInventoryPromise;
      if (INVENTORY_CACHE.size > 50) INVENTORY_CACHE.clear();
      INVENTORY_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      INVENTORY_IN_FLIGHT.delete(cacheKey);
    }
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
    }, { maxWait: 15000, timeout: 120000 });

    clearInventoryCache();
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
    }, { maxWait: 15000, timeout: 120000 });

    clearInventoryCache();
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

    clearInventoryCache();
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

    clearInventoryCache();
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
    const { productId, type, from, to, limit: limitQuery, page } = req.query;
    const limit = Math.min(parseInt(String(limitQuery ?? '200')), 500);

    const cacheKey = `${branchId || 'all'}_${productId || ''}_${type || ''}_${from || ''}_${to || ''}_${limit}_${page || '1'}`;
    const cached = MOVEMENTS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < MOVEMENTS_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (MOVEMENTS_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await MOVEMENTS_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchMovementsPromise = (async () => {
      const conditions: Prisma.Sql[] = [];
      if (branchId) {
        conditions.push(Prisma.sql`m."branchId" = ${branchId}`);
      }
      if (productId) {
        conditions.push(Prisma.sql`m."productId" = ${String(productId)}`);
      }
      if (type && type !== 'all') {
        conditions.push(Prisma.sql`m.type = ${type}::"StockMovementType"`);
      }
      if (from) {
        const startDate = getBusinessDateRange(String(from)).start;
        conditions.push(Prisma.sql`m.date >= ${startDate}`);
      }
      if (to) {
        const endDate = getBusinessDateRange(String(to)).end;
        conditions.push(Prisma.sql`m.date <= ${endDate}`);
      }

      const whereClause = conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

      const rows = await prisma.$queryRaw<Array<{
        id: string;
        date: Date;
        productId: string;
        productName: string;
        productUrdu: string;
        imageUrl: string | null;
        emoji: string | null;
        unit: string;
        type: string;
        qty: number;
        previousStock: number;
        newStock: number;
        stockIn: number;
        stockOut: number;
        refType: string;
        refId: string;
        userName: string;
        note: string;
      }>>(Prisma.sql`
        SELECT 
          m.id,
          COALESCE(m."createdAt", m.date) as date,
          m."productId",
          COALESCE(p.name, '—') as "productName",
          COALESCE(p."urduName", '') as "productUrdu",
          p."imageUrl",
          p.emoji,
          COALESCE(p."defaultUnit", 'KG') as unit,
          m.type,
          m.qty::float as qty,
          m."previousStock"::float as "previousStock",
          m."newStock"::float as "newStock",
          CASE WHEN m.qty > 0 THEN m.qty::float ELSE 0::float END as "stockIn",
          CASE WHEN m.qty < 0 THEN ABS(m.qty)::float ELSE 0::float END as "stockOut",
          COALESCE(m."refType", '') as "refType",
          COALESCE(m."refId", '') as "refId",
          COALESCE(u.name, 'System') as "userName",
          COALESCE(m.note, '') as note
        FROM stock_movements m
        LEFT JOIN products p ON p.id = m."productId"
        LEFT JOIN users u ON u.id = m."userId"
        ${whereClause}
        ORDER BY m.date DESC, m."createdAt" DESC
        LIMIT ${limit}
      `);

      return rows;
    })();

    MOVEMENTS_IN_FLIGHT.set(cacheKey, fetchMovementsPromise);
    try {
      const data = await fetchMovementsPromise;
      if (MOVEMENTS_CACHE.size > 50) MOVEMENTS_CACHE.clear();
      MOVEMENTS_CACHE.set(cacheKey, { ts: Date.now(), data });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data });
    } finally {
      MOVEMENTS_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('[GET /api/inventory/movements]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load movements' });
  }
});

export default router;
