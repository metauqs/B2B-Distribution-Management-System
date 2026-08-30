import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { getBusinessDateRange, getCurrentBusinessDateRange, getBusinessDatePresetRange } from '../lib/businessDate';

const router = Router();

// ── In-Memory cache for expenses and summaries (20s TTL) ────────────────────
const EXPENSE_CACHE = new Map<string, { ts: number; data: any }>();
const EXPENSE_CACHE_TTL = 120000;
const EXPENSE_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearExpenseCache(): void {
  EXPENSE_CACHE.clear();
  EXPENSE_IN_FLIGHT.clear();
}

// GET /api/expenses/summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { from, to, range } = req.query;
    const cacheKey = `summary_${branchId}_${from || 'none'}_${to || 'none'}_${range || 'none'}`;
    const cached = EXPENSE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < EXPENSE_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (EXPENSE_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await EXPENSE_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchSummaryPromise = (async () => {
      const fromDate = from ? getBusinessDateRange(String(from)).start : undefined;
      const toDate = to ? getBusinessDateRange(String(to)).end : undefined;
      return await ExpenseService.getExpenseSummary(branchId, fromDate, toDate);
    })();

    EXPENSE_IN_FLIGHT.set(cacheKey, fetchSummaryPromise);
    try {
      const summary = await fetchSummaryPromise;
      if (EXPENSE_CACHE.size > 50) EXPENSE_CACHE.clear();
      EXPENSE_CACHE.set(cacheKey, { ts: Date.now(), data: summary });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: summary });
    } finally {
      EXPENSE_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/expenses/summary:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load expense summary' });
  }
});

// GET /api/expenses/integrated
router.get('/integrated', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { from, to, range } = req.query;
    const cacheKey = `integrated_${branchId}_${from || 'none'}_${to || 'none'}_${range || 'none'}`;
    const cached = EXPENSE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < EXPENSE_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (EXPENSE_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await EXPENSE_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchIntegratedPromise = (async () => {
      const fromDate = from ? getBusinessDateRange(String(from)).start : undefined;
      const toDate = to ? getBusinessDateRange(String(to)).end : undefined;
      return await ExpenseService.getIntegratedExpenses(branchId, fromDate, toDate);
    })();

    EXPENSE_IN_FLIGHT.set(cacheKey, fetchIntegratedPromise);
    try {
      const integrated = await fetchIntegratedPromise;
      if (EXPENSE_CACHE.size > 50) EXPENSE_CACHE.clear();
      EXPENSE_CACHE.set(cacheKey, { ts: Date.now(), data: integrated });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: integrated });
    } finally {
      EXPENSE_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/expenses/integrated:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load integrated expenses' });
  }
});

