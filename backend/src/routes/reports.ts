import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/reports/dashboard
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const bWhere = branchId ? { branchId } : {};

    const todayStart = new Date(Date.now() - 5 * 60 * 60 * 1000); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart); todayEnd.setHours(23, 59, 59, 999);
    const tWhere = { ...bWhere, date: { gte: todayStart, lte: todayEnd }, deletedAt: null };

    const [todaySalesAgg, todayPurchasesAgg, todayExpensesAgg, todayCollectionsAgg] = await Promise.all([
      prisma.sale.aggregate({ where: tWhere, _sum: { total: true }, _count: true }),
      prisma.purchase.aggregate({ where: tWhere, _sum: { total: true } }),
      prisma.expense.aggregate({ where: { ...tWhere, deletedAt: undefined }, _sum: { amount: true } }),
      prisma.collection.aggregate({ where: { ...tWhere, deletedAt: undefined }, _sum: { amount: true } }),
    ]);

    const todaySales = todaySalesAgg._sum.total ?? 0;
    const todayPurchases = todayPurchasesAgg._sum.total ?? 0;
    const todayExpenses = todayExpensesAgg._sum.amount ?? 0;
    const todayCollections = todayCollectionsAgg._sum.amount ?? 0;
    const todayProfit = todaySales - todayPurchases - todayExpenses;
    const cashPosition = todayCollections - todayExpenses - todayPurchases;

    const totalReceivablesAgg = await prisma.client.aggregate({
      where: { ...bWhere, deletedAt: null, currentBalance: { gt: 0 } },
      _sum: { currentBalance: true },
    });
    const totalReceivables = totalReceivablesAgg._sum.currentBalance ?? 0;
    const clientCount = await prisma.client.count({ where: { ...bWhere, deletedAt: null } });

    const supplierPurchasesArr = await prisma.purchase.groupBy({
      by: ['supplierId'],
      where: { ...bWhere, deletedAt: null },
      _sum: { total: true },
    });
    const supplierPaymentsArr = await prisma.supplierPayment.groupBy({
      by: ['supplierId'],
      where: branchId ? { branchId } : {},
      _sum: { amount: true },
    });
    const suppPurchMap = Object.fromEntries(supplierPurchasesArr.map(x => [x.supplierId, x._sum.total ?? 0]));
    const suppPayMap = Object.fromEntries(supplierPaymentsArr.map(x => [x.supplierId, x._sum.amount ?? 0]));
    const allSuppliers = await prisma.supplier.findMany({ where: { ...bWhere, deletedAt: null }, select: { id: true, openingBalance: true } });
    const totalPayables = allSuppliers.reduce((s, sup) => {
      const bal = sup.openingBalance + (suppPurchMap[sup.id] ?? 0) - (suppPayMap[sup.id] ?? 0);
      return s + Math.max(0, bal);
    }, 0);

    const [pendingDeliveries, lowStockItems, atRiskClients, recentSales] = await Promise.all([
      prisma.delivery.count({ where: { ...bWhere, status: { not: 'DELIVERED' } } }),
      prisma.inventory.findMany({ where: bWhere, include: { product: { select: { minStock: true } } } }),
      prisma.client.count({ where: { ...bWhere, rating: { in: ['RED', 'ORANGE'] }, deletedAt: null } }),
      prisma.sale.findMany({
        where: { ...bWhere, deletedAt: null },
        include: { client: { select: { name: true } } },
        orderBy: { date: 'asc' },
        take: 5,
      }),
    ]);

    const lowStockCount = lowStockItems.filter(inv => inv.qty <= (inv.product?.minStock ?? 0)).length;

    const l30Start = new Date(Date.now() - 30 * 86400000);
    const [l30Sales, l30Purchases, l30Expenses] = await Promise.all([
      prisma.sale.aggregate({ where: { ...bWhere, date: { gte: l30Start }, deletedAt: null }, _sum: { total: true } }),
      prisma.purchase.aggregate({ where: { ...bWhere, date: { gte: l30Start }, deletedAt: null }, _sum: { total: true } }),
      prisma.expense.aggregate({ where: { ...bWhere, date: { gte: l30Start } }, _sum: { amount: true } }),
    ]);
    const l30Rev = l30Sales._sum.total ?? 0;
    const l30Cost = (l30Purchases._sum.total ?? 0) + (l30Expenses._sum.amount ?? 0);
    const l30Profit = l30Rev - l30Cost;
    const marginScore = l30Rev > 0 ? Math.max(0, Math.min(100, (l30Profit / l30Rev) * 100)) : 0;
    const collectionScore = l30Rev > 0 ? Math.max(0, Math.min(100, (totalReceivables / l30Rev) * -50 + 100)) : 80;
    const healthScore = Math.round(marginScore * 0.5 + collectionScore * 0.5);

    const attentionRaw = await prisma.client.findMany({
      where: { ...bWhere, deletedAt: null, currentBalance: { gt: 0 } },
      select: { id: true, name: true, currentBalance: true },
      orderBy: { currentBalance: 'desc' },
      take: 5,
    });

    const attention = attentionRaw.map(c => ({
      id: c.id,
      name: c.name,
      balance: c.currentBalance,
    }));

    return res.json({
      success: true,
      data: {
        today: {
          sales: todaySales, salesCount: todaySalesAgg._count,
          purchases: todayPurchases, expenses: todayExpenses,
          collections: todayCollections, profit: todayProfit, cashPosition,
        },
        totals: {
          receivables:       totalReceivables,
          payables:          totalPayables,
          clientCount:       clientCount,
          pendingDeliveries,
          lowStockCount,
          atRiskClients,
          healthScore,
        },
        recentSales: recentSales.map(s => ({
          id:        s.id,
          invoiceNo: s.invoiceNo,
          client:    s.client?.name ?? '—',
          total:     s.total,
          status:    s.status,
          date:      s.date.toISOString(),
        })),
        attention,
      }
    });
  } catch (err: any) {
    console.error('[GET /api/reports/dashboard]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load dashboard report' });
  }
});

