import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, getValidUserId } from '../lib/business';
import { getCurrentBusinessDateRange, getBusinessDateRange, parseInputDateToUtc } from '../lib/businessDate';

const router = Router();

// Helper: Merges active Product Master catalog, Inventory quantities & costs, and PriceList items
function buildSynchronizedPriceListItems(
  existingList: any | null,
  activeProducts: any[],
  inventoryMap: Map<string, any>
) {
  // If no saved PriceList exists yet, all active products become draft items
  if (!existingList || !existingList.items) {
    return activeProducts.map((prod) => {
      const inv = inventoryMap.get(prod.id);
      const avgBuyCost = inv ? (inv.avgCost > 0 ? inv.avgCost : (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0)) : 0;
      const latestPurchasePrice = inv ? (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0) : 0;
      const previousBuyPrice = inv?.previousBuyPrice ?? 0;
      const currentStock = inv?.qty ?? 0;
      const availableStock = Math.max(0, currentStock - (inv?.reservedQty ?? 0));

      return {
        id: `draft-${prod.id}`,
        productId: prod.id,
        itemName: prod.name,
        unit: prod.defaultUnit,
        buyRate: avgBuyCost,
        avgBuyCost,
        latestPurchasePrice,
        previousBuyPrice,
        currentBuyPrice: latestPurchasePrice,
        currentStock,
        availableStock,
        sellRate: 0,
        notes: '',
        product: {
          id: prod.id,
          name: prod.name,
          urduName: prod.urduName,
          emoji: prod.emoji,
          imageUrl: prod.imageUrl,
          category: prod.category,
          availability: prod.availability,
        },
      };
    });
  }

  // When a saved PriceList exists, map items by productId and normalized itemName
  const itemsByProdId = new Map<string, any>();
  const itemsByName = new Map<string, any>();

  existingList.items.forEach((item: any) => {
    if (item.productId) itemsByProdId.set(item.productId, item);
    if (item.itemName) itemsByName.set(item.itemName.toLowerCase().trim(), item);
  });

  const mergedItems: any[] = [];
  const processedItemIds = new Set<string>();

  // 1. Process all active products from Product Master
  for (const prod of activeProducts) {
    const savedItem = itemsByProdId.get(prod.id) || itemsByName.get(prod.name.toLowerCase().trim());
    const inv = inventoryMap.get(prod.id);
    const avgBuyCost = inv 
      ? (inv.avgCost > 0 ? inv.avgCost : (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : (savedItem?.buyRate ?? 0))) 
      : (savedItem?.buyRate ?? 0);
    const latestPurchasePrice = inv ? (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0) : 0;
    const previousBuyPrice = inv?.previousBuyPrice ?? 0;
    const currentStock = inv?.qty ?? 0;
    const availableStock = Math.max(0, currentStock - (inv?.reservedQty ?? 0));

    if (savedItem) {
      processedItemIds.add(savedItem.id);
      mergedItems.push({
        ...savedItem,
        productId: prod.id, // Guarantee productId is populated
        itemName: prod.name, // Keep synced with product master
        unit: savedItem.unit || prod.defaultUnit,
        buyRate: avgBuyCost,
        avgBuyCost,
        latestPurchasePrice,
        currentBuyPrice: latestPurchasePrice,
        previousBuyPrice,
        currentStock,
        availableStock,
        product: {
          id: prod.id,
          name: prod.name,
          urduName: prod.urduName,
          emoji: prod.emoji,
          imageUrl: prod.imageUrl,
          category: prod.category,
          availability: prod.availability,
        },
      });
    } else {
      // Newly added product in Product Master that wasn't in today's PriceList yet
      mergedItems.push({
        id: `draft-${prod.id}`,
        priceListId: existingList.id,
        productId: prod.id,
        itemName: prod.name,
        unit: prod.defaultUnit,
        buyRate: avgBuyCost,
        avgBuyCost,
        latestPurchasePrice,
        previousBuyPrice,
        currentBuyPrice: latestPurchasePrice,
        currentStock,
        availableStock,
        sellRate: 0,
        notes: '',
        product: {
          id: prod.id,
          name: prod.name,
          urduName: prod.urduName,
          emoji: prod.emoji,
          imageUrl: prod.imageUrl,
          category: prod.category,
          availability: prod.availability,
        },
      });
    }
  }

  // 2. Include any legacy / custom PriceItems in existingList not matching active products
  for (const item of existingList.items) {
    if (!processedItemIds.has(item.id)) {
      const inv = item.productId ? inventoryMap.get(item.productId) : null;
      const avgBuyCost = inv 
        ? (inv.avgCost > 0 ? inv.avgCost : (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : (item.buyRate ?? 0))) 
        : (item.buyRate ?? 0);
      const latestPurchasePrice = inv ? (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0) : 0;
      const previousBuyPrice = inv?.previousBuyPrice ?? 0;
      const currentStock = inv?.qty ?? 0;
      const availableStock = Math.max(0, currentStock - (inv?.reservedQty ?? 0));

      mergedItems.push({
        ...item,
        buyRate: avgBuyCost,
        avgBuyCost,
        latestPurchasePrice,
        currentBuyPrice: latestPurchasePrice,
        previousBuyPrice,
        currentStock,
        availableStock,
      });
    }
  }

  return mergedItems;
}

