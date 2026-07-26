import prisma from '../lib/prisma';
import { writeAuditLog, getValidUserId } from '../lib/business';
import { ExpenseCategory, PaymentMethod } from '@prisma/client';

export interface CreateExpenseInput {
  category: string;
  amount: number;
  date?: string | Date;
  description?: string;
  reference?: string;
  paidBy?: string;
  cashAccountId?: string;
  bankAccountId?: string;
  vehicleId?: string;
  employeeId?: string;
  supplierId?: string;
  notes?: string;
  branchId: string;
  userId?: string;
}

export interface UpdateExpenseInput {
  category?: string;
  amount?: number;
  date?: string | Date;
  description?: string;
  reference?: string;
  paidBy?: string;
  cashAccountId?: string;
  bankAccountId?: string;
  vehicleId?: string;
  employeeId?: string;
  supplierId?: string;
  notes?: string;
}

const VALID_CATEGORIES: string[] = ['TRANSPORT', 'LABOUR', 'FUEL', 'RENT', 'ELECTRICITY', 'PACKAGING', 'VEHICLE', 'SALARY', 'MISC'];

export class ExpenseService {
  /**
   * Helper to format reference numbers like EXP-20260726-0001
   */
  private static async generateExpenseReference(branchId: string, tx: any): Promise<string> {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await tx.expense.count({
      where: { branchId },
    });
    return `EXP-${todayStr}-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Create Expense inside a Prisma database transaction with balance adjustment and audit logging.
   */
  static async createExpense(input: CreateExpenseInput) {
    const {
      category,
      amount,
      date,
      description,
      reference,
      paidBy,
      cashAccountId,
      bankAccountId,
      vehicleId,
      employeeId,
      supplierId,
      notes,
      branchId,
      userId,
    } = input;

    if (!category || !amount || amount <= 0) {
      throw new Error('Valid expense category and positive amount are required');
    }

    if (!branchId) {
      throw new Error('Branch ID is required');
    }

    const catUpper = category.toUpperCase();
    const validCategory = (VALID_CATEGORIES.includes(catUpper) ? catUpper : 'MISC') as ExpenseCategory;
    const paymentMethod = paidBy ? (paidBy.toUpperCase() as PaymentMethod) : undefined;

    return await prisma.$transaction(async (tx) => {
      const validUserId = await getValidUserId(userId, tx);
      const expRef = reference || (await this.generateExpenseReference(branchId, tx));

      // 1. Account Balance Deductions
      if (paymentMethod === 'CASH' && cashAccountId) {
        const cashAcc = await tx.cashAccount.findUnique({ where: { id: cashAccountId } });
        if (!cashAcc) throw new Error('Selected Cash Account not found');
        
        await tx.cashAccount.update({
          where: { id: cashAccountId },
          data: { balance: cashAcc.balance - amount },
        });
      } else if ((paymentMethod === 'BANK' || paymentMethod === 'ONLINE') && bankAccountId) {
        const bankAcc = await tx.bankAccount.findUnique({ where: { id: bankAccountId } });
        if (!bankAcc) throw new Error('Selected Bank Account not found');

        await tx.bankAccount.update({
          where: { id: bankAccountId },
          data: { balance: bankAcc.balance - amount },
        });
      }

      // 2. Create Expense
      const expense = await tx.expense.create({
        data: {
          reference: expRef,
          category: validCategory,
          amount,
          date: date ? new Date(date) : new Date(),
          description: description || undefined,
          paidBy: paymentMethod || undefined,
          cashAccountId: paymentMethod === 'CASH' ? cashAccountId : undefined,
          bankAccountId: (paymentMethod === 'BANK' || paymentMethod === 'ONLINE') ? bankAccountId : undefined,
          vehicleId: vehicleId || undefined,
          employeeId: employeeId || undefined,
          supplierId: supplierId || undefined,
          createdById: validUserId || undefined,
          notes: notes || undefined,
          branchId,
        },
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

      // 3. Audit Log
      await writeAuditLog({
        userId: validUserId,
        branchId,
        action: 'CREATE',
        entity: 'Expense',
        entityId: expense.id,
        newData: {
          reference: expRef,
          category: validCategory,
          amount,
          paidBy: paymentMethod,
          cashAccountId,
          bankAccountId,
        },
      });

      return expense;
    });
  }

  /**
   * Update Expense inside a Prisma transaction with balance reversals and new balance adjustments.
   */
  static async updateExpense(id: string, input: UpdateExpenseInput, branchId: string, userId?: string) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findFirst({
        where: { id, branchId, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Expense record not found or has been deleted');
      }

      const validUserId = await getValidUserId(userId, tx);

      // New values
      const newCategory = input.category ? (input.category.toUpperCase() as ExpenseCategory) : existing.category;
      const newAmount = input.amount !== undefined && input.amount > 0 ? input.amount : existing.amount;
      const newDate = input.date ? new Date(input.date) : existing.date;
      const newPaidBy = input.paidBy !== undefined ? (input.paidBy.toUpperCase() as PaymentMethod) : existing.paidBy;
      const newCashAccId = newPaidBy === 'CASH' ? (input.cashAccountId !== undefined ? input.cashAccountId : existing.cashAccountId) : null;
      const newBankAccId = (newPaidBy === 'BANK' || newPaidBy === 'ONLINE') ? (input.bankAccountId !== undefined ? input.bankAccountId : existing.bankAccountId) : null;

      // 1. REVERSE PREVIOUS FINANCIAL BALANCE IMPACT
      if (existing.paidBy === 'CASH' && existing.cashAccountId) {
        const prevCash = await tx.cashAccount.findUnique({ where: { id: existing.cashAccountId } });
        if (prevCash) {
          await tx.cashAccount.update({
            where: { id: existing.cashAccountId },
            data: { balance: prevCash.balance + existing.amount },
          });
        }
      } else if ((existing.paidBy === 'BANK' || existing.paidBy === 'ONLINE') && existing.bankAccountId) {
        const prevBank = await tx.bankAccount.findUnique({ where: { id: existing.bankAccountId } });
        if (prevBank) {
          await tx.bankAccount.update({
            where: { id: existing.bankAccountId },
            data: { balance: prevBank.balance + existing.amount },
          });
        }
      }

      // 2. APPLY NEW FINANCIAL BALANCE IMPACT
      if (newPaidBy === 'CASH' && newCashAccId) {
        const newCash = await tx.cashAccount.findUnique({ where: { id: newCashAccId } });
        if (!newCash) throw new Error('Selected Cash Account not found');
        await tx.cashAccount.update({
          where: { id: newCashAccId },
          data: { balance: newCash.balance - newAmount },
        });
      } else if ((newPaidBy === 'BANK' || newPaidBy === 'ONLINE') && newBankAccId) {
        const newBank = await tx.bankAccount.findUnique({ where: { id: newBankAccId } });
        if (!newBank) throw new Error('Selected Bank Account not found');
        await tx.bankAccount.update({
          where: { id: newBankAccId },
          data: { balance: newBank.balance - newAmount },
        });
      }

      // 3. UPDATE EXPENSE
      const updated = await tx.expense.update({
        where: { id },
        data: {
          category: newCategory,
          amount: newAmount,
          date: newDate,
          description: input.description !== undefined ? input.description : existing.description,
          reference: input.reference !== undefined ? input.reference : existing.reference,
          paidBy: newPaidBy || undefined,
          cashAccountId: newCashAccId,
          bankAccountId: newBankAccId,
          vehicleId: input.vehicleId !== undefined ? input.vehicleId : existing.vehicleId,
          employeeId: input.employeeId !== undefined ? input.employeeId : existing.employeeId,
          supplierId: input.supplierId !== undefined ? input.supplierId : existing.supplierId,
          notes: input.notes !== undefined ? input.notes : existing.notes,
        },
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

      // 4. AUDIT LOG
      await writeAuditLog({
        userId: validUserId,
        branchId,
        action: 'UPDATE',
        entity: 'Expense',
        entityId: id,
        oldData: {
          category: existing.category,
          amount: existing.amount,
          paidBy: existing.paidBy,
          cashAccountId: existing.cashAccountId,
          bankAccountId: existing.bankAccountId,
        },
        newData: {
          category: newCategory,
          amount: newAmount,
          paidBy: newPaidBy,
          cashAccountId: newCashAccId,
          bankAccountId: newBankAccId,
        },
      });

      return updated;
    });
  }

  /**
   * Soft Delete Expense inside a transaction after reversing financial balance impact.
   */
  static async deleteExpense(id: string, branchId: string, userId?: string) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findFirst({
        where: { id, branchId, deletedAt: null },
      });

      if (!existing) {
        throw new Error('Expense record not found or already deleted');
      }

      const validUserId = await getValidUserId(userId, tx);

      // 1. REVERSE FINANCIAL BALANCE IMPACT
      if (existing.paidBy === 'CASH' && existing.cashAccountId) {
        const cashAcc = await tx.cashAccount.findUnique({ where: { id: existing.cashAccountId } });
        if (cashAcc) {
          await tx.cashAccount.update({
            where: { id: existing.cashAccountId },
            data: { balance: cashAcc.balance + existing.amount },
          });
        }
      } else if ((existing.paidBy === 'BANK' || existing.paidBy === 'ONLINE') && existing.bankAccountId) {
        const bankAcc = await tx.bankAccount.findUnique({ where: { id: existing.bankAccountId } });
        if (bankAcc) {
          await tx.bankAccount.update({
            where: { id: existing.bankAccountId },
            data: { balance: bankAcc.balance + existing.amount },
          });
        }
      }

      // 2. SOFT DELETE
      await tx.expense.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      // 3. AUDIT LOG
      await writeAuditLog({
        userId: validUserId,
        branchId,
        action: 'DELETE',
        entity: 'Expense',
        entityId: id,
        oldData: {
          category: existing.category,
          amount: existing.amount,
          paidBy: existing.paidBy,
        },
      });

      return true;
    });
  }

  /**
   * Compute dynamic summary metrics & category-wise expense breakdown directly from the database.
   */
  static async getExpenseSummary(branchId: string, fromDate?: Date, toDate?: Date) {
    const bWhere = branchId ? { branchId, deletedAt: null } : { deletedAt: null };

    // Today range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // This Week range (Monday to today)
    const now = new Date();
    const day = now.getDay();
    const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(now.setDate(diffToMon));
    weekStart.setHours(0, 0, 0, 0);

    // This Month range
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      todayAgg,
      weekAgg,
      monthAgg,
      totalAgg,
      cashAgg,
      bankAgg,
      onlineAgg,
      categoryGroup,
    ] = await Promise.all([
      prisma.expense.aggregate({
        where: { ...bWhere, date: { gte: todayStart, lte: todayEnd } },
        _sum: { amount: true }, _count: true,
      }),
      prisma.expense.aggregate({
        where: { ...bWhere, date: { gte: weekStart } },
        _sum: { amount: true }, _count: true,
      }),
      prisma.expense.aggregate({
        where: { ...bWhere, date: { gte: monthStart } },
        _sum: { amount: true }, _count: true,
      }),
      prisma.expense.aggregate({
        where: {
          ...bWhere,
          ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
        },
        _sum: { amount: true }, _count: true,
      }),
      prisma.expense.aggregate({
        where: {
          ...bWhere, paidBy: 'CASH',
          ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: {
          ...bWhere, paidBy: 'BANK',
          ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: {
          ...bWhere, paidBy: 'ONLINE',
          ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ['category'],
        where: {
          ...bWhere,
          ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}),
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const categoryBreakdown = categoryGroup.map((item) => ({
      category: item.category,
      total: item._sum.amount ?? 0,
      count: item._count,
    }));

    return {
      today: todayAgg._sum.amount ?? 0,
      todayCount: todayAgg._count ?? 0,
      thisWeek: weekAgg._sum.amount ?? 0,
      thisWeekCount: weekAgg._count ?? 0,
      thisMonth: monthAgg._sum.amount ?? 0,
      thisMonthCount: monthAgg._count ?? 0,
      total: totalAgg._sum.amount ?? 0,
      totalCount: totalAgg._count ?? 0,
      cash: cashAgg._sum.amount ?? 0,
      bank: bankAgg._sum.amount ?? 0,
      online: onlineAgg._sum.amount ?? 0,
      categoryBreakdown,
    };
  }
}
