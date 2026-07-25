import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/vehicles
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const vehicles = await prisma.vehicle.findMany({
      where: { ...(branchId ? { branchId } : {}), isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ success: true, data: vehicles });
  } catch (err: any) {
    console.error('Error fetching vehicles:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load vehicles', data: [] });
  }
});

export default router;
