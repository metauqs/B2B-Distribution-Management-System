import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { getCurrentBusinessDateRange, getBusinessDateRange, getBusinessDateString, getBusinessDatePresetRange } from '../lib/businessDate';
import { getExecutiveDashboardMetrics, getFinancialAlerts } from '../lib/financialEngine';
import { getAuthoritativeGrossSales, calculateGrossSalesFromSales } from '../services/grossSalesService';

const router = Router();

// In-memory cache for Dashboard & Report endpoints (30-second TTL)
const DASHBOARD_CACHE = new Map<string, { ts: number; data: any }>();
const DASHBOARD_CACHE_TTL = 30000;
const DASHBOARD_IN_FLIGHT = new Map<string, Promise<any>>();

const REPORT_CACHE = new Map<string, { ts: number; data: any }>();
const REPORT_CACHE_TTL = 30000;
const REPORT_IN_FLIGHT = new Map<string, Promise<any>>();

// 30-day rolling aggregate cache (5-minute TTL) to avoid repeated heavy scans
const L30_METRICS_CACHE = new Map<string, { ts: number; data: { l30Sales: any; l30Purchases: any; l30Expenses: any } }>();
const L30_METRICS_CACHE_TTL = 300000;

export function clearReportCache(): void {
  DASHBOARD_CACHE.clear();
  REPORT_CACHE.clear();
  L30_METRICS_CACHE.clear();
}

async function getL30Metrics(branchId?: string, bWhere: any = {}) {
  const cacheKey = branchId || 'all';
  const cached = L30_METRICS_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < L30_METRICS_CACHE_TTL) {
    return cached.data;
  }
  const l30Start = new Date(Date.now() - 30 * 86400000);
  const [l30Sales, l30Purchases, l30Expenses] = await Promise.all([
    prisma.sale.aggregate({ where: { ...bWhere, date: { gte: l30Start }, status: { not: 'CANCELLED' }, deletedAt: null }, _sum: { total: true } }),
    prisma.purchase.aggregate({ where: { ...bWhere, date: { gte: l30Start }, deletedAt: null }, _sum: { total: true } }),
    prisma.expense.aggregate({ where: { ...bWhere, date: { gte: l30Start } }, _sum: { amount: true } }),
  ]);
  const data = { l30Sales, l30Purchases, l30Expenses };
  L30_METRICS_CACHE.set(cacheKey, { ts: Date.now(), data });
  return data;
}

/**
 * Compute total receivables and count of clients with positive outstanding balances
 * as of a specific Business Date cutoff (05:00 AM PKT boundary).
 */
async function getHistoricalReceivables(branchId?: string, targetEnd?: Date, isToday?: boolean): Promise<{ receivables: number; clientCount: number }> {
  const bWhere = branchId ? { branchId, deletedAt: null } : { deletedAt: null };

  if (isToday || !targetEnd) {
    const agg = await prisma.client.aggregate({
      where: { ...bWhere, currentBalance: { gt: 0 } },
      _sum: { currentBalance: true },
      _count: { id: true },
    });
    return {
      receivables: Math.round((agg._sum.currentBalance ?? 0) * 100) / 100,
      clientCount: agg._count.id ?? 0,
    };
  }

  // Historical calculation as of targetEnd using grouped aggregation
  const [clients, ledgerAggs] = await Promise.all([
    prisma.client.findMany({
      where: bWhere,
      select: { id: true, openingBalance: true, createdAt: true },
    }),
    prisma.customerLedger.groupBy({
      by: ['clientId'],
      where: {
        ...(branchId ? { branchId } : {}),
        date: { lte: targetEnd },
      },
      _sum: {
        debit: true,
        credit: true,
      },
    }),
  ]);

  const ledgerMap = new Map<string, { debit: number; credit: number }>();
  for (const row of ledgerAggs) {
    ledgerMap.set(row.clientId, {
      debit: row._sum.debit ?? 0,
      credit: row._sum.credit ?? 0,
    });
  }

  let totalReceivables = 0;
  let clientsWithDuesCount = 0;

  for (const client of clients) {
    const sums = ledgerMap.get(client.id);
    let clientBal = 0;
    if (sums) {
      const net = (sums.debit || 0) - (sums.credit || 0);
      clientBal = Math.max(0, Math.round(((client.openingBalance || 0) + net) * 100) / 100);
    } else {
      if (targetEnd && client.createdAt <= targetEnd) {
        clientBal = Math.max(0, client.openingBalance || 0);
      }
    }

    if (clientBal > 0.01) {
      totalReceivables += clientBal;
      clientsWithDuesCount++;
    }
  }

  return {
    receivables: Math.round(totalReceivables * 100) / 100,
    clientCount: clientsWithDuesCount,
  };
}

