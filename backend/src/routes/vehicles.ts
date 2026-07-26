import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/vehicles
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
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

    const enrichedVehicles = vehicles.map((v) => ({
      ...v,
      expensesSummary: vehicleExpenseMap[v.id] || { fuelCost: 0, maintenanceCost: 0, transportCost: 0, totalExpense: 0 },
    }));

    return res.json({ success: true, data: enrichedVehicles });
  } catch (err: any) {
    console.error('Error fetching vehicles:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load vehicles', data: [] });
  }
});

export default router;