// GET /api/reports/pnl
router.get('/pnl', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const bWhere = branchId ? { branchId } : {};
    const { from, to } = req.query;

    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(String(to)) : new Date();
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    const dateRange = { gte: fromDate, lte: toDate };

    const [salesAgg, purchasesAgg, expensesAgg, collectionsAgg, wastageAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { total: true, discount: true }, _count: true,
      }),
      prisma.purchase.aggregate({
        where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { total: true, transportCost: true }, _count: true,
      }),
      prisma.expense.aggregate({
        where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { amount: true },
      }),
      prisma.collection.aggregate({
        where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { amount: true },
      }),
      prisma.wastage.aggregate({
        where: { ...bWhere, date: dateRange },
        _count: true,
      }),
    ]);

    const revenue = salesAgg._sum.total ?? 0;
    const cogs = purchasesAgg._sum.total ?? 0;
    const expenses = expensesAgg._sum.amount ?? 0;
    const collected = collectionsAgg._sum.amount ?? 0;
    const transport = purchasesAgg._sum.transportCost ?? 0;
    const discounts = salesAgg._sum.discount ?? 0;

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - expenses;
    const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    const expensesByCategory = await prisma.expense.groupBy({
      by: ['category'],
      where: { ...bWhere, date: dateRange, deletedAt: null },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    const expensesByPaymentMethod = await prisma.expense.groupBy({
      by: ['paidBy'],
      where: { ...bWhere, date: dateRange, deletedAt: null },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    const [dailySales, dailyPurchases, dailyExpenses] = await Promise.all([
      prisma.sale.groupBy({
        by: ['date'], where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { total: true }, orderBy: { date: 'asc' },
      }),
      prisma.purchase.groupBy({
        by: ['date'], where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { total: true }, orderBy: { date: 'asc' },
      }),
      prisma.expense.groupBy({
        by: ['date'], where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { amount: true }, orderBy: { date: 'asc' },
      }),
    ]);

    const dayMap: Record<string, { sales: number; purchases: number; expenses: number; profit: number }> = {};
    const addDay = (d: Date | string, field: 'sales' | 'purchases' | 'expenses', val: number) => {
      const key = new Date(d).toISOString().slice(0, 10);
      if (!dayMap[key]) dayMap[key] = { sales: 0, purchases: 0, expenses: 0, profit: 0 };
      dayMap[key][field] += val;
    };
    dailySales.forEach(r => addDay(r.date, 'sales', r._sum.total ?? 0));
    dailyPurchases.forEach(r => addDay(r.date, 'purchases', r._sum.total ?? 0));
    dailyExpenses.forEach(r => addDay(r.date, 'expenses', r._sum.amount ?? 0));

    const trend = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        sales: d.sales,
        purchases: d.purchases,
        expenses: d.expenses,
        profit: d.sales - d.purchases - d.expenses,
      }));

    return res.json({
      success: true,
      data: {
        summary: { revenue, cogs, grossProfit, grossMarginPct, expenses, netProfit, netMarginPct, collected, transport, discounts, wastageCount: wastageAgg._count },
        expensesByCategory: expensesByCategory.map(e => ({ category: e.category, total: e._sum.amount ?? 0 })),
        expensesByPaymentMethod: expensesByPaymentMethod.map(e => ({ method: e.paidBy || 'CASH', total: e._sum.amount ?? 0 })),
        trend,
      }
    });
  } catch (err: any) {
    console.error('Error in GET /api/reports/pnl:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load PNL report' });
  }
});

