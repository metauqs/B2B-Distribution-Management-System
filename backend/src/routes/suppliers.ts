import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// In-Memory cache for suppliers (60s TTL)
const SUPPLIER_CACHE = new Map<string, { ts: number; data: any }>();
const SUPPLIER_CACHE_TTL = 60000;
const SUPPLIER_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearSupplierCache(): void {
  SUPPLIER_CACHE.clear();
  SUPPLIER_IN_FLIGHT.clear();
}

// GET /api/suppliers
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = branchId || 'all';
    const cached = SUPPLIER_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < SUPPLIER_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (SUPPLIER_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await SUPPLIER_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchSuppliersPromise = (async () => {
      const [suppliers, purchasesArr, paymentsArr] = await Promise.all([
        prisma.supplier.findMany({
          where: { ...(branchId ? { branchId } : {}), deletedAt: null },
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
            openingBalance: true,
            branchId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.purchase.groupBy({
          by: ['supplierId'],
          where: { ...(branchId ? { branchId } : {}), deletedAt: null },
          _sum: { total: true },
        }),
        prisma.supplierPayment.groupBy({
          by: ['supplierId'],
          where: branchId ? { branchId } : {},
          _sum: { amount: true },
        }),
      ]);

      const purchMap = Object.fromEntries(purchasesArr.map(x => [x.supplierId, x._sum.total ?? 0]));
      const payMap = Object.fromEntries(paymentsArr.map(x => [x.supplierId, x._sum.amount ?? 0]));

      return suppliers.map(s => ({
        ...s,
        currentBalance: s.openingBalance + (purchMap[s.id] ?? 0) - (payMap[s.id] ?? 0),
      }));
    })();

    SUPPLIER_IN_FLIGHT.set(cacheKey, fetchSuppliersPromise);
    try {
      const data = await fetchSuppliersPromise;
      if (SUPPLIER_CACHE.size > 50) SUPPLIER_CACHE.clear();
      SUPPLIER_CACHE.set(cacheKey, { ts: Date.now(), data });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data });
    } finally {
      SUPPLIER_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error fetching suppliers:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load suppliers', data: [] });
  }
});

// POST /api/suppliers
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { name, phone, address, openingBalance } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });

    const supplier = await prisma.supplier.create({
      data: { name: name.trim(), phone, address, openingBalance: openingBalance ?? 0, branchId },
    });
    clearSupplierCache();
    return res.status(201).json({ success: true, data: supplier });
  } catch (err: any) {
    console.error('Error creating supplier:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create supplier' });
  }
});

export default router;
