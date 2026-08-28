import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// ── In-Memory cache for bank accounts (30s TTL) ─────────────────────────────
const BANK_ACCOUNT_CACHE = new Map<string, { ts: number; data: any }>();
const BANK_ACCOUNT_CACHE_TTL = 30000;

export function clearBankAccountCache(): void {
  BANK_ACCOUNT_CACHE.clear();
}

// GET /api/bank-accounts
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branchId' });

    const cached = BANK_ACCOUNT_CACHE.get(branchId);
    if (cached && (Date.now() - cached.ts) < BANK_ACCOUNT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    let bankAccounts = await prisma.bankAccount.findMany({
      where: { branchId },
      orderBy: { createdAt: 'asc' },
    });

    // Auto-create default Main Bank Account if none exists for branch
    if (bankAccounts.length === 0) {
      const defaultBank = await prisma.bankAccount.create({
        data: {
          name: 'Main Business Bank Account',
          bankName: 'Meezan Bank',
          accountNo: '010101010101',
          balance: 0,
          branchId,
        },
      });
      bankAccounts = [defaultBank];
    }

    BANK_ACCOUNT_CACHE.set(branchId, { ts: Date.now(), data: bankAccounts });
    res.setHeader('X-Cache', 'MISS');
    return res.json({ success: true, data: bankAccounts });
  } catch (err: any) {
    console.error('Error in GET /api/bank-accounts:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load bank accounts', data: [] });
  }
});

export default router;
