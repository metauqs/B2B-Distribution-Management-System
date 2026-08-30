import prisma from '../lib/prisma';
import { writeAuditLog, getValidUserId } from '../lib/business';
import { parseInputDateToUtc, getBusinessDateString, getCurrentBusinessDateRange, getBusinessDatePresetRange } from '../lib/businessDate';
import { ExpenseCategory, PaymentMethod } from '@prisma/client';
import { postExpenseLedger } from '../lib/financialLedgerService';

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

export const VALID_CATEGORIES = [
  'TRANSPORT', 'LABOUR', 'FUEL', 'RENT', 'ELECTRICITY', 'PACKAGING',
  'VEHICLE', 'SALARY', 'MISC', 'PURCHASE', 'INVENTORY_WASTAGE', 'OFFICE',
  'MAINTENANCE', 'MARKETING', 'BAD_DEBT', 'TAX', 'BANK_CHARGES', 'EQUIPMENT', 'REPAIR'
];

export class ExpenseService {
  /**
   * Helper to format reference numbers like EXP-20260726-0001
   */
  private static async generateExpenseReference(branchId: string, tx: any): Promise<string> {
    const todayStr = getBusinessDateString().replace(/-/g, '');
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
          date: parseInputDateToUtc(date),
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

      // Post to Financial Ledger automatically
      await postExpenseLedger(tx, {
        branchId,
        expenseId: expense.id,
        category: expense.category,
        date: expense.date,
        amount: expense.amount,
        paidBy: expense.paidBy || undefined,
        supplierId: expense.supplierId || undefined,
        employeeId: expense.employeeId || undefined,
        vehicleId: expense.vehicleId || undefined,
        reference: expense.reference || undefined,
      });

      return expense;
    }, { maxWait: 15000, timeout: 120000 });
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

      if (input.amount !== undefined && (isNaN(Number(input.amount)) || !isFinite(Number(input.amount)) || Number(input.amount) <= 0)) {
        throw new Error('Expense amount must be a positive number');
      }

      // New values
      const newCategory = input.category ? (input.category.toUpperCase() as ExpenseCategory) : existing.category;
      const newAmount = input.amount !== undefined && input.amount > 0 ? Number(input.amount) : existing.amount;
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
    }, { maxWait: 15000, timeout: 120000 });
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
    }, { maxWait: 15000, timeout: 120000 });
  }

  /**
   * Compute dynamic summary metrics & category-wise expense breakdown directly from the database across all ERP modules.
   */
  static async getExpenseSummary(branchId: string, fromDate?: Date, toDate?: Date) {
    const rawBranchId = branchId || '';
    const rawFrom = fromDate || null;
    const rawTo = toDate || null;

    // Today range
    const { start: todayStart, end: todayEnd } = getCurrentBusinessDateRange();

    // This Week range
    const weekStart = getBusinessDatePresetRange('this_week').start;

    // This Month range
    const monthStart = getBusinessDatePresetRange('this_month').start;

    const [
      aggRes,
      paidByGroup,
      categoryGroup
    ] = await Promise.all([
      prisma.$queryRaw<Array<{
        today: number;
        todayCount: number;
        thisWeek: number;
        thisWeekCount: number;
        thisMonth: number;
        thisMonthCount: number;
        total: number;
        totalCount: number;
        purchasesTotal: number;
        purchasesTransport: number;
        purchasesCount: number;
        totalRevenue: number;
        salesCount: number;
        salariesTotal: number;
        salariesCount: number;
        wastageLoss: number;
        wastageCount: number;
      }>>`
        SELECT
          (SELECT COALESCE(SUM(amount), 0)::float FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd}) as "today",
          (SELECT COUNT(id)::int FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd}) as "todayCount",
          (SELECT COALESCE(SUM(amount), 0)::float FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${weekStart}) as "thisWeek",
          (SELECT COUNT(id)::int FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${weekStart}) as "thisWeekCount",
          (SELECT COALESCE(SUM(amount), 0)::float FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${monthStart}) as "thisMonth",
          (SELECT COUNT(id)::int FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${monthStart}) as "thisMonthCount",
          (SELECT COALESCE(SUM(amount), 0)::float FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "total",
          (SELECT COUNT(id)::int FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "totalCount",
          (SELECT COALESCE(SUM(total), 0)::float FROM purchases WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "purchasesTotal",
          (SELECT COALESCE(SUM("transportCost"), 0)::float FROM purchases WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "purchasesTransport",
          (SELECT COUNT(id)::int FROM purchases WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "purchasesCount",
          (SELECT COALESCE(SUM(total), 0)::float FROM sales WHERE status != 'CANCELLED' AND "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "totalRevenue",
          (SELECT COUNT(id)::int FROM sales WHERE status != 'CANCELLED' AND "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "salesCount",
          (SELECT COALESCE(SUM(salary), 0)::float FROM employees WHERE "isActive" = true) as "salariesTotal",
          (SELECT COUNT(id)::int FROM employees WHERE "isActive" = true) as "salariesCount",
          (SELECT COALESCE(SUM(w.qty * (CASE WHEN i."avgCost" > 0 THEN i."avgCost" ELSE i."currentBuyPrice" END)), 0)::float 
           FROM wastages w 
           LEFT JOIN inventory i ON i."productId" = w."productId" AND (${rawBranchId} = '' OR i."branchId" = ${rawBranchId}) 
           WHERE (${rawBranchId} = '' OR w."branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR w.date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR w.date <= ${rawTo})) as "wastageLoss",
          (SELECT COUNT(id)::int FROM wastages WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})) as "wastageCount"
      `,
      prisma.$queryRaw<Array<{ paidBy: string; total: number }>>`
        SELECT 
          "paidBy"::text, 
          COALESCE(SUM(amount), 0)::float as total 
        FROM expenses 
        WHERE "deletedAt" IS NULL 
          AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) 
          AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) 
          AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})
        GROUP BY "paidBy"
      `,
      prisma.$queryRaw<Array<{ category: string; total: number; count: number }>>`
        SELECT 
          category::text, 
          COALESCE(SUM(amount), 0)::float as total, 
          COUNT(id)::int as count 
        FROM expenses 
        WHERE "deletedAt" IS NULL 
          AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) 
          AND (${rawFrom}::timestamptz IS NULL OR date >= ${rawFrom}) 
          AND (${rawTo}::timestamptz IS NULL OR date <= ${rawTo})
        GROUP BY category
      `,
    ]);

    const agg = aggRes[0] || ({} as any);
    const payMap = Object.fromEntries(paidByGroup.map(g => [g.paidBy, g.total ?? 0]));
    const cash = payMap['CASH'] ?? 0;
    const bank = payMap['BANK'] ?? 0;
    const online = payMap['ONLINE'] ?? 0;

    const manualExpensesTotal = Number(agg.total ?? 0);
    const purchasesTotal = Number(agg.purchasesTotal ?? 0);
    const purchasesTransport = Number(agg.purchasesTransport ?? 0);
    const salariesTotal = Number(agg.salariesTotal ?? 0);
    const totalRevenue = Number(agg.totalRevenue ?? 0);
    const wastageLoss = Number(agg.wastageLoss ?? 0);

    const totalBusinessExpenses = manualExpensesTotal + purchasesTotal + wastageLoss + salariesTotal;
    const grossProfit = totalRevenue - purchasesTotal;
    const operatingCost = manualExpensesTotal + purchasesTransport + salariesTotal;
    const netProfit = grossProfit - (manualExpensesTotal + wastageLoss + salariesTotal);

    // Build unified category breakdown
    const categoryBreakdown: any[] = categoryGroup.map((item) => ({
      category: item.category,
      total: Number(item.total ?? 0),
      count: Number(item.count ?? 0),
    }));

    if (purchasesTotal > 0) {
      categoryBreakdown.push({
        category: 'PURCHASE',
        total: purchasesTotal,
        count: Number(agg.purchasesCount ?? 0),
      });
    }

    if (wastageLoss > 0) {
      categoryBreakdown.push({
        category: 'INVENTORY_WASTAGE',
        total: wastageLoss,
        count: Number(agg.wastageCount ?? 0),
      });
    }

    if (salariesTotal > 0) {
      categoryBreakdown.push({
        category: 'SALARY',
        total: salariesTotal,
        count: Number(agg.salariesCount ?? 0),
      });
    }

    return {
      today: Number(agg.today ?? 0),
      todayCount: Number(agg.todayCount ?? 0),
      thisWeek: Number(agg.thisWeek ?? 0),
      thisWeekCount: Number(agg.thisWeekCount ?? 0),
      thisMonth: Number(agg.thisMonth ?? 0),
      thisMonthCount: Number(agg.thisMonthCount ?? 0),
      total: manualExpensesTotal,
      totalCount: Number(agg.totalCount ?? 0),
      cash,
      bank,
      online,
      // Automated Cross-Module Analytics
      purchasesTotal,
      purchasesCount: Number(agg.purchasesCount ?? 0),
      purchasesTransport,
      wastageLoss,
      wastageCount: Number(agg.wastageCount ?? 0),
      salariesTotal,
      salariesCount: Number(agg.salariesCount ?? 0),
      totalRevenue,
      salesCount: Number(agg.salesCount ?? 0),
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
  static async getIntegratedExpenses(branchId: string, fromDate?: Date, toDate?: Date, limit: number = 100) {
    const bWhere = branchId ? { branchId, deletedAt: null } : { deletedAt: null };
    
    // Default to current month if no dates provided to prevent unbounded all-time scans
    let effectiveFrom = fromDate;
    let effectiveTo = toDate;
    if (!effectiveFrom && !effectiveTo) {
      const now = new Date();
      effectiveFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const dateFilter = effectiveFrom || effectiveTo ? { ...(effectiveFrom ? { gte: effectiveFrom } : {}), ...(effectiveTo ? { lte: effectiveTo } : {}) } : undefined;

    const [manualExpenses, purchases, wastages] = await Promise.all([
      prisma.expense.findMany({
        where: {
          ...bWhere,
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        select: {
          id: true,
          reference: true,
          category: true,
          amount: true,
          date: true,
          description: true,
          paidBy: true,
          cashAccount: { select: { name: true } },
          bankAccount: { select: { name: true } },
          vehicle: { select: { plateNo: true } },
          employee: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        take: limit,
      }),
      prisma.purchase.findMany({
        where: {
          ...(branchId ? { branchId } : {}),
          ...(dateFilter ? { date: dateFilter } : {}),
          deletedAt: null,
        },
        select: {
          id: true,
          total: true,
          paid: true,
          date: true,
          supplier: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { date: 'desc' },
        take: limit,
      }),
      prisma.wastage.findMany({
        where: {
          ...(branchId ? { branchId } : {}),
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        select: {
          id: true,
          qty: true,
          date: true,
          reason: true,
          product: {
            select: {
              name: true,
              defaultUnit: true,
              inventory: branchId ? { where: { branchId }, select: { avgCost: true, currentBuyPrice: true } } : { select: { avgCost: true, currentBuyPrice: true } },
            },
          },
        },
        orderBy: { date: 'desc' },
        take: limit,
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
        description: `Mandi / Supplier Purchase (${p._count?.items ?? 0} items)`,
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
