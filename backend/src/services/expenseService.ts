import prisma from '../lib/prisma';
import { writeAuditLog, getValidUserId } from '../lib/business';
import { parseInputDateToUtc } from '../lib/businessDate';
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

const VALID_CATEGORIES: string[] = [
  'TRANSPORT', 'LABOUR', 'FUEL', 'RENT', 'ELECTRICITY', 'PACKAGING',
  'VEHICLE', 'SALARY', 'MISC', 'PURCHASE', 'INVENTORY_WASTAGE', 'OFFICE',
  'MAINTENANCE', 'MARKETING', 'BAD_DEBT', 'TAX', 'BANK_CHARGES', 'EQUIPMENT', 'REPAIR'
];

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
          date: date ? parseInputDateToUtc(date) : new Date(),
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
    }, { maxWait: 10000, timeout: 30000 });
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
    }, { maxWait: 10000, timeout: 30000 });
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
    }, { maxWait: 10000, timeout: 30000 });
  }

  /**
   * Compute dynamic summary metrics & category-wise expense breakdown directly from the database across all ERP modules.
   */
  static async getExpenseSummary(branchId: string, fromDate?: Date, toDate?: Date) {
    const bWhere = branchId ? { branchId, deletedAt: null } : { deletedAt: null };
    const dateFilter = fromDate || toDate ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } : undefined;

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
      purchasesAgg,
      salesAgg,
      wastageList,
      salariesAgg,
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
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { amount: true }, _count: true,
      }),
      prisma.expense.aggregate({
        where: {
          ...bWhere, paidBy: 'CASH',
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: {
          ...bWhere, paidBy: 'BANK',
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: {
          ...bWhere, paidBy: 'ONLINE',
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ['category'],
        where: {
          ...bWhere,
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { amount: true },
        _count: true,
      }),
      // Automated Sources Aggregations
      prisma.purchase.aggregate({
        where: {
          ...(branchId ? { branchId } : {}),
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { total: true, transportCost: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: {
          ...(branchId ? { branchId } : {}),
          status: { not: 'CANCELLED' },
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { total: true },
        _count: true,
      }),
      prisma.wastage.findMany({
        where: {
          ...(branchId ? { branchId } : {}),
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        include: {
          product: {
            include: {
              inventory: branchId ? { where: { branchId } } : true,
            },
          },
        },
      }),
      prisma.employee.aggregate({
        where: {
          isActive: true,
        },
        _sum: { salary: true },
        _count: true,
      }),
    ]);

    // Calculate wastage financial loss
    const wastageLoss = wastageList.reduce((sum, w) => {
      const inv = w.product?.inventory?.[0];
      const cost = (inv?.avgCost && inv.avgCost > 0) ? inv.avgCost : (inv?.currentBuyPrice ?? 0);
      return sum + (w.qty * cost);
    }, 0);

    const manualExpensesTotal = totalAgg._sum.amount ?? 0;
    const purchasesTotal = purchasesAgg._sum.total ?? 0;
    const purchasesTransport = purchasesAgg._sum.transportCost ?? 0;
    const salariesTotal = salariesAgg._sum?.salary ?? 0;
    const totalRevenue = salesAgg._sum.total ?? 0;

    const totalBusinessExpenses = manualExpensesTotal + purchasesTotal + wastageLoss + salariesTotal;
    const grossProfit = totalRevenue - purchasesTotal;
    const operatingCost = manualExpensesTotal + purchasesTransport + salariesTotal;
    const netProfit = grossProfit - (manualExpensesTotal + wastageLoss + salariesTotal);

    // Build unified category breakdown
    const categoryBreakdown: any[] = categoryGroup.map((item) => ({
      category: item.category,
      total: item._sum.amount ?? 0,
      count: item._count,
    }));

    if (purchasesTotal > 0) {
      categoryBreakdown.push({
        category: 'PURCHASE',
        total: purchasesTotal,
        count: purchasesAgg._count ?? 0,
      });
    }

    if (wastageLoss > 0) {
      categoryBreakdown.push({
        category: 'INVENTORY_WASTAGE',
        total: wastageLoss,
        count: wastageList.length,
      });
    }

    if (salariesTotal > 0) {
      categoryBreakdown.push({
        category: 'SALARY',
        total: salariesTotal,
        count: (salariesAgg._count && typeof salariesAgg._count === 'number') ? salariesAgg._count : 0,
      });
    }

    return {
      today: todayAgg._sum.amount ?? 0,
      todayCount: todayAgg._count ?? 0,
      thisWeek: weekAgg._sum.amount ?? 0,
      thisWeekCount: weekAgg._count ?? 0,
      thisMonth: monthAgg._sum.amount ?? 0,
      thisMonthCount: monthAgg._count ?? 0,
      total: manualExpensesTotal,
      totalCount: totalAgg._count ?? 0,
      cash: cashAgg._sum.amount ?? 0,
      bank: bankAgg._sum.amount ?? 0,
      online: onlineAgg._sum.amount ?? 0,
      // Automated Cross-Module Analytics
      purchasesTotal,
      purchasesCount: purchasesAgg._count ?? 0,
      purchasesTransport,
      wastageLoss,
      wastageCount: wastageList.length,
      salariesTotal,
      salariesCount: salariesAgg._count ?? 0,
      totalRevenue,
      salesCount: salesAgg._count ?? 0,
      grossProfit,
      netProfit,
      operatingCost,
      totalBusinessExpenses,
      categoryBreakdown,
    };
  }

  /**
   * Get integrated timeline of all financial outflows across the ERP
   */
  static async getIntegratedExpenses(branchId: string, fromDate?: Date, toDate?: Date) {
    const bWhere = branchId ? { branchId, deletedAt: null } : { deletedAt: null };
    const dateFilter = fromDate || toDate ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } : undefined;

    const [manualExpenses, purchases, wastages] = await Promise.all([
      prisma.expense.findMany({
        where: {
          ...bWhere,
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        include: {
          vehicle: { select: { id: true, plateNo: true, type: true } },
          employee: { select: { id: true, name: true, employeeId: true, role: true } },
          supplier: { select: { id: true, name: true, phone: true } },
          cashAccount: { select: { id: true, name: true, balance: true } },
          bankAccount: { select: { id: true, name: true, bankName: true, accountNo: true, balance: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.purchase.findMany({
        where: {
          ...(branchId ? { branchId } : {}),
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items: true,
        },
        orderBy: { date: 'desc' },
      }),
      prisma.wastage.findMany({
        where: {
          ...(branchId ? { branchId } : {}),
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        include: {
          product: {
            include: {
              inventory: branchId ? { where: { branchId } } : true,
            },
          },
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const integrated: any[] = [];

    // 1. Manual Expenses
    manualExpenses.forEach((exp) => {
      integrated.push({
        id: exp.id,
        source: 'MANUAL',
        reference: exp.reference || `EXP-${exp.id.slice(-6).toUpperCase()}`,
        category: exp.category,
        amount: exp.amount,
        date: exp.date.toISOString(),
        description: exp.description || 'Manual Expense',
        paidBy: exp.paidBy || 'CASH',
        accountName: exp.paidBy === 'CASH' ? (exp.cashAccount?.name ?? 'Main Cash') : (exp.bankAccount?.name ?? 'Bank Account'),
        entityName: exp.vehicle ? `🚚 ${exp.vehicle.plateNo}` : exp.employee ? `💼 ${exp.employee.name}` : exp.supplier ? `🏪 ${exp.supplier.name}` : null,
      });
    });

    // 2. Purchases as Automated Purchase Expenses
    purchases.forEach((p) => {
      integrated.push({
        id: p.id,
        source: 'PURCHASE',
        reference: `PUR-${p.id.slice(-6).toUpperCase()}`,
        category: 'PURCHASE',
        amount: p.total,
        date: p.date.toISOString(),
        description: `Mandi / Supplier Purchase (${p.items?.length ?? 0} items)`,
        paidBy: p.paid > 0 ? 'CASH/CREDIT' : 'CREDIT',
        accountName: p.supplier?.name ?? 'Supplier',
        entityName: p.supplier?.name ? `🏪 ${p.supplier.name}` : null,
      });
    });

    // 3. Inventory Wastage Losses
    wastages.forEach((w) => {
      const inv = w.product?.inventory?.[0];
      const cost = (inv?.avgCost && inv.avgCost > 0) ? inv.avgCost : (inv?.currentBuyPrice ?? 0);
      const lossAmount = w.qty * cost;
      integrated.push({
        id: w.id,
        source: 'INVENTORY_WASTAGE',
        reference: `WAST-${w.id.slice(-6).toUpperCase()}`,
        category: 'INVENTORY_WASTAGE',
        amount: lossAmount,
        date: w.date.toISOString(),
        description: `Wastage Loss: ${w.product?.name ?? 'Product'} (${w.qty} ${w.product?.defaultUnit ?? 'KG'})`,
        paidBy: 'STOCK_LOSS',
        accountName: 'Inventory Asset Loss',
        entityName: w.reason ? `⚠️ ${w.reason}` : null,
      });
    });

    // Sort timeline descending by date
    integrated.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return integrated;
  }
}
