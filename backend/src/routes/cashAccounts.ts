import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, getValidUserId } from '../lib/business';

const router = Router();

// ── In-Memory cache for cash accounts (30s TTL) ─────────────────────────────
const CASH_ACCOUNT_CACHE = new Map<string, { ts: number; data: any }>();
const CASH_ACCOUNT_CACHE_TTL = 30000;

export function clearCashAccountCache(): void {
  CASH_ACCOUNT_CACHE.clear();
}

// GET /api/cash-accounts
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branchId' });

    const cached = CASH_ACCOUNT_CACHE.get(branchId);
    if (cached && (Date.now() - cached.ts) < CASH_ACCOUNT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

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

    CASH_ACCOUNT_CACHE.set(branchId, { ts: Date.now(), data: cashAccounts });
    res.setHeader('X-Cache', 'MISS');
    return res.json({ success: true, data: cashAccounts });
  } catch (err: any) {
    console.error('Error in GET /api/cash-accounts:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load cash accounts', data: [] });
  }
});

// POST /api/cash-accounts/deposit (Add Daily Cash / Cash Injection)
router.post('/deposit', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branchId' });

    const { cashAccountId, amount, notes, description, date } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Deposit amount must be greater than zero' });
    }

    const depositAmount = Number(amount);

    const result = await prisma.$transaction(async (tx) => {
      const validUserId = await getValidUserId(userId, tx);

      // Find target cash account or fallback to first cash account for branch
      let cashAcc = cashAccountId
        ? await tx.cashAccount.findFirst({ where: { id: cashAccountId, branchId } })
        : await tx.cashAccount.findFirst({ where: { branchId }, orderBy: { createdAt: 'asc' } });

      if (!cashAcc) {
        cashAcc = await tx.cashAccount.create({
          data: {
            name: 'Main Cash Account',
            balance: 0,
            branchId,
          },
        });
      }

      const oldBalance = cashAcc.balance;
      const newBalance = oldBalance + depositAmount;

      const updated = await tx.cashAccount.update({
        where: { id: cashAcc.id },
        data: { balance: newBalance },
      });

      await writeAuditLog({
        userId: validUserId,
        branchId,
        action: 'UPDATE',
        entity: 'CashAccount',
        entityId: cashAcc.id,
        oldData: { balance: oldBalance },
        newData: {
          balance: newBalance,
          depositAmount,
          notes: notes || description || 'Daily Cash Deposit',
          date: date || new Date().toISOString(),
        },
      });

      return updated;
    }, { maxWait: 15000, timeout: 120000 });

    clearCashAccountCache();
    return res.status(200).json({
      success: true,
      message: `Successfully added Rs ${depositAmount.toLocaleString()} to ${result.name}`,
      data: result,
    });
  } catch (err: any) {
    console.error('Error in POST /api/cash-accounts/deposit:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to deposit cash' });
  }
});

// POST /api/cash-accounts (Create New Cash Account)
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branchId' });

    const { name, initialBalance } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Cash account name is required' });
    }

    const initBal = Number(initialBalance) || 0;

    const newAcc = await prisma.$transaction(async (tx) => {
      const validUserId = await getValidUserId(userId, tx);
      const acc = await tx.cashAccount.create({
        data: {
          name: String(name).trim(),
          balance: initBal,
          branchId,
        },
      });

      await writeAuditLog({
        userId: validUserId,
        branchId,
        action: 'CREATE',
        entity: 'CashAccount',
        entityId: acc.id,
        newData: { name: acc.name, balance: initBal },
      });

      return acc;
    }, { maxWait: 15000, timeout: 120000 });

    clearCashAccountCache();
    return res.status(201).json({ success: true, data: newAcc });
  } catch (err: any) {
    console.error('Error in POST /api/cash-accounts:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create cash account' });
  }
});

export default router;
