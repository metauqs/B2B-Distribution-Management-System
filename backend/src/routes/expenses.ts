import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog } from '../lib/business';

const router = Router();
const VALID_CATEGORIES = ['TRANSPORT', 'LABOUR', 'FUEL', 'RENT', 'ELECTRICITY', 'PACKAGING', 'VEHICLE', 'SALARY', 'MISC'];

// GET /api/expenses
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { from, to } = req.query;
    const dateFrom = from ? new Date(String(from)) : undefined;
    const dateTo = to ? new Date(String(to)) : undefined;

    const expenses = await prisma.expense.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        deletedAt: null,
        ...(dateFrom || dateTo ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
      },
      include: { vehicle: { select: { id: true, plateNo: true } } },
      orderBy: { date: 'asc' },
      take: 100,
    });

    return res.json({ success: true, data: expenses });
  } catch (err: any) {
    console.error('Error in GET /api/expenses:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load expenses' });
  }
});

// POST /api/expenses
router.post('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;
  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const { category, description, amount, date, vehicleId } = req.body;

  if (!category || !amount || amount <= 0) {
    return res.status(400).json({ success: false, error: 'Category and amount are required' });
  }

  const validCategory = VALID_CATEGORIES.includes(category?.toUpperCase()) ? category.toUpperCase() : 'MISC';

  try {
    const expense = await prisma.expense.create({
      data: {
        category: validCategory as any,
        description: description ?? undefined,
        amount,
        date: date ? new Date(date) : new Date(),
        vehicleId: vehicleId ?? undefined,
        branchId,
      },
    });

    await writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Expense', entityId: expense.id, newData: { category, amount } });
    return res.status(201).json({ success: true, data: expense });
  } catch (err: any) {
    console.error('Error in POST /api/expenses:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to save expense' });
  }
});

export default router;
