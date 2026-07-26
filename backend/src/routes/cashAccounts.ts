import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/cash-accounts
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branchId' });

    let cashAccounts = await prisma.cashAccount.findMany({
      where: { branchId },
      orderBy: { createdAt: 'asc' },
    });

    // Auto-create default Main Cash account if none exists for branch
    if (cashAccounts.length === 0) {
      const defaultCash = await prisma.cashAccount.create({
        data: {
          name: 'Main Cash Account',
          balance: 0,
          branchId,
        },
      });
      cashAccounts = [defaultCash];
    }

    return res.json({ success: true, data: cashAccounts });
  } catch (err: any) {
    console.error('Error in GET /api/cash-accounts:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load cash accounts', data: [] });
  }
});

export default router;