// GET /api/reports/dashboard
router.get('/dashboard', async (req: Request, res: Response) => {
  const start = Date.now();
  const requestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7);
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const bWhere = branchId ? { branchId } : {};
    const { date } = req.query;

    const currentBusinessRange = getCurrentBusinessDateRange();
    const targetRange = date && String(date).trim()
      ? getBusinessDateRange(String(date).trim())
      : currentBusinessRange;

    const todayStart = targetRange.start;
    const todayEnd = targetRange.end;
    const businessDateStr = targetRange.businessDateStr;
    const isToday = businessDateStr === currentBusinessRange.businessDateStr;

    // Check fast in-memory cache
    const cacheKey = `${branchId || 'all'}_${businessDateStr}`;
    const cached = DASHBOARD_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < DASHBOARD_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (DASHBOARD_IN_FLIGHT.has(cacheKey)) {
      const coalescedData = await DASHBOARD_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalescedData });
    }

    const fetchDashboardPromise = (async () => {
      const tWhere = { ...bWhere, date: { gte: todayStart, lte: todayEnd }, deletedAt: null };
      const l30Start = new Date(Date.now() - 30 * 86400000);

      const dbStart = Date.now();
      const [
        todaySalesRecords,
        todayPurchasesAgg,
        todayExpensesAgg,
        todayCollectionsAgg,
        todayWastageAgg,
        receivablesData,
        supplierPurchasesArr,
        supplierPaymentsArr,
        allSuppliers,
        pendingDeliveries,
        deliveryStatusAgg,
        inventoryItems,
        atRiskClients,
        l30Data,
        attentionRaw,
      ] = await Promise.all([
        prisma.sale.findMany({
          where: { ...tWhere, status: { not: 'CANCELLED' } },
          select: {
            id: true,
            subtotal: true,
            total: true,
            discount: true,
            paid: true,
            paymentMode: true,
            status: true,
            date: true,
            invoiceNo: true,
            client: { select: { name: true } },
            items: {
              select: { qty: true, costPrice: true, returnedQty: true, rate: true }
            }
          },
          orderBy: { date: 'desc' },
        }),
        prisma.purchase.aggregate({ where: tWhere, _sum: { total: true } }),
        prisma.expense.aggregate({ where: tWhere, _sum: { amount: true } }),
        prisma.collection.aggregate({ where: tWhere, _sum: { amount: true } }),
        prisma.wastage.aggregate({ where: { ...bWhere, date: { gte: todayStart, lte: todayEnd } }, _sum: { qty: true }, _count: true }),
        getHistoricalReceivables(branchId, todayEnd, isToday),
        prisma.purchase.groupBy({ by: ['supplierId'], where: { ...bWhere, deletedAt: null }, _sum: { total: true } }),
        prisma.supplierPayment.groupBy({ by: ['supplierId'], where: branchId ? { branchId } : {}, _sum: { amount: true } }),
        prisma.supplier.findMany({ where: { ...bWhere, deletedAt: null }, select: { id: true, openingBalance: true } }),
        prisma.delivery.count({ where: { ...bWhere, status: { notIn: ['DELIVERED', 'FAILED'] } } }),
        prisma.delivery.groupBy({
          by: ['status'],
          where: { ...bWhere, date: { gte: todayStart, lte: todayEnd } },
          _count: true,
        }),
        prisma.inventory.findMany({
          where: bWhere,
          select: { qty: true, avgCost: true, currentBuyPrice: true, product: { select: { minStock: true } } },
        }),
        prisma.client.count({ where: { ...bWhere, rating: { in: ['RED', 'ORANGE'] }, deletedAt: null } }),
        getL30Metrics(branchId, bWhere),
        prisma.client.findMany({ where: { ...bWhere, deletedAt: null, currentBalance: { gt: 0 } }, select: { id: true, name: true, currentBalance: true }, orderBy: { currentBalance: 'desc' }, take: 5 }),
      ]);
      const { l30Sales, l30Purchases, l30Expenses } = l30Data;
      const dbDuration = Date.now() - dbStart;

      const completedDeliveriesCount = deliveryStatusAgg.find(d => d.status === 'DELIVERED')?._count ?? 0;
      const failedDeliveriesCount = deliveryStatusAgg.find(d => d.status === 'FAILED')?._count ?? 0;

      let todaySales = 0;
      let grossSales = 0;
      let todayDiscounts = 0;
      let todaySalesPaid = 0;
      let cashSales = 0;
      let creditSales = 0;
      let totalCogs = 0;
      let returnedProductsToday = 0;
      let returnValueToday = 0;

      for (const s of todaySalesRecords) {
        todaySales += s.total;
        grossSales += s.subtotal;
        todayDiscounts += s.discount;
        todaySalesPaid += s.paid;
        if (s.paymentMode === 'CASH') cashSales += s.total;
        else if (s.paymentMode === 'CREDIT') creditSales += s.total;

        for (const item of s.items) {
          const effectiveCost = item.costPrice > 0 ? item.costPrice : 0;
          totalCogs += item.qty * effectiveCost;
          if (item.returnedQty > 0) {
            returnedProductsToday += item.returnedQty;
            returnValueToday += item.returnedQty * item.rate;
          }
        }
      }
      const todaySalesCount = todaySalesRecords.length;
      const recentSales = todaySalesRecords.slice(0, 5);

      const todayPurchases = todayPurchasesAgg._sum.total ?? 0;
      const todayExpenses = todayExpensesAgg._sum.amount ?? 0;
      const dbCollectionsSum = todayCollectionsAgg._sum.amount ?? 0;
      // Collections = standalone collection entries + checkout cash paid at invoice
      const todayCollections = todaySalesPaid > dbCollectionsSum ? todaySalesPaid : dbCollectionsSum;
      const totalReceivables = receivablesData.receivables;
      const clientCount = receivablesData.clientCount;

      // ── Gross Profit: same formula as Reports module (financialEngine.ts) ─────────
      const netSales = Math.max(0, grossSales - todayDiscounts);

      const grossProfit = netSales - totalCogs;
      const netProfit = grossProfit - todayExpenses;
      const todayProfit = netProfit;
      const cashPosition = todayCollections - todayExpenses - todayPurchases;
      const netSalesToday = netSales; // expose netSales (after discounts) not gross

      const purMap: Record<string, number> = {};
      for (const p of supplierPurchasesArr) {
        if (p.supplierId) purMap[p.supplierId] = (purMap[p.supplierId] ?? 0) + (p._sum.total ?? 0);
      }
      const payMap: Record<string, number> = {};
      for (const p of supplierPaymentsArr) {
        if (p.supplierId) payMap[p.supplierId] = (payMap[p.supplierId] ?? 0) + (p._sum.amount ?? 0);
      }

      let totalPayables = 0;
      for (const supp of allSuppliers) {
        const opening = supp.openingBalance ?? 0;
        const purchases = purMap[supp.id] ?? 0;
        const payments = payMap[supp.id] ?? 0;
        const balance = opening + purchases - payments;
        if (balance > 0) totalPayables += balance;
      }

      let totalInventoryValue = 0;
      let lowStockCount = 0;
      for (const inv of inventoryItems) {
        const cost = inv.avgCost > 0 ? inv.avgCost : (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : 0);
        totalInventoryValue += Math.max(0, inv.qty) * cost;
        const min = inv.product?.minStock ?? 0;
        if (inv.qty <= min) lowStockCount++;
      }

      const l30Rev = l30Sales._sum.total ?? 0;
      const l30Pur = l30Purchases._sum.total ?? 0;
      const l30Exp = l30Expenses._sum.amount ?? 0;
      const l30Profit = l30Rev - l30Pur - l30Exp;
      const marginScore = l30Rev > 0 ? Math.max(0, Math.min(100, (l30Profit / l30Rev) * 100)) : 0;
      const collectionScore = l30Rev > 0 ? Math.max(0, Math.min(100, (totalReceivables / l30Rev) * -50 + 100)) : 80;
      const healthScore = Math.round(marginScore * 0.5 + collectionScore * 0.5);

      const attention = attentionRaw.map(c => ({
        id: c.id,
        name: c.name,
        balance: c.currentBalance,
      }));

      const duration = Date.now() - start;
      if (duration > 1500) {
        console.warn(`⚠️ [SLOW DASHBOARD] ReqId: ${requestId} - DB: ${dbDuration}ms | Total: ${duration}ms`);
      }

      return {
        selectedBusinessDate: businessDateStr,
        isToday,
        today: {
          sales: todaySales,
          salesCount: todaySalesCount,
          cashSales,
          creditSales,
          avgOrderValue: todaySalesCount > 0 ? Math.round(todaySales / todaySalesCount) : 0,
          purchases: todayPurchases,
          expenses: todayExpenses,
          collections: todayCollections,
          grossProfit,
          netProfit,
          profit: todayProfit,
          cashPosition,
          completedDeliveries: completedDeliveriesCount,
          failedDeliveries: failedDeliveriesCount,
          pendingDeliveries: pendingDeliveries,
          returnedProducts: returnedProductsToday,
          returnValue: returnValueToday,
          netSales: netSalesToday,
          wastageCount: todayWastageAgg._count,
          wastageQty: todayWastageAgg._sum.qty ?? 0,
        },
        inventory: {
          totalValue: totalInventoryValue,
          lowStockCount,
        },
        totals: {
          receivables: totalReceivables,
          payables: totalPayables,
          healthScore,
          clientCount,
          atRiskClients,
        },
        attention,
        recentSales: recentSales.map(s => ({
          id: s.id,
          invoiceNo: s.invoiceNo,
          clientName: s.client?.name ?? '—',
          total: s.total,
          status: s.status,
          date: s.date.toISOString(),
        })),
      };
    })();

    DASHBOARD_IN_FLIGHT.set(cacheKey, fetchDashboardPromise);
    try {
      const responsePayload = await fetchDashboardPromise;
      if (DASHBOARD_CACHE.size >= 20) {
        DASHBOARD_CACHE.clear();
      }
      DASHBOARD_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json({
        success: true,
        data: responsePayload,
      });
    } finally {
      DASHBOARD_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    const duration = Date.now() - start;
    const errType = err.constructor?.name || 'Error';
    console.error(`❌ [DASHBOARD FAIL] ReqId: ${requestId} | HTTP 500 | Total: ${duration}ms | Error Type: ${errType} | Message: ${err.message}`, {
      code: err.code,
      meta: err.meta,
      stack: err.stack,
    });
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load dashboard report', code: err.code });
  }
});

