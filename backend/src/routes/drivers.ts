import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// ── In-Memory cache for drivers (30s TTL) ──────────────────────────────────
const DRIVER_CACHE = new Map<string, { ts: number; data: any }>();
const DRIVER_CACHE_TTL = 30000;
const DRIVER_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearDriverCache(): void {
  DRIVER_CACHE.clear();
  DRIVER_IN_FLIGHT.clear();
}

// GET /api/drivers
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = branchId || 'all';

    const cached = DRIVER_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < DRIVER_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (DRIVER_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await DRIVER_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchDriversPromise = prisma.driver.findMany({
      where: { ...(branchId ? { branchId } : {}), isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    DRIVER_IN_FLIGHT.set(cacheKey, fetchDriversPromise);
    try {
      const drivers = await fetchDriversPromise;
      if (DRIVER_CACHE.size >= 50) DRIVER_CACHE.clear();
      DRIVER_CACHE.set(cacheKey, { ts: Date.now(), data: drivers });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: drivers });
    } finally {
      DRIVER_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error fetching drivers:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load drivers', data: [] });
  }
});

export default router;