// ── In-Memory cache for Product catalog queries (60s TTL) ────────────────────
let ACTIVE_PRODUCTS_CACHE: { ts: number; data: any[] } | null = null;
const ACTIVE_PRODUCTS_CACHE_TTL = 60000;

export async function getCachedActiveProducts(): Promise<any[]> {
  if (ACTIVE_PRODUCTS_CACHE && (Date.now() - ACTIVE_PRODUCTS_CACHE.ts) < ACTIVE_PRODUCTS_CACHE_TTL) {
    return ACTIVE_PRODUCTS_CACHE.data;
  }
  const products = await prisma.product.findMany({
    where: {
      availability: { in: ['AVAILABLE', 'SEASONAL'] },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      urduName: true,
      category: true,
      defaultUnit: true,
      availability: true,
      emoji: true,
      imageUrl: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  ACTIVE_PRODUCTS_CACHE = { ts: Date.now(), data: products };
  return products;
}

export function clearActiveProductsCache(): void {
  ACTIVE_PRODUCTS_CACHE = null;
}

// In-Memory cache for Price List queries (30s TTL)
const PRICELIST_CACHE = new Map<string, { ts: number; data: any }>();
const PRICELIST_CACHE_TTL = 30000;

export function clearPriceListCache(): void {
  PRICELIST_CACHE.clear();
}

// GET /api/pricelist/active — Get today's active Price List with Inventory buy rates & stock
router.get('/active', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = `active_${branchId || 'all'}`;
    const cached = PRICELIST_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < PRICELIST_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const { start: todayStart, end: todayEnd } = getCurrentBusinessDateRange();

    // Fetch active price list, inventory, and cached active products in parallel
    const [list, inventories, activeProducts] = await Promise.all([
      prisma.priceList.findFirst({
        where: {
          ...(branchId ? { branchId } : {}),
          date: { gte: todayStart, lte: todayEnd },
          isActive: true,
        },
        select: {
          id: true,
          date: true,
          branchId: true,
          isActive: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { id: true, name: true } },
          items: {
            select: {
              id: true,
              priceListId: true,
              productId: true,
              itemName: true,
              unit: true,
              buyRate: true,
              sellRate: true,
              notes: true,
              product: {
                select: { id: true, name: true, urduName: true, category: true, availability: true, emoji: true, imageUrl: true }
              }
            },
            orderBy: { itemName: 'asc' },
          },
        },
      }),
      branchId ? prisma.inventory.findMany({
        where: { branchId },
        select: {
          productId: true,
          qty: true,
          reservedQty: true,
          avgCost: true,
          currentBuyPrice: true,
          previousBuyPrice: true,
        }
      }) : Promise.resolve([]),
      getCachedActiveProducts(),
    ]);

    const inventoryMap = new Map<string, any>();
    inventories.forEach(inv => inventoryMap.set(inv.productId, inv));

    const synchronizedItems = buildSynchronizedPriceListItems(list, activeProducts, inventoryMap);

    const rateMap: Record<string, number> = {};
    synchronizedItems.forEach(item => {
      rateMap[item.itemName.toLowerCase()] = item.sellRate;
      if (item.productId) rateMap[item.productId] = item.sellRate;
    });

    let responsePayload: any;
    if (!list) {
      responsePayload = {
        success: true,
        isToday: false,
        isDraft: true,
        data: {
          id: 'draft',
          date: todayStart.toISOString(),
          isActive: true,
          notes: 'Draft price list loaded from Central Inventory',
          items: synchronizedItems,
        },
        rateMap,
      };
    } else {
      responsePayload = {
        success: true,
        isToday: true,
        isDraft: false,
        data: {
          ...list,
          items: synchronizedItems,
        },
        rateMap,
      };
    }

    if (PRICELIST_CACHE.size > 50) PRICELIST_CACHE.clear();
    PRICELIST_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
    res.setHeader('X-Cache', 'MISS');
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('Error in GET /api/pricelist/active:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load active price list' });
  }
});