// GET /api/reports/pnl
router.get('/pnl', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const bWhere = branchId ? { branchId } : {};
    const { from, to } = req.query;

    const fromDate = from ? getBusinessDateRange(String(from)).start : getBusinessDateRange(new Date(Date.now() - 30 * 86400000)).start;
    const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;

    const dateRange = { gte: fromDate, lte: toDate };

    const [salesSummary, purchasesAgg, expensesAgg, collectionsAgg, wastageAgg] = await Promise.all([
      getAuthoritativeGrossSales({ ...bWhere, date: dateRange }),
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

    const revenue = salesSummary.totalRevenue;
    // NOTE: cogs in PnL is purchase total (cost of goods purchased), not COGS per SRS.
    // True COGS is computed from saleItems.costPrice in the executive-dashboard.
    // PnL uses purchase cost as a proxy for period cost of goods.
    const cogs = purchasesAgg._sum.total ?? 0;
    const expenses = expensesAgg._sum.amount ?? 0;
    const collected = collectionsAgg._sum.amount ?? 0;
    const transport = purchasesAgg._sum.transportCost ?? 0;
    const discounts = salesSummary.discounts;

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
        by: ['date'], where: { ...bWhere, date: dateRange, status: { not: 'CANCELLED' }, deletedAt: null },
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
      const key = getBusinessDateString(d);
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

    const fromDate = from ? getBusinessDateRange(String(from)).start : getBusinessDateRange(new Date(Date.now() - 30 * 86400000)).start;
    const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;
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
      const key = getBusinessDateString(d);
      if (!dayMap[key]) dayMap[key] = { inflow: 0, outflow: 0 };
      dayMap[key].inflow += val;
    };
    const addOutflow = (d: Date | string, val: number) => {
      const key = getBusinessDateString(d);
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

    const dateFrom = from ? getBusinessDateRange(String(from)).start : undefined;
    const dateTo = to ? getBusinessDateRange(String(to)).end : undefined;

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

// GET /api/reports/executive-dashboard — Comprehensive SRS Executive Dashboard
router.get('/executive-dashboard', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { preset = 'today', from, to } = req.query;

    const cacheKey = `exec_${branchId || 'all'}_${preset}_${from || ''}_${to || ''}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const presetRange = getBusinessDatePresetRange(String(preset), from ? String(from) : undefined, to ? String(to) : undefined);
    const fromDate = presetRange.start;
    const toDate = presetRange.end;

    const [metrics, alerts] = await Promise.all([
      getExecutiveDashboardMetrics({ branchId, from: fromDate, to: toDate }),
      getFinancialAlerts(branchId),
    ]);

    const responsePayload = {
      success: true,
      data: {
        ...metrics,
        alerts,
      },
    };

    if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
    REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
    res.setHeader('X-Cache', 'MISS');
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('Error in GET /api/reports/executive-dashboard:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load executive dashboard' });
  }
});

// GET /api/reports/sales/invoices — Invoice Profitability Report
router.get('/sales/invoices', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { from, to, clientId, status, search } = req.query;

    const cacheKey = `inv_prof_${branchId || 'all'}_${from || ''}_${to || ''}_${clientId || ''}_${status || ''}_${search || ''}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const fromDate = from ? getBusinessDateRange(String(from)).start : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;

    const where: any = {
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      ...(clientId ? { clientId: String(clientId) } : {}),
      ...(status && status !== 'all' ? { status: status as any } : { status: { not: 'CANCELLED' as const } }),
      date: { gte: fromDate, lte: toDate },
      ...(search ? {
        OR: [
          { invoiceNo: { contains: String(search), mode: 'insensitive' } },
          { client: { name: { contains: String(search), mode: 'insensitive' } } }
        ]
      } : {}),
    };

    const [sales, allInventories] = await Promise.all([
      prisma.sale.findMany({
        where,
        select: {
          id: true,
          invoiceNo: true,
          date: true,
          subtotal: true,
          discount: true,
          deliveryCharge: true,
          status: true,
          paymentMode: true,
          client: { select: { id: true, clientId: true, name: true, type: true } },
          items: {
            select: {
              id: true,
              productId: true,
              itemName: true,
              qty: true,
              unit: true,
              rate: true,
              amount: true,
              costPrice: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
        take: 500,
      }),
      prisma.inventory.findMany({
        where: { ...(branchId ? { branchId } : {}) },
        select: { productId: true, avgCost: true, currentBuyPrice: true },
      }),
    ]);

    const invMap = new Map(allInventories.map(inv => [inv.productId, inv]));

    const rows = sales.map(s => {
      const grossSales = Number(s.subtotal);
      const discount = Number(s.discount);
      const deliveryCharge = Number(s.deliveryCharge);
      const netSales = Math.max(0, grossSales - discount);

      let invoiceCogs = 0;
      const itemBreakdown = s.items.map(item => {
        const inv = item.productId ? invMap.get(item.productId) : null;
        const fallbackCost = (inv?.avgCost && inv.avgCost > 0) ? inv.avgCost : (inv?.currentBuyPrice && inv.currentBuyPrice > 0 ? inv.currentBuyPrice : (item.rate * 0.75));
        const costBasis = ((item as any).costPrice > 0) ? (item as any).costPrice : fallbackCost;
        const itemCogs = item.qty * costBasis;
        invoiceCogs += itemCogs;

        const itemRevenue = item.qty * item.rate;
        const itemGrossProfit = itemRevenue - itemCogs;
        const itemMarginPct = itemRevenue > 0 ? (itemGrossProfit / itemRevenue) * 100 : 0;

        return {
          id: item.id,
          productId: item.productId,
          itemName: item.itemName,
          category: item.product?.category ?? 'VEGETABLE',
          qty: item.qty,
          unit: item.unit,
          rate: item.rate,
          amount: item.amount,
          costPrice: costBasis,
          itemCogs,
          grossProfit: itemGrossProfit,
          grossMarginPct: Number(itemMarginPct.toFixed(2)),
        };
      });

      const grossProfit = netSales - invoiceCogs;
      const grossMarginPct = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
      const contributionProfit = grossProfit - deliveryCharge;
      const contributionMarginPct = netSales > 0 ? (contributionProfit / netSales) * 100 : 0;

      return {
        id: s.id,
        invoiceNo: s.invoiceNo,
        date: s.date.toISOString(),
        clientName: s.client?.name ?? '—',
        clientType: s.client?.type ?? 'RETAIL',
        grossSales,
        discount,
        netSales,
        deliveryCharge,
        cogs: invoiceCogs,
        grossProfit,
        grossMarginPct: Number(grossMarginPct.toFixed(2)),
        contributionProfit,
        contributionMarginPct: Number(contributionMarginPct.toFixed(2)),
        status: s.status,
        paymentMode: s.paymentMode,
        items: itemBreakdown,
      };
    });

    const totals = rows.reduce((acc, r) => ({
      grossSales: acc.grossSales + r.grossSales,
      discount: acc.discount + r.discount,
      netSales: acc.netSales + r.netSales,
      deliveryCharge: acc.deliveryCharge + r.deliveryCharge,
      cogs: acc.cogs + r.cogs,
      grossProfit: acc.grossProfit + r.grossProfit,
      contributionProfit: acc.contributionProfit + r.contributionProfit,
    }), { grossSales: 0, discount: 0, netSales: 0, deliveryCharge: 0, cogs: 0, grossProfit: 0, contributionProfit: 0 });

    const grossMarginPct = totals.netSales > 0 ? (totals.grossProfit / totals.netSales) * 100 : 0;
    const contributionMarginPct = totals.netSales > 0 ? (totals.contributionProfit / totals.netSales) * 100 : 0;

    const responsePayload = {
      success: true,
      data: {
        rows,
        summary: {
          ...totals,
          grossMarginPct: Number(grossMarginPct.toFixed(2)),
          contributionMarginPct: Number(contributionMarginPct.toFixed(2)),
        },
      },
    };

    if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
    REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
    res.setHeader('X-Cache', 'MISS');
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('Error in GET /api/reports/sales/invoices:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load invoice profitability' });
  }
});

// GET /api/reports/sales/customers — Customer Profitability Report
router.get('/sales/customers', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { from, to } = req.query;

    const cacheKey = `cust_prof_${branchId || 'all'}_${from || ''}_${to || ''}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      return res.json({ success: true, data: cached.data });
    }

    const fromDate = from ? getBusinessDateRange(String(from)).start : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;

    const [sales, allInventories] = await Promise.all([
      prisma.sale.findMany({
        where: {
          ...(branchId ? { branchId } : {}),
          status: { not: 'CANCELLED' },
          deletedAt: null,
          date: { gte: fromDate, lte: toDate },
        },
        select: {
          id: true,
          clientId: true,
          subtotal: true,
          discount: true,
          deliveryCharge: true,
          client: {
            select: {
              id: true,
              clientId: true,
              name: true,
              type: true,
              rating: true,
              currentBalance: true,
            },
          },
          items: {
            select: {
              productId: true,
              qty: true,
              rate: true,
              costPrice: true,
            },
          },
        },
        take: 2000,
      }),
      prisma.inventory.findMany({
        where: { ...(branchId ? { branchId } : {}) },
        select: { productId: true, avgCost: true, currentBuyPrice: true },
      }),
    ]);

    const invMap = new Map(allInventories.map(inv => [inv.productId, inv]));

    const clientMap: Record<string, {
      clientId: string;
      clientCode: string;
      clientName: string;
      type: string;
      rating: string;
      invoiceCount: number;
      grossSales: number;
      discounts: number;
      deliveryCharges: number;
      totalCogs: number;
      currentBalance: number;
    }> = {};

    for (const sale of sales) {
      const cid = sale.clientId;
      if (!clientMap[cid]) {
        clientMap[cid] = {
          clientId: cid,
          clientCode: sale.client?.clientId ?? '—',
          clientName: sale.client?.name ?? '—',
          type: sale.client?.type ?? 'RETAIL',
          rating: sale.client?.rating ?? 'A',
          invoiceCount: 0,
          grossSales: 0,
          discounts: 0,
          deliveryCharges: 0,
          totalCogs: 0,
          currentBalance: sale.client?.currentBalance ?? 0,
        };
      }

      clientMap[cid].invoiceCount += 1;
      clientMap[cid].grossSales += Number(sale.subtotal);
      clientMap[cid].discounts += Number(sale.discount);
      clientMap[cid].deliveryCharges += Number(sale.deliveryCharge);

      for (const item of sale.items) {
        const inv = item.productId ? invMap.get(item.productId) : null;
        const fallbackCost = (inv?.avgCost && inv.avgCost > 0)
          ? inv.avgCost
          : (inv?.currentBuyPrice && inv.currentBuyPrice > 0 ? inv.currentBuyPrice : item.rate * 0.75);
        const cost = Number(item.costPrice) > 0 ? Number(item.costPrice) : fallbackCost;
        clientMap[cid].totalCogs += (Number(item.qty) * cost);
      }
    }

    const rows = Object.values(clientMap).map(c => {
      const netSales = Math.max(0, c.grossSales - c.discounts);
      const grossProfit = netSales - c.totalCogs;
      const grossMarginPct = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
      const contributionProfit = grossProfit - c.deliveryCharges;
      const contributionMarginPct = netSales > 0 ? (contributionProfit / netSales) * 100 : 0;

      return {
        clientId: c.clientId,
        clientCode: c.clientCode,
        clientName: c.clientName,
        type: c.type,
        rating: c.rating,
        invoiceCount: c.invoiceCount,
        grossSales: c.grossSales,
        discounts: c.discounts,
        netSales,
        cogs: c.totalCogs,
        grossProfit,
        grossMarginPct: Number(grossMarginPct.toFixed(2)),
        contributionProfit,
        contributionMarginPct: Number(contributionMarginPct.toFixed(2)),
        currentBalance: c.currentBalance,
      };
    }).sort((a, b) => b.netSales - a.netSales);

    if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
    REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: rows });

    return res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('Error in GET /api/reports/sales/customers:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load customer profitability' });
  }
});

// GET /api/reports/sales/products — Product Profitability Report
router.get('/sales/products', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { from, to, category } = req.query;

    const cacheKey = `prod_prof_${branchId || 'all'}_${from || ''}_${to || ''}_${category || 'ALL'}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      return res.json({ success: true, data: cached.data });
    }

    const fromDate = from ? getBusinessDateRange(String(from)).start : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;

    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          ...(branchId ? { branchId } : {}),
          status: { not: 'CANCELLED' },
          deletedAt: null,
          date: { gte: fromDate, lte: toDate },
        },
        ...(category && category !== 'ALL' ? { product: { category: category as any } } : {}),
      },
      select: {
        productId: true,
        itemName: true,
        qty: true,
        unit: true,
        rate: true,
        amount: true,
        costPrice: true,
        product: { select: { id: true, name: true, category: true, defaultUnit: true } },
      },
      take: 5000,
    });

    const prodMap: Record<string, {
      productId: string;
      name: string;
      category: string;
      unit: string;
      totalQty: number;
      grossRevenue: number;
      totalCogs: number;
    }> = {};

    for (const item of saleItems) {
      const pid = item.productId || item.itemName;
      if (!prodMap[pid]) {
        prodMap[pid] = {
          productId: pid,
          name: item.product?.name ?? item.itemName,
          category: item.product?.category ?? 'VEGETABLE',
          unit: item.unit,
          totalQty: 0,
          grossRevenue: 0,
          totalCogs: 0,
        };
      }

      const cost = Number(item.costPrice) > 0 ? Number(item.costPrice) : (Number(item.rate) * 0.75);
      prodMap[pid].totalQty += Number(item.qty);
      prodMap[pid].grossRevenue += Number(item.amount);
      prodMap[pid].totalCogs += (Number(item.qty) * cost);
    }

    const rows = Object.values(prodMap).map(p => {
      const grossProfit = p.grossRevenue - p.totalCogs;
      const marginPct = p.grossRevenue > 0 ? (grossProfit / p.grossRevenue) * 100 : 0;
      const avgSellRate = p.totalQty > 0 ? p.grossRevenue / p.totalQty : 0;
      const avgUnitCost = p.totalQty > 0 ? p.totalCogs / p.totalQty : 0;

      return {
        ...p,
        grossProfit,
        marginPct: Number(marginPct.toFixed(2)),
        avgSellRate: Number(avgSellRate.toFixed(2)),
        avgUnitCost: Number(avgUnitCost.toFixed(2)),
      };
    }).sort((a, b) => b.grossRevenue - a.grossRevenue);

    if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
    REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: rows });

    return res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('Error in GET /api/reports/sales/products:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load product profitability' });
  }
});

