import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/drivers
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const drivers = await prisma.driver.findMany({
      where: { ...(branchId ? { branchId } : {}), isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ success: true, data: drivers });
  } catch (err: any) {
    console.error('Error fetching drivers:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load drivers', data: [] });
  }
});

export default router;