// GET /api/pricelist/history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { productId, itemName, days: daysQuery } = req.query;
    const days = Math.min(parseInt(String(daysQuery ?? '30')), 90);

    const since = new Date(Date.now() - days * 86400000);

    const items = await prisma.priceItem.findMany({
      where: {
        priceList: {
          ...(branchId ? { branchId } : {}),
          date: { gte: since },
          isActive: true,
        },
        ...(productId ? { productId: String(productId) } : {}),
        ...(itemName ? { itemName: { contains: String(itemName), mode: 'insensitive' } } : {}),
      },
      include: {
        priceList: { select: { id: true, date: true } },
        product: { select: { id: true, name: true, urduName: true, category: true, emoji: true, imageUrl: true } },
      },
      orderBy: [{ itemName: 'asc' }, { priceList: { date: 'asc' } }],
    });

    const grouped: Record<string, any[]> = {};
    items.forEach(item => {
      const key = item.itemName;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        date: item.priceList.date,
        buyRate: item.buyRate,
        sellRate: item.sellRate,
        unit: item.unit,
        margin: +(item.sellRate - item.buyRate).toFixed(2),
        marginPct: item.buyRate > 0 ? +((item.sellRate - item.buyRate) / item.buyRate * 100).toFixed(1) : 0,
        priceListId: item.priceList.id,
        product: item.product,
      });
    });

    const history = Object.entries(grouped).map(([name, entries]) => {
      const sorted = entries;
      const withChange = sorted.map((entry, i) => {
        const prev = sorted[i - 1];
        const sellChange = prev ? +(((entry.sellRate - prev.sellRate) / prev.sellRate) * 100).toFixed(1) : null;
        const buyChange = prev ? +(((entry.buyRate - prev.buyRate) / prev.buyRate) * 100).toFixed(1) : null;
        return { ...entry, sellChange, buyChange };
      });
      return {
        itemName: name,
        product: entries[0]?.product ?? null,
        latest: withChange[withChange.length - 1] ?? null,
        history: withChange,
      };
    });

    history.sort((a, b) => a.itemName.localeCompare(b.itemName));

    return res.json({ success: true, data: history, days });
  } catch (err: any) {
    console.error('Error in GET /api/pricelist/history:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load price history' });
  }
});

// POST /api/pricelist/duplicate
router.post('/duplicate', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;
  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const { sourceId } = req.body;

  try {
    let source;
    if (sourceId) {
      source = await prisma.priceList.findUnique({
        where: { id: sourceId },
        include: { items: true },
      });
    } else {
      source = await prisma.priceList.findFirst({
        where: { branchId, isActive: true },
        include: { items: true },
        orderBy: { date: 'desc' },
      });
    }

    if (!source || source.items.length === 0) {
      return res.status(404).json({ success: false, error: 'No source price list found to duplicate' });
    }

    const { start: todayStart, end: todayEnd } = getCurrentBusinessDateRange();

    const existing = await prisma.priceList.findFirst({
      where: { branchId, date: { gte: todayStart, lte: todayEnd } },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "Today's price list already exists",
        existingId: existing.id,
      });
    }

    const today = parseInputDateToUtc();

    const newList = await prisma.priceList.create({
      data: {
        date: today,
        branchId,
        createdById: userId ?? undefined,
        notes: `Duplicated from ${new Date(source.date).toLocaleDateString('en-GB')}`,
        items: {
          create: source.items.map(item => ({
            productId: item.productId ?? undefined,
            itemName: item.itemName,
            unit: item.unit,
            buyRate: item.buyRate,
            sellRate: item.sellRate,
            notes: item.notes ?? undefined,
          })),
        },
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, urduName: true, category: true, emoji: true, imageUrl: true } } }, orderBy: { itemName: 'asc' } },
      },
    });

    clearPriceListCache();
    return res.status(201).json({ success: true, data: newList, duplicatedFrom: source.id });
  } catch (err: any) {
    console.error('Error in POST /api/pricelist/duplicate:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to duplicate price list' });
  }
});