// GET /api/expenses
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const {
      from, to, range, category, paidBy, cashAccountId, bankAccountId,
      employeeId, vehicleId, supplierId, search,
    } = req.query;

    const cacheKey = `list_${branchId || 'all'}_${from || ''}_${to || ''}_${range || ''}_${category || ''}_${paidBy || ''}_${cashAccountId || ''}_${bankAccountId || ''}_${employeeId || ''}_${vehicleId || ''}_${supplierId || ''}_${search || ''}`;
    const cached = EXPENSE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < EXPENSE_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (EXPENSE_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await EXPENSE_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchExpensesPromise = (async () => {
      let dateFrom: Date | undefined = from ? getBusinessDateRange(String(from)).start : undefined;
      let dateTo: Date | undefined = to ? getBusinessDateRange(String(to)).end : undefined;

      // Range helpers
      if (range) {
        const presetRange = getBusinessDatePresetRange(String(range));
        dateFrom = presetRange.start;
        dateTo = presetRange.end;
      }

      const where: any = {
        ...(branchId ? { branchId } : {}),
        deletedAt: null,
        ...(dateFrom || dateTo ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
        ...(category && category !== 'ALL' && category !== 'all' ? { category: String(category).toUpperCase() } : {}),
        ...(paidBy && paidBy !== 'ALL' && paidBy !== 'all' ? { paidBy: String(paidBy).toUpperCase() } : {}),
        ...(cashAccountId && cashAccountId !== 'ALL' ? { cashAccountId: String(cashAccountId) } : {}),
        ...(bankAccountId && bankAccountId !== 'ALL' ? { bankAccountId: String(bankAccountId) } : {}),
        ...(employeeId && employeeId !== 'ALL' ? { employeeId: String(employeeId) } : {}),
        ...(vehicleId && vehicleId !== 'ALL' ? { vehicleId: String(vehicleId) } : {}),
        ...(supplierId && supplierId !== 'ALL' ? { supplierId: String(supplierId) } : {}),
      };

      if (search && String(search).trim()) {
        const q = String(search).trim();
        where.OR = [
          { description: { contains: q, mode: 'insensitive' } },
          { reference: { contains: q, mode: 'insensitive' } },
          { notes: { contains: q, mode: 'insensitive' } },
        ];
      }

      return await prisma.expense.findMany({
        where,
        select: {
          id: true,
          reference: true,
          category: true,
          categoryRefId: true,
          description: true,
          amount: true,
          date: true,
          paidBy: true,
          notes: true,
          branchId: true,
          createdAt: true,
          vehicle: { select: { id: true, plateNo: true, type: true } },
          employee: { select: { id: true, name: true, employeeId: true, role: true } },
          supplier: { select: { id: true, name: true, phone: true } },
          cashAccount: { select: { id: true, name: true, balance: true } },
          bankAccount: { select: { id: true, name: true, bankName: true, accountNo: true, balance: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        take: 200,
      });
    })();

    EXPENSE_IN_FLIGHT.set(cacheKey, fetchExpensesPromise);
    try {
      const expenses = await fetchExpensesPromise;
      if (EXPENSE_CACHE.size > 50) EXPENSE_CACHE.clear();
      EXPENSE_CACHE.set(cacheKey, { ts: Date.now(), data: expenses });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: expenses });
    } finally {
      EXPENSE_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/expenses:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load expenses' });
  }
});

// GET /api/expenses/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { id } = req.params;

    const expense = await prisma.expense.findFirst({
      where: { id, ...(branchId ? { branchId } : {}), deletedAt: null },
      select: {
        id: true,
        reference: true,
        category: true,
        categoryRefId: true,
        description: true,
        amount: true,
        date: true,
        paidBy: true,
        notes: true,
        branchId: true,
        createdAt: true,
        vehicle: { select: { id: true, plateNo: true, type: true } },
        employee: { select: { id: true, name: true, employeeId: true, role: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        cashAccount: { select: { id: true, name: true, balance: true } },
        bankAccount: { select: { id: true, name: true, bankName: true, accountNo: true, balance: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    if (!expense) return res.status(404).json({ success: false, error: 'Expense record not found' });
    return res.json({ success: true, data: expense });
  } catch (err: any) {
    console.error('Error in GET /api/expenses/:id:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load expense details' });
  }
});

// POST /api/expenses
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const expense = await ExpenseService.createExpense({
      ...req.body,
      branchId,
      userId,
    });

    clearExpenseCache();
    return res.status(201).json({ success: true, data: expense });
  } catch (err: any) {
    console.error('Error in POST /api/expenses:', err);
    return res.status(400).json({ success: false, error: err.message ?? 'Failed to save expense' });
  }
});

// PUT /api/expenses/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { id } = req.params;
    const updated = await ExpenseService.updateExpense(id, req.body, branchId, userId);

    clearExpenseCache();
    return res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('Error in PUT /api/expenses/:id:', err);
    return res.status(400).json({ success: false, error: err.message ?? 'Failed to update expense' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { id } = req.params;
    await ExpenseService.deleteExpense(id, branchId, userId);

    clearExpenseCache();
    return res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (err: any) {
    console.error('Error in DELETE /api/expenses/:id:', err);
    return res.status(400).json({ success: false, error: err.message ?? 'Failed to delete expense' });
  }
});

export default router;
