import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, getValidUserId } from '../lib/business';

const router = Router();

// GET /api/pricelist/active
router.get('/active', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;

    const todayStart = new Date(Date.now() - 5 * 60 * 60 * 1000); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);

    const purchasedToday = await prisma.purchaseItem.findMany({
      where: {
        purchase: {
          branchId: branchId ?? undefined,
          date: { gte: todayStart, lte: todayEnd },
          deletedAt: null,
        },
      },
      select: {
        productId: true,
      },
    });
    const purchasedProductIds = Array.from(
      new Set(purchasedToday.map((it) => it.productId).filter(Boolean))
    ) as string[];

    const list = await prisma.priceList.findFirst({
      where: {
        ...(branchId ? { branchId } : {}),
        date: { gte: todayStart, lte: todayEnd },
        isActive: true,
      },
      include: {
        items: {
          ...(purchasedProductIds.length > 0 ? {
            where: {
              OR: [
                { productId: { in: purchasedProductIds } },
                { productId: null, buyRate: { gt: 0 } },
                { sellRate: { gt: 0 } },
              ]
            }
          } : {
            where: {
              OR: [
                { buyRate: { gt: 0 } },
                { sellRate: { gt: 0 } },
              ]
            }
          }),
          include: {
            product: {
              select: { id: true, name: true, urduName: true, category: true }
            }
          },
          orderBy: { itemName: 'asc' },
        },
      },
    });

    const rateMap: Record<string, number> = {};
    if (list) {
      list.items.forEach(item => {
        rateMap[item.itemName.toLowerCase()] = item.sellRate;
        if (item.productId) rateMap[item.productId] = item.sellRate;
      });
    }

    return res.json({
      success: true,
      isToday: !!list,
      data: list,
      rateMap,
    });
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
        product: {
          purchaseItems: {
            some: {}
          }
        },
        ...(productId ? { productId: String(productId) } : {}),
        ...(itemName ? { itemName: { contains: String(itemName), mode: 'insensitive' } } : {}),
      },
      include: {
        priceList: { select: { id: true, date: true } },
        product: { select: { id: true, name: true, urduName: true, category: true } },
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

    const todayStart = new Date(Date.now() - 5 * 60 * 60 * 1000); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);

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

    const today = new Date(Date.now() - 5 * 60 * 60 * 1000);
    today.setHours(12, 0, 0, 0);

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
        items: { include: { product: { select: { id: true, name: true, urduName: true } } }, orderBy: { itemName: 'asc' } },
      },
    });

    return res.status(201).json({ success: true, data: newList, duplicatedFrom: source.id });
  } catch (err: any) {
    console.error('Error in POST /api/pricelist/duplicate:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to duplicate price list' });
  }
});