// GET /api/reports/cashflow
router.get('/cashflow', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const bWhere = branchId ? { branchId } : {};
    const { from, to } = req.query;

    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(String(to)) : new Date();
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);
    const dateRange = { gte: fromDate, lte: toDate };

    const [collectionsAgg, salesCashAgg] = await Promise.all([
      prisma.collection.aggregate({
        where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { amount: true },
      }),
      prisma.sale.aggregate({
        where: { ...bWhere, date: dateRange, status: 'PAID', deletedAt: null },
        _sum: { paid: true },
      }),
    ]);

    const [purchasesPaidAgg, expensesAgg, supplierPaymentsAgg] = await Promise.all([
      prisma.purchase.aggregate({
        where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { paid: true },
      }),
      prisma.expense.aggregate({
        where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { amount: true },
      }),
      prisma.supplierPayment.aggregate({
        where: { ...bWhere, date: dateRange },
        _sum: { amount: true },
      }),
    ]);

    const collectionsTotal = (collectionsAgg._sum.amount ?? 0);
    const purchasesTotal = (purchasesPaidAgg._sum.paid ?? 0);
    const expensesTotal = (expensesAgg._sum.amount ?? 0);
    const supplierPaymentsTotal = (supplierPaymentsAgg._sum.amount ?? 0);

    const totalInflow = collectionsTotal;
    const totalOutflow = purchasesTotal + expensesTotal + supplierPaymentsTotal;
    const netCashFlow = totalInflow - totalOutflow;

    const [dailyCollections, dailyPurchases, dailyExpenses] = await Promise.all([
      prisma.collection.groupBy({
        by: ['date'], where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { amount: true }, orderBy: { date: 'asc' },
      }),
      prisma.purchase.groupBy({
        by: ['date'], where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { paid: true }, orderBy: { date: 'asc' },
      }),
      prisma.expense.groupBy({
        by: ['date'], where: { ...bWhere, date: dateRange, deletedAt: null },
        _sum: { amount: true }, orderBy: { date: 'asc' },
      }),
    ]);

    const dayMap: Record<string, { inflow: number; outflow: number }> = {};
    const addInflow = (d: Date | string, val: number) => {
      const key = new Date(d).toISOString().slice(0, 10);
      if (!dayMap[key]) dayMap[key] = { inflow: 0, outflow: 0 };
      dayMap[key].inflow += val;
    };
    const addOutflow = (d: Date | string, val: number) => {
      const key = new Date(d).toISOString().slice(0, 10);
      if (!dayMap[key]) dayMap[key] = { inflow: 0, outflow: 0 };
      dayMap[key].outflow += val;
    };

    dailyCollections.forEach(r => addInflow(r.date, r._sum.amount ?? 0));
    dailyPurchases.forEach(r => addOutflow(r.date, r._sum.paid ?? 0));
    dailyExpenses.forEach(r => addOutflow(r.date, r._sum.amount ?? 0));

    const trend = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        inflow: d.inflow,
        outflow: d.outflow,
        net: d.inflow - d.outflow,
      }));

    return res.json({
      success: true,
      data: {
        period: { from: fromDate.toISOString(), to: toDate.toISOString() },
        inflow: { collections: collectionsTotal, total: totalInflow },
        outflow: { purchases: purchasesTotal, expenses: expensesTotal, supplierPayments: supplierPaymentsTotal, total: totalOutflow },
        netCashFlow,
        summary: { totalInflow, totalOutflow, netCashFlow },
        trend,
      }
    });
  } catch (err: any) {
    console.error('Error in GET /api/reports/cashflow:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load cashflow report' });
  }
});