// GET /api/reports/purchases/cost-analysis — Purchase Cost Analysis & Rate Trends
router.get('/purchases/cost-analysis', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = `purch_cost_${branchId || 'all'}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const history = await prisma.purchasePriceHistory.findMany({
      where: branchId ? { branchId } : {},
      include: {
        product: { select: { id: true, name: true, category: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });

    const rows = history.map(h => ({
      id: h.id,
      date: h.date.toISOString(),
      productName: h.product.name,
      category: h.product.category,
      supplierName: h.supplier?.name ?? 'Mandi / General',
      buyPrice: h.buyPrice,
      qty: h.qty,
      totalSpent: h.buyPrice * h.qty,
    }));

    const responsePayload = { success: true, data: rows };
    if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
    REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
    res.setHeader('X-Cache', 'MISS');
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('Error in GET /api/reports/purchases/cost-analysis:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load purchase cost analysis' });
  }
});

// GET /api/reports/inventory/valuation — Inventory Valuation by Avg Cost & Buy Price
router.get('/inventory/valuation', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = `inv_val_${branchId || 'all'}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const inventory = await prisma.inventory.findMany({
      where: branchId ? { branchId } : {},
      include: {
        product: { select: { id: true, name: true, category: true, defaultUnit: true, minStock: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    const rows = inventory.map(inv => {
      const avgCostValuation = Math.max(0, inv.qty) * inv.avgCost;
      const latestBuyValuation = Math.max(0, inv.qty) * (inv.currentBuyPrice > 0 ? inv.currentBuyPrice : inv.avgCost);

      return {
        id: inv.id,
        productId: inv.productId,
        productName: inv.product.name,
        category: inv.product.category,
        unit: inv.product.defaultUnit,
        qty: inv.qty,
        minStock: inv.product.minStock,
        avgCost: inv.avgCost,
        currentBuyPrice: inv.currentBuyPrice,
        previousBuyPrice: inv.previousBuyPrice,
        avgCostValuation,
        latestBuyValuation,
        lastPurchaseDate: inv.lastPurchaseDate ? inv.lastPurchaseDate.toISOString() : null,
      };
    });

    const totalAvgCostValue = rows.reduce((s, r) => s + r.avgCostValuation, 0);
    const totalLatestBuyValue = rows.reduce((s, r) => s + r.latestBuyValuation, 0);

    const responsePayload = {
      success: true,
      data: {
        rows,
        summary: {
          totalItems: rows.length,
          totalQty: rows.reduce((s, r) => s + r.qty, 0),
          totalAvgCostValue,
          totalLatestBuyValue,
        },
      },
    };

    if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
    REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
    res.setHeader('X-Cache', 'MISS');
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('Error in GET /api/reports/inventory/valuation:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load inventory valuation' });
  }
});

// GET /api/reports/finance/balance-sheet — Balance Sheet Statement
router.get('/finance/balance-sheet', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = `bal_sheet_${branchId || 'all'}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const bWhere = branchId ? { branchId } : {};

    const [cashAccts, bankAccts, receivablesAgg, inventoryItems, suppliers, suppPurchases, suppPayments] = await Promise.all([
      prisma.cashAccount.findMany({ where: bWhere }),
      prisma.bankAccount.findMany({ where: bWhere }),
      prisma.client.aggregate({ where: { ...bWhere, deletedAt: null, currentBalance: { gt: 0 } }, _sum: { currentBalance: true } }),
      prisma.inventory.findMany({ where: bWhere }),
      prisma.supplier.findMany({ where: { ...bWhere, deletedAt: null }, select: { id: true, name: true, openingBalance: true } }),
      prisma.purchase.groupBy({ by: ['supplierId'], where: { ...bWhere, deletedAt: null }, _sum: { total: true } }),
      prisma.supplierPayment.groupBy({ by: ['supplierId'], where: bWhere, _sum: { amount: true } }),
    ]);

    const cashTotal = cashAccts.reduce((s, c) => s + c.balance, 0);
    const bankTotal = bankAccts.reduce((s, b) => s + b.balance, 0);
    const totalCashBank = cashTotal + bankTotal;
    const receivables = receivablesAgg._sum.currentBalance ?? 0;

    const inventoryAssetValue = inventoryItems.reduce((s, inv) => {
      const rate = inv.avgCost > 0 ? inv.avgCost : inv.currentBuyPrice;
      return s + (Math.max(0, inv.qty) * rate);
    }, 0);

    const totalAssets = totalCashBank + receivables + inventoryAssetValue;

    const suppPurchMap = Object.fromEntries(suppPurchases.map(x => [x.supplierId, x._sum.total ?? 0]));
    const suppPayMap = Object.fromEntries(suppPayments.map(x => [x.supplierId, x._sum.amount ?? 0]));

    const payables = suppliers.reduce((sum, sup) => {
      const bal = sup.openingBalance + (suppPurchMap[sup.id] ?? 0) - (suppPayMap[sup.id] ?? 0);
      return sum + Math.max(0, bal);
    }, 0);

    const totalLiabilities = payables;
    const equity = totalAssets - totalLiabilities;

    const responsePayload = {
      success: true,
      data: {
        assets: {
          cashAccounts: cashAccts.map(c => ({ name: c.name, balance: c.balance })),
          bankAccounts: bankAccts.map(b => ({ name: `${b.bankName ?? ''} - ${b.name}`, balance: b.balance })),
          totalCashBank,
          receivables,
          inventoryAssetValue,
          totalAssets,
        },
        liabilities: {
          payables,
          totalLiabilities,
        },
        equity: {
          retainedEarnings: equity,
          totalEquity: equity,
        },
      },
    };

    if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
    REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
    res.setHeader('X-Cache', 'MISS');
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('Error in GET /api/reports/finance/balance-sheet:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load balance sheet' });
  }
});

// POST /api/reports/backfill — Safe historical backfill for SaleItem costPrice
router.post('/backfill', async (req: Request, res: Response) => {
  try {
    type BackfillItem = Prisma.SaleItemGetPayload<{
      include: { product: { select: { id: true; inventory: { select: { avgCost: true; currentBuyPrice: true } } } } };
    }>;
    const saleItems = await prisma.saleItem.findMany({
      where: { costPrice: 0 },
      include: { product: { select: { id: true, inventory: { select: { avgCost: true, currentBuyPrice: true } } } } },
    }) as BackfillItem[];

    let updatedCount = 0;
    for (const item of saleItems) {
      let cost = 0;
      if (item.product?.inventory && item.product.inventory.length > 0) {
        const inv = item.product.inventory[0];
        cost = inv.avgCost > 0 ? inv.avgCost : inv.currentBuyPrice;
      }
      if (cost <= 0) cost = item.rate * 0.75;

      await prisma.saleItem.update({
        where: { id: item.id },
        data: { costPrice: cost },
      });
      updatedCount++;
    }

    return res.json({ success: true, message: `Successfully backfilled ${updatedCount} historical sale items with cost basis.` });
  } catch (err: any) {
    console.error('Error in POST /api/reports/backfill:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to execute backfill' });
  }
});

export default router;

