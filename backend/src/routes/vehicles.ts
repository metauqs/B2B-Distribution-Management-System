import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// ── In-Memory cache for vehicles (30s TTL) ─────────────────────────────────
const VEHICLE_CACHE = new Map<string, { ts: number; data: any }>();
const VEHICLE_CACHE_TTL = 30000;
const VEHICLE_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearVehicleCache(): void {
  VEHICLE_CACHE.clear();
  VEHICLE_IN_FLIGHT.clear();
}

// GET /api/vehicles
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = branchId || 'all';

    const cached = VEHICLE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < VEHICLE_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (VEHICLE_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await VEHICLE_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchVehiclesPromise = (async () => {
      const bWhere = branchId ? { branchId, isActive: true } : { isActive: true };

      const [vehicles, expenseGroup] = await Promise.all([
        prisma.vehicle.findMany({
          where: bWhere,
          include: { driver: { select: { id: true, name: true, phone: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.expense.groupBy({
          by: ['vehicleId', 'category'],
          where: { ...(branchId ? { branchId } : {}), deletedAt: null, vehicleId: { not: null } },
          _sum: { amount: true },
        }),
      ]);

      const vehicleExpenseMap: Record<string, { fuelCost: number; maintenanceCost: number; transportCost: number; totalExpense: number }> = {};

      expenseGroup.forEach((eg) => {
        if (!eg.vehicleId) return;
        if (!vehicleExpenseMap[eg.vehicleId]) {
          vehicleExpenseMap[eg.vehicleId] = { fuelCost: 0, maintenanceCost: 0, transportCost: 0, totalExpense: 0 };
        }
        const amt = eg._sum.amount ?? 0;
        vehicleExpenseMap[eg.vehicleId].totalExpense += amt;

        if (eg.category === 'FUEL') vehicleExpenseMap[eg.vehicleId].fuelCost += amt;
        else if (eg.category === 'VEHICLE') vehicleExpenseMap[eg.vehicleId].maintenanceCost += amt;
        else if (eg.category === 'TRANSPORT') vehicleExpenseMap[eg.vehicleId].transportCost += amt;
      });

      return vehicles.map((v) => ({
        ...v,
        expensesSummary: vehicleExpenseMap[v.id] || { fuelCost: 0, maintenanceCost: 0, transportCost: 0, totalExpense: 0 },
      }));
    })();

    VEHICLE_IN_FLIGHT.set(cacheKey, fetchVehiclesPromise);
    try {
      const enrichedVehicles = await fetchVehiclesPromise;
      if (VEHICLE_CACHE.size >= 50) VEHICLE_CACHE.clear();
      VEHICLE_CACHE.set(cacheKey, { ts: Date.now(), data: enrichedVehicles });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: enrichedVehicles });
    } finally {
      VEHICLE_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error fetching vehicles:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load vehicles', data: [] });
  }
});

export default router;