// GET /api/reports/aging
router.get('/aging', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const bWhere = branchId ? { branchId } : {};
    const now = new Date();

    const unpaidSales = await prisma.sale.findMany({
      where: {
        ...bWhere,
        status: { in: ['PENDING', 'PARTIAL'] },
        deletedAt: null,
      },
      include: { client: { select: { id: true, clientId: true, name: true, phone: true, rating: true } } },
      orderBy: { date: 'asc' },
    });

    interface AgingClient {
      id: string; clientId?: string | null; name: string; phone?: string | null; rating: string;
      current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number;
    }

    const clientMap: Record<string, AgingClient> = {};

    for (const sale of unpaidSales) {
      const age = Math.floor((now.getTime() - new Date(sale.date).getTime()) / 86400000);
      const due = sale.balance;
      const cid = sale.clientId;

      if (!clientMap[cid]) {
        clientMap[cid] = {
          id: cid, clientId: sale.client.clientId, name: sale.client.name,
          phone: sale.client.phone,
          rating: sale.client.rating,
          current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0,
        };
      }

      clientMap[cid].total += due;
      if (age === 0) clientMap[cid].current += due;
      else if (age <= 30) clientMap[cid].d1_30 += due;
      else if (age <= 60) clientMap[cid].d31_60 += due;
      else if (age <= 90) clientMap[cid].d61_90 += due;
      else clientMap[cid].d90plus += due;
    }

    const clients = Object.values(clientMap).sort((a, b) => b.total - a.total);

    const totals = clients.reduce((acc, c) => ({
      current: acc.current + c.current,
      d1_30: acc.d1_30 + c.d1_30,
      d31_60: acc.d31_60 + c.d31_60,
      d61_90: acc.d61_90 + c.d61_90,
      d90plus: acc.d90plus + c.d90plus,
      total: acc.total + c.total,
    }), { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 });

    return res.json({ success: true, data: { clients, totals } });
  } catch (err: any) {
    console.error('Error in GET /api/reports/aging:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load aging report' });
  }
});