// GET /api/pricelist
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { date: dateStr, limit: limitQuery } = req.query;
    const limit = Math.min(parseInt(String(limitQuery ?? '30')), 90);

    if (dateStr) {
      const day = new Date(String(dateStr));
      day.setHours(0, 0, 0, 0);
      const dayEnd = new Date(String(dateStr));
      dayEnd.setHours(23, 59, 59, 999);

      // Get all products purchased on this specific date
      const purchasedToday = await prisma.purchaseItem.findMany({
        where: {
          purchase: {
            branchId: branchId ?? undefined,
            date: { gte: day, lte: dayEnd },
            deletedAt: null,
          },
        },
        select: {
          productId: true,
        },
      });
      const purchasedProductIds = Array.from(
        new Set(purchasedToday.map((it) => it.productId).filter(Boolean))
      ) as string[];

      const list = await prisma.priceList.findFirst({
        where: {
          branchId: branchId ?? undefined,
          date: { gte: day, lte: dayEnd },
          isActive: true,
        },
        include: {
          items: {
            ...(purchasedProductIds.length > 0 ? {
              where: {
                OR: [
                  { productId: { in: purchasedProductIds } },
                  { productId: null, buyRate: { gt: 0 } },
                  { sellRate: { gt: 0 } },
                ]
              }
            } : {
              where: {
                OR: [
                  { buyRate: { gt: 0 } },
                  { sellRate: { gt: 0 } },
                ]
              }
            }),
            include: {
              product: {
                select: { id: true, name: true, urduName: true, category: true, availability: true }
              }
            },
            orderBy: { itemName: 'asc' }
          },
          createdBy: { select: { id: true, name: true } },
        },
      });

      if (list) {
        return res.json({ success: true, isDraft: false, data: list });
      }

      const activeProducts = await prisma.product.findMany({
        where: {
          id: {
            in: purchasedProductIds
          },
          availability: { in: ['AVAILABLE', 'SEASONAL'] },
          isActive: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      const draftItems = activeProducts.map((prod) => {
        return {
          productId: prod.id,
          itemName: prod.name,
          unit: prod.defaultUnit,
          buyRate: 0,
          sellRate: 0,
          notes: '',
          product: {
            id: prod.id,
            name: prod.name,
            urduName: prod.urduName,
            category: prod.category,
            availability: prod.availability,
          },
        };
      });

      return res.json({
        success: true,
        isDraft: true,
        data: {
          id: 'draft',
          date: day.toISOString(),
          isActive: true,
          notes: 'Draft based on active products catalog',
          items: draftItems,
        },
      });
    }

    const lists = await prisma.priceList.findMany({
      where: { ...(branchId ? { branchId } : {}), isActive: true },
      include: {
        _count: { select: { items: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { date: 'asc' },
      take: limit,
    });

    return res.json({ success: true, data: lists });
  } catch (err: any) {
    console.error('Error in GET /api/pricelist:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load price lists', data: [] });
  }
});

// POST /api/pricelist
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || null;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { date, items = [], notes } = req.body;

    const listDate = date ? new Date(date) : new Date(Date.now() - 5 * 60 * 60 * 1000);
    listDate.setHours(12, 0, 0, 0);

    const dayStart = new Date(listDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(listDate); dayEnd.setHours(23, 59, 59, 999);

    const existing = await prisma.priceList.findFirst({
      where: { branchId, date: { gte: dayStart, lte: dayEnd } },
    });
    if (existing) {
      return res.status(409).json({ success: false, error: 'A price list for this date already exists', existingId: existing.id });
    }

    const validatedUserId = await getValidUserId(userId);
    const list = await prisma.priceList.create({
      data: {
        date: listDate,
        branchId,
        createdById: validatedUserId ?? undefined,
        notes: notes ?? undefined,
        items: items.length > 0 ? {
          create: items.map((it: any) => ({
            productId: it.productId ?? undefined,
            itemName: it.itemName,
            unit: it.unit ?? 'KG',
            buyRate: it.buyRate ?? 0,
            sellRate: it.sellRate ?? 0,
            notes: it.notes ?? undefined,
          })),
        } : undefined,
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, urduName: true, category: true } } } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return res.status(201).json({ success: true, data: list });
  } catch (err: any) {
    console.error('Error in POST /api/pricelist:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create price list' });
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
          include: { product: { select: { id: true, name: true, urduName: true, category: true } } },
          orderBy: { itemName: 'asc' },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!list) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, data: list });
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

    await prisma.priceList.update({
      where: { id },
      data: {
        ...(notes !== undefined ? { notes } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    if (items && Array.isArray(items)) {
      for (const item of items) {
        await prisma.priceItem.upsert({
          where: { priceListId_itemName: { priceListId: id, itemName: item.itemName } },
          update: {
            buyRate: item.buyRate ?? 0,
            sellRate: item.sellRate ?? 0,
            unit: item.unit ?? 'KG',
            notes: item.notes ?? undefined,
            productId: item.productId ?? undefined,
          },
          create: {
            priceListId: id,
            itemName: item.itemName,
            productId: item.productId ?? undefined,
            unit: item.unit ?? 'KG',
            buyRate: item.buyRate ?? 0,
            sellRate: item.sellRate ?? 0,
            notes: item.notes ?? undefined,
          },
        });
      }
    }

    const updated = await prisma.priceList.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true, urduName: true } } }, orderBy: { itemName: 'asc' } },
      },
    });

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
    return res.json({ success: true, message: 'Price list deactivated' });
  } catch (err: any) {
    console.error('Error in DELETE /api/pricelist/:id:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to delete price list' });
  }
});

export default router;
