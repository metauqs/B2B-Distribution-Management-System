import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';

const router = Router();

// GET /api/expenses/summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { from, to } = req.query;
    const fromDate = from ? new Date(String(from)) : undefined;
    const toDate = to ? new Date(String(to)) : undefined;

    const summary = await ExpenseService.getExpenseSummary(branchId, fromDate, toDate);
    return res.json({ success: true, data: summary });
  } catch (err: any) {
    console.error('Error in GET /api/expenses/summary:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load expense summary' });
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

    let dateFrom: Date | undefined = from ? new Date(String(from)) : undefined;
    let dateTo: Date | undefined = to ? new Date(String(to)) : undefined;

    // Range helpers
    if (range) {
      const now = new Date();
      if (range === 'today') {
        dateFrom = new Date(now.setHours(0, 0, 0, 0));
        dateTo = new Date(now.setHours(23, 59, 59, 999));
      } else if (range === 'yesterday') {
        const yest = new Date(now.setDate(now.getDate() - 1));
        dateFrom = new Date(yest.setHours(0, 0, 0, 0));
        dateTo = new Date(yest.setHours(23, 59, 59, 999));
      } else if (range === 'this_week') {
        const day = now.getDay();
        const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1);
        dateFrom = new Date(now.setDate(diffToMon));
        dateFrom.setHours(0, 0, 0, 0);
        dateTo = new Date();
        dateTo.setHours(23, 59, 59, 999);
      } else if (range === 'this_month') {
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFrom.setHours(0, 0, 0, 0);
        dateTo = new Date();
        dateTo.setHours(23, 59, 59, 999);
      }
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

    const expenses = await prisma.expense.findMany({
      where,
      include: {
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

    return res.json({ success: true, data: expenses });
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
      include: {
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

    return res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (err: any) {
    console.error('Error in DELETE /api/expenses/:id:', err);
    return res.status(400).json({ success: false, error: err.message ?? 'Failed to delete expense' });
  }
});

export default router;