// GET /api/reports/invoice-registry
router.get('/invoice-registry', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { clientId, status, search, from, to, limit: limitQuery } = req.query;
    const limit = Math.min(parseInt(String(limitQuery ?? '500'), 10) || 500, 1000);

    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;

    if (from) {
      dateFrom = new Date(String(from));
      dateFrom.setHours(0, 0, 0, 0);
      if (isNaN(dateFrom.getTime())) dateFrom = undefined;
    }
    if (to) {
      dateTo = new Date(String(to));
      dateTo.setHours(23, 59, 59, 999);
      if (isNaN(dateTo.getTime())) dateTo = undefined;
    }

    const where: any = {
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      ...(clientId ? { clientId: String(clientId) } : {}),
      ...(status && status !== 'all' ? { status: status as any } : {}),
      ...(dateFrom || dateTo
        ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
        : {}),
    };

    const sales = await prisma.sale.findMany({
      where,
      include: {
        client: { select: { id: true, clientId: true, name: true, openingBalance: true } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });

    const invoiceRefList = sales.flatMap(s => [s.invoiceNo, `INV-${s.invoiceNo}`]);
    const checkoutColls = invoiceRefList.length
      ? await prisma.collection.findMany({
          where: { reference: { in: invoiceRefList }, deletedAt: null },
          select: { reference: true, amount: true },
        })
      : [];

    const checkoutPayMap: Record<string, number> = {};
    for (const c of checkoutColls) {
      if (c.reference) {
        const inv = c.reference.replace(/^INV-/, '');
        checkoutPayMap[inv] = (checkoutPayMap[inv] ?? 0) + c.amount;
        checkoutPayMap[c.reference] = (checkoutPayMap[c.reference] ?? 0) + c.amount;
      }
    }

    const salesByClient: Record<string, typeof sales> = {};
    for (const s of sales) {
      const cid = s.clientId;
      if (!salesByClient[cid]) salesByClient[cid] = [];
      salesByClient[cid].push(s);
    }

    const processedRowsMap: Record<string, any> = {};
    for (const cid in salesByClient) {
      const clientSales = salesByClient[cid];
      clientSales.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let runningDue = clientSales[0]?.client?.openingBalance ?? 0;
      for (const s of clientSales) {
        const previousDues = runningDue;
        const currentOrderAmount = Number(s.total);
        const totalBill = previousDues + currentOrderAmount;
        const payNow = Number(checkoutPayMap[s.invoiceNo] ?? 0);
        const collectedAmount = Number(s.paid);
        const dueBalance = Math.max(0, totalBill - collectedAmount);

        runningDue = dueBalance;

        processedRowsMap[s.id] = {
          id: s.id,
          invoiceNo: s.invoiceNo,
          date: s.date.toISOString(),
          clientPk: s.client?.id ?? s.clientId,
          clientId: s.client?.clientId ?? '—',
          clientName: s.client?.name     ?? '—',
          previousDues,
          currentOrderAmount,
          totalBill,
          payNow,
          collectedAmount,
          dueBalance,
          status: s.status,
          paymentMode: s.paymentMode,
          subtotal: Number(s.subtotal),
          discount: Number(s.discount),
          deliveryCharge: Number(s.deliveryCharge),
        };
      }
    }

    const filtered = search
      ? sales.filter(
          s =>
            s.invoiceNo.toLowerCase().includes(String(search).toLowerCase()) ||
            (s.client?.name ?? '').toLowerCase().includes(String(search).toLowerCase()) ||
            (s.client?.clientId ?? '').toLowerCase().includes(String(search).toLowerCase()),
        )
      : sales;

    const rows = filtered.map(s => processedRowsMap[s.id]).filter(Boolean);

    const totals = rows.reduce(
      (acc, r) => ({
        previousDues: acc.previousDues + r.previousDues,
        currentOrderAmount: acc.currentOrderAmount + r.currentOrderAmount,
        totalBill: acc.totalBill + r.totalBill,
        payNow: acc.payNow + r.payNow,
        collectedAmount: acc.collectedAmount + r.collectedAmount,
        dueBalance: acc.dueBalance + r.dueBalance,
      }),
      { previousDues: 0, currentOrderAmount: 0, totalBill: 0, payNow: 0, collectedAmount: 0, dueBalance: 0 },
    );

    return res.json({ success: true, data: rows, totals, count: rows.length });
  } catch (err: any) {
    console.error('[GET /api/reports/invoice-registry]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load registry' });
  }
});

export default router;