// GET /api/pricelist — List or query price lists
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { date: dateStr, limit: limitQuery } = req.query;
    const limit = Math.min(parseInt(String(limitQuery ?? '30')), 90);

    if (dateStr) {
      const cacheKey = `${branchId || 'all'}_${dateStr}`;
      const cached = PRICELIST_CACHE.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < PRICELIST_CACHE_TTL) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached.data);
      }

      const { start: day, end: dayEnd } = getBusinessDateRange(String(dateStr));

      const [list, inventories, activeProducts] = await Promise.all([
        prisma.priceList.findFirst({
          where: {
            ...(branchId ? { branchId } : {}),
            date: { gte: day, lte: dayEnd },
            isActive: true,
          },
          select: {
            id: true,
            date: true,
            branchId: true,
            isActive: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
            createdBy: { select: { id: true, name: true } },
            items: {
              select: {
                id: true,
                priceListId: true,
                productId: true,
                itemName: true,
                unit: true,
                buyRate: true,
                sellRate: true,
                notes: true,
                product: {
                  select: { id: true, name: true, urduName: true, category: true, availability: true, emoji: true, imageUrl: true }
                }
              },
              orderBy: { itemName: 'asc' }
            },
          },
        }),
        branchId ? prisma.inventory.findMany({
          where: { branchId },
          select: {
            productId: true,
            qty: true,
            reservedQty: true,
            avgCost: true,
            currentBuyPrice: true,
            previousBuyPrice: true,
          }
        }) : Promise.resolve([]),
        getCachedActiveProducts(),
      ]);

      const inventoryMap = new Map<string, any>();
      inventories.forEach(inv => inventoryMap.set(inv.productId, inv));

      const synchronizedItems = buildSynchronizedPriceListItems(list, activeProducts, inventoryMap);

      let responsePayload;
      if (list) {
        responsePayload = { success: true, isDraft: false, data: { ...list, items: synchronizedItems } };
      } else {
        responsePayload = {
          success: true,
          isDraft: true,
          data: {
            id: 'draft',
            date: day.toISOString(),
            isActive: true,
            notes: 'Draft based on central inventory catalog',
            items: synchronizedItems,
          },
        };
      }

      if (PRICELIST_CACHE.size > 50) PRICELIST_CACHE.clear();
      PRICELIST_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    }

    const listCacheKey = `lists_${branchId || 'all'}_${limit}`;
    const cachedLists = PRICELIST_CACHE.get(listCacheKey);
    if (cachedLists && (Date.now() - cachedLists.ts) < PRICELIST_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cachedLists.data });
    }

    const lists = await prisma.priceList.findMany({
      where: { ...(branchId ? { branchId } : {}), isActive: true },
      include: {
        _count: { select: { items: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: limit,
    });

    PRICELIST_CACHE.set(listCacheKey, { ts: Date.now(), data: lists });
    return res.json({ success: true, data: lists });
  } catch (err: any) {
    console.error('Error in GET /api/pricelist:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load price lists', data: [] });
  }
});

// POST /api/pricelist — Save or update selling rates for Price List
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || null;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { date, items = [], notes } = req.body;

    const listDate = parseInputDateToUtc(date);
    const { start: dayStart, end: dayEnd } = getBusinessDateRange(date);

    let existing = await prisma.priceList.findFirst({
      where: { branchId, date: { gte: dayStart, lte: dayEnd } },
    });

    // Fetch Inventory buy rates map — using avgCost (weighted avg) with currentBuyPrice as fallback
    const productIds = items.filter((it: any) => it.productId).map((it: any) => it.productId);
    const inventories = productIds.length > 0 ? await prisma.inventory.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { productId: true, currentBuyPrice: true, avgCost: true }
    }) : [];
    const invBuyMap = new Map<string, number>();
    inventories.forEach(inv => {
      // Use avgCost (weighted average) as primary, fallback to currentBuyPrice if available
      const effectiveBuyRate = inv.avgCost > 0 ? inv.avgCost : (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0);
      invBuyMap.set(inv.productId, effectiveBuyRate);
    });

    const validatedUserId = await getValidUserId(userId);

    if (existing) {
      // Upsert item sell rates into existing list
      for (const it of items) {
        const buyRate = it.productId ? (invBuyMap.get(it.productId) ?? it.buyRate ?? 0) : (it.buyRate ?? 0);
        await prisma.priceItem.upsert({
          where: { priceListId_itemName: { priceListId: existing.id, itemName: it.itemName } },
          update: {
            sellRate: Number(it.sellRate ?? 0),
            buyRate,
            unit: it.unit ?? 'KG',
            notes: it.notes ?? undefined,
            productId: it.productId ?? undefined,
          },
          create: {
            priceListId: existing.id,
            itemName: it.itemName,
            productId: it.productId ?? undefined,
            unit: it.unit ?? 'KG',
            buyRate,
            sellRate: Number(it.sellRate ?? 0),
            notes: it.notes ?? undefined,
          },
        });
      }

      const updated = await prisma.priceList.findUnique({
        where: { id: existing.id },
        include: {
          items: { include: { product: { select: { id: true, name: true, urduName: true, category: true, emoji: true, imageUrl: true } } }, orderBy: { itemName: 'asc' } },
          createdBy: { select: { id: true, name: true } },
        },
      });
      clearPriceListCache();
      return res.status(200).json({ success: true, data: updated });
    }

    const list = await prisma.priceList.create({
      data: {
        date: listDate,
        branchId,
        createdById: validatedUserId ?? undefined,
        notes: notes ?? undefined,
        items: items.length > 0 ? {
          create: items.map((it: any) => {
            const buyRate = it.productId ? (invBuyMap.get(it.productId) ?? it.buyRate ?? 0) : (it.buyRate ?? 0);
            return {
              productId: it.productId ?? undefined,
              itemName: it.itemName,
              unit: it.unit ?? 'KG',
              buyRate,
              sellRate: Number(it.sellRate ?? 0),
              notes: it.notes ?? undefined,
            };
          }),
        } : undefined,
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, urduName: true, category: true, emoji: true, imageUrl: true } } }, orderBy: { itemName: 'asc' } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    clearPriceListCache();
    return res.status(201).json({ success: true, data: list });
  } catch (err: any) {
    console.error('Error in POST /api/pricelist:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create/update price list' });
  }
});

