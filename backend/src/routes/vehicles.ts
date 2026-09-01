import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// ── In-Memory cache for vehicles (30s TTL) ─────────────────────────────────
const VEHICLE_CACHE = new Map<string, { ts: number; data: any }>();
const VEHICLE_CACHE_TTL = 300000;
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
      const rawBranchId = branchId || '';
      const vehicles: any[] = await prisma.$queryRaw`
        WITH active_vehicles AS (
          SELECT 
            v.id,
            v."plateNo",
            v.type,
            v."branchId",
            v."driverId",
            v."isActive",
            v."createdAt"
          FROM vehicles v
          WHERE v."isActive" = true AND (${rawBranchId} = '' OR v."branchId" = ${rawBranchId})
          ORDER BY v."createdAt" ASC
        ),
        vehicle_exp AS (
          SELECT 
            e."vehicleId",
            SUM(e.amount)::float as "totalExpense",
            SUM(CASE WHEN e.category = 'FUEL' THEN e.amount ELSE 0 END)::float as "fuelCost",
            SUM(CASE WHEN e.category = 'VEHICLE' THEN e.amount ELSE 0 END)::float as "maintenanceCost",
            SUM(CASE WHEN e.category = 'TRANSPORT' THEN e.amount ELSE 0 END)::float as "transportCost"
          FROM expenses e
          WHERE e."deletedAt" IS NULL AND e."vehicleId" IN (SELECT id FROM active_vehicles)
          GROUP BY e."vehicleId"
        )
        SELECT 
          av.*,
          CASE WHEN d.id IS NOT NULL THEN json_build_object('id', d.id, 'name', d.name, 'phone', d.phone) ELSE NULL END as driver,
          json_build_object(
            'totalExpense', COALESCE(ve."totalExpense", 0)::float,
            'fuelCost', COALESCE(ve."fuelCost", 0)::float,
            'maintenanceCost', COALESCE(ve."maintenanceCost", 0)::float,
            'transportCost', COALESCE(ve."transportCost", 0)::float
          ) as "expensesSummary"
        FROM active_vehicles av
        LEFT JOIN drivers d ON d.id = av."driverId"
        LEFT JOIN vehicle_exp ve ON ve."vehicleId" = av.id
        ORDER BY av."createdAt" ASC
      `;

      return vehicles;
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