// GET /api/pricelist/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const list = await prisma.priceList.findUnique({
      where: { id },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, urduName: true, category: true, emoji: true, imageUrl: true } } },
          orderBy: { itemName: 'asc' },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!list) return res.status(404).json({ success: false, error: 'Not found' });

    const inventories = await prisma.inventory.findMany({
      where: { branchId: list.branchId },
      select: {
        productId: true,
        qty: true,
        reservedQty: true,
        avgCost: true,
        currentBuyPrice: true,
        previousBuyPrice: true,
      }
    });
    const invMap = new Map<string, any>();
    inventories.forEach(i => invMap.set(i.productId, i));

    const activeProducts = await getCachedActiveProducts();

    const synchronizedItems = buildSynchronizedPriceListItems(list, activeProducts, invMap);

    return res.json({ success: true, data: { ...list, items: synchronizedItems } });
  } catch (err: any) {
    console.error('Error in GET /api/pricelist/:id:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load price list' });
  }
});

// PATCH /api/pricelist/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes, isActive, items } = req.body;

    const existingList = await prisma.priceList.findUnique({ where: { id }, select: { branchId: true } });
    if (!existingList) return res.status(404).json({ success: false, error: 'Price list not found' });

    await prisma.priceList.update({
      where: { id },
      data: {
        ...(notes !== undefined ? { notes } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    if (items && Array.isArray(items)) {
      const productIds = items.filter((it: any) => it.productId).map((it: any) => it.productId);
      const inventories = productIds.length > 0 ? await prisma.inventory.findMany({
        where: { branchId: existingList.branchId, productId: { in: productIds } },
        select: { productId: true, currentBuyPrice: true, avgCost: true }
      }) : [];
      const invBuyMap = new Map<string, number>();
      inventories.forEach(inv => {
        const effectiveBuyRate = inv.avgCost > 0 ? inv.avgCost : (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0);
        invBuyMap.set(inv.productId, effectiveBuyRate);
      });

      for (const item of items) {
        const buyRate = item.productId ? (invBuyMap.get(item.productId) ?? item.buyRate ?? 0) : (item.buyRate ?? 0);
        await prisma.priceItem.upsert({
          where: { priceListId_itemName: { priceListId: id, itemName: item.itemName } },
          update: {
            buyRate,
            sellRate: Number(item.sellRate ?? 0),
            unit: item.unit ?? 'KG',
            notes: item.notes ?? undefined,
            productId: item.productId ?? undefined,
          },
          create: {
            priceListId: id,
            itemName: item.itemName,
            productId: item.productId ?? undefined,
            unit: item.unit ?? 'KG',
            buyRate,
            sellRate: Number(item.sellRate ?? 0),
            notes: item.notes ?? undefined,
          },
        });
      }
    }

    const updated = await prisma.priceList.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true, urduName: true, category: true, emoji: true, imageUrl: true } } }, orderBy: { itemName: 'asc' } },
      },
    });

    clearPriceListCache();
    return res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('Error in PATCH /api/pricelist/:id:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update price list' });
  }
});

// DELETE /api/pricelist/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.priceList.update({ where: { id }, data: { isActive: false } });
    clearPriceListCache();
    return res.json({ success: true, message: 'Price list deactivated' });
  } catch (err: any) {
    console.error('Error in DELETE /api/pricelist/:id:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to delete price list' });
  }
});

export default router;
