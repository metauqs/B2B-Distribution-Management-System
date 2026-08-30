import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { getCurrentBusinessDateRange, getBusinessDateRange, getBusinessDateString, getBusinessDatePresetRange } from '../lib/businessDate';
import { getExecutiveDashboardMetrics, getFinancialAlerts } from '../lib/financialEngine';
import { getAuthoritativeGrossSales, calculateGrossSalesFromSales } from '../services/grossSalesService';
import { getCachedActiveProducts } from './pricelist';

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
  DASHBOARD_IN_FLIGHT.clear();
  REPORT_CACHE.clear();
  REPORT_IN_FLIGHT.clear();
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

  // Fast single-pass PostgreSQL CTE calculation as of targetEnd (0 egress overhead)
  const rawBranchId = branchId || '';
  const rows = await prisma.$queryRaw<Array<{ receivables: number; clientCount: number }>>`
    SELECT 
      COALESCE(SUM(GREATEST(0, (COALESCE(c."openingBalance", 0) + COALESCE(l.net, 0)))), 0)::float as receivables,
      COUNT(CASE WHEN (COALESCE(c."openingBalance", 0) + COALESCE(l.net, 0)) > 0.01 THEN 1 END)::int as "clientCount"
    FROM clients c
    LEFT JOIN (
      SELECT 
        "clientId",
        SUM(debit - credit) as net
      FROM customer_ledger
      WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId})
        AND date <= ${targetEnd}
      GROUP BY "clientId"
    ) l ON l."clientId" = c.id
    WHERE (${rawBranchId} = '' OR c."branchId" = ${rawBranchId})
      AND c."deletedAt" IS NULL
      AND c."createdAt" <= ${targetEnd}
  `;

  const row = rows[0] || { receivables: 0, clientCount: 0 };
  return {
    receivables: Math.round((row.receivables || 0) * 100) / 100,
    clientCount: Number(row.clientCount || 0),
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
      const rawBranchId = branchId || '';

      const [
        rawAggs,
        todaySalesRecords,
        attentionRaw,
        receivablesData,
      ] = await Promise.all([
        prisma.$queryRaw<Array<{
          today_purchases: number;
          today_expenses: number;
          today_collections: number;
          today_wastage_qty: number;
          today_wastage_count: number;
          total_receivables: number;
          receivables_client_count: number;
          total_payables: number;
          completed_deliveries: number;
          failed_deliveries: number;
          pending_deliveries: number;
          at_risk_clients: number;
          total_inventory_value: number;
          low_stock_count: number;
          l30_sales: number;
          l30_purchases: number;
          l30_expenses: number;
        }>>`
          SELECT 
            (SELECT COALESCE(SUM(total), 0) FROM purchases WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd} AND "deletedAt" IS NULL)::float as today_purchases,
            (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd} AND "deletedAt" IS NULL)::float as today_expenses,
            (SELECT COALESCE(SUM(amount), 0) FROM collections WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd} AND "deletedAt" IS NULL)::float as today_collections,
            (SELECT COALESCE(SUM(qty), 0) FROM wastages WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd})::float as today_wastage_qty,
            (SELECT COUNT(*) FROM wastages WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd})::int as today_wastage_count,
            (SELECT COALESCE(SUM("currentBalance"), 0) FROM clients WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND "currentBalance" > 0 AND "deletedAt" IS NULL)::float as total_receivables,
            (SELECT COUNT(*) FROM clients WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND "currentBalance" > 0 AND "deletedAt" IS NULL)::int as receivables_client_count,
            (
              (SELECT COALESCE(SUM("openingBalance"), 0) FROM suppliers WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND "deletedAt" IS NULL) +
              (SELECT COALESCE(SUM(total), 0) FROM purchases WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND "deletedAt" IS NULL) -
              (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}))
            )::float as total_payables,
            (SELECT COUNT(*) FROM deliveries WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd} AND status = 'DELIVERED')::int as completed_deliveries,
            (SELECT COUNT(*) FROM deliveries WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${todayStart} AND date <= ${todayEnd} AND status = 'FAILED')::int as failed_deliveries,
            (SELECT COUNT(*) FROM deliveries WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND status NOT IN ('DELIVERED', 'FAILED'))::int as pending_deliveries,
            (SELECT COUNT(*) FROM clients WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND rating IN ('RED', 'ORANGE') AND "deletedAt" IS NULL)::int as at_risk_clients,
            (
              SELECT COALESCE(SUM(GREATEST(0, inv.qty) * (CASE WHEN inv."avgCost" > 0 THEN inv."avgCost" ELSE (CASE WHEN inv."currentBuyPrice" > 0 THEN inv."currentBuyPrice" ELSE 0 END) END)), 0)
              FROM inventory inv
              WHERE (${rawBranchId} = '' OR inv."branchId" = ${rawBranchId})
            )::float as total_inventory_value,
            (
              SELECT COUNT(*)
              FROM inventory inv
              LEFT JOIN products pr ON pr.id = inv."productId"
              WHERE (${rawBranchId} = '' OR inv."branchId" = ${rawBranchId})
                AND inv.qty <= COALESCE(pr."minStock", 0)
            )::int as low_stock_count,
            (SELECT COALESCE(SUM(total), 0) FROM sales WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${l30Start} AND status != 'CANCELLED' AND "deletedAt" IS NULL)::float as l30_sales,
            (SELECT COALESCE(SUM(total), 0) FROM purchases WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${l30Start} AND "deletedAt" IS NULL)::float as l30_purchases,
            (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND date >= ${l30Start} AND "deletedAt" IS NULL)::float as l30_expenses
        `,
        prisma.$queryRaw<Array<{
          id: string;
          invoiceNo: string;
          date: Date;
          subtotal: number;
          discount: number;
          total: number;
          paid: number;
          paymentMode: string;
          status: string;
          clientName: string;
          items: Array<{ qty: number; costPrice: number; returnedQty: number; rate: number }>;
        }>>`
          SELECT 
            s.id,
            s."invoiceNo",
            s.date,
            s.subtotal::float as subtotal,
            s.discount::float as discount,
            s.total::float as total,
            s.paid::float as paid,
            s."paymentMode",
            s.status,
            COALESCE(c.name, '—') as "clientName",
            COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'qty', si.qty::float,
                    'costPrice', si."costPrice"::float,
                    'returnedQty', si."returnedQty"::float,
                    'rate', si.rate::float
                  )
                )
                FROM sale_items si
                WHERE si."saleId" = s.id
              ),
              '[]'::json
            ) as items
          FROM sales s
          LEFT JOIN clients c ON c.id = s."clientId"
          WHERE (${rawBranchId} = '' OR s."branchId" = ${rawBranchId})
            AND s.date >= ${todayStart}
            AND s.date <= ${todayEnd}
            AND s."deletedAt" IS NULL
            AND s.status != 'CANCELLED'::"TransactionStatus"
          ORDER BY s.date DESC, s."createdAt" DESC
        `,
        prisma.$queryRaw<Array<{ id: string; name: string; balance: number }>>`
          SELECT id, name, "currentBalance"::float as balance
          FROM clients
          WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId})
            AND "deletedAt" IS NULL
            AND "currentBalance" > 0
          ORDER BY "currentBalance" DESC
          LIMIT 5
        `,
        isToday ? Promise.resolve(null) : getHistoricalReceivables(branchId, todayEnd, isToday),
      ]);
      const dbDuration = Date.now() - dbStart;

      const aggRow = (rawAggs && rawAggs[0]) || ({} as any);
      const todayPurchases = Number(aggRow.today_purchases ?? 0);
      const todayExpenses = Number(aggRow.today_expenses ?? 0);
      const dbCollectionsSum = Number(aggRow.today_collections ?? 0);
      const totalPayables = Math.max(0, Number(aggRow.total_payables ?? 0));
      const pendingDeliveries = Number(aggRow.pending_deliveries ?? 0);
      const completedDeliveriesCount = Number(aggRow.completed_deliveries ?? 0);
      const failedDeliveriesCount = Number(aggRow.failed_deliveries ?? 0);
      const atRiskClients = Number(aggRow.at_risk_clients ?? 0);
      const todayWastageQty = Number(aggRow.today_wastage_qty ?? 0);
      const todayWastageCount = Number(aggRow.today_wastage_count ?? 0);
      const totalInventoryValue = Number(aggRow.total_inventory_value ?? 0);
      const lowStockCount = Number(aggRow.low_stock_count ?? 0);

      const totalReceivables = receivablesData ? receivablesData.receivables : Number(aggRow.total_receivables ?? 0);
      const clientCount = receivablesData ? receivablesData.clientCount : Number(aggRow.receivables_client_count ?? 0);

      const l30Rev = Number(aggRow.l30_sales ?? 0);
      const l30Pur = Number(aggRow.l30_purchases ?? 0);
      const l30Exp = Number(aggRow.l30_expenses ?? 0);

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

        for (const item of s.items || []) {
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

      // Collections = standalone collection entries + checkout cash paid at invoice
      const todayCollections = todaySalesPaid > dbCollectionsSum ? todaySalesPaid : dbCollectionsSum;

      // ── Gross Profit: same formula as Reports module (financialEngine.ts) ─────────
      const netSales = Math.max(0, grossSales - todayDiscounts);

      const grossProfit = netSales - totalCogs;
      const netProfit = grossProfit - todayExpenses;
      const todayProfit = netProfit;
      const cashPosition = todayCollections - todayExpenses - todayPurchases;
      const netSalesToday = netSales; // expose netSales (after discounts) not gross

      const l30Profit = l30Rev - l30Pur - l30Exp;
      const marginScore = l30Rev > 0 ? Math.max(0, Math.min(100, (l30Profit / l30Rev) * 100)) : 0;
      const collectionScore = l30Rev > 0 ? Math.max(0, Math.min(100, (totalReceivables / l30Rev) * -50 + 100)) : 80;
      const healthScore = Math.round(marginScore * 0.5 + collectionScore * 0.5);

      const attention = attentionRaw.map(c => ({
        id: c.id,
        name: c.name,
        balance: c.balance,
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
          wastageCount: todayWastageCount,
          wastageQty: todayWastageQty,
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
          clientName: s.clientName ?? '—',
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
    const { from, to } = req.query;

    const cacheKey = `pnl_${branchId || 'all'}_${from || ''}_${to || ''}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchPnlPromise = (async () => {
      const bWhere = branchId ? { branchId } : {};
      const fromDate = from ? getBusinessDateRange(String(from)).start : getBusinessDateRange(new Date(Date.now() - 30 * 86400000)).start;
      const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;
      const dateRange = { gte: fromDate, lte: toDate };

      const [
        salesSummary,
        purchasesAgg,
        expensesAgg,
        collectionsAgg,
        wastageAgg,
        expensesByCategory,
        expensesByPaymentMethod,
        dailySales,
        dailyPurchases,
        dailyExpenses,
      ] = await Promise.all([
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
        prisma.expense.groupBy({
          by: ['category'],
          where: { ...bWhere, date: dateRange, deletedAt: null },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
        }),
        prisma.expense.groupBy({
          by: ['paidBy'],
          where: { ...bWhere, date: dateRange, deletedAt: null },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
        }),
        prisma.sale.groupBy({
          by: ['date'],
          where: { ...bWhere, date: dateRange, status: { not: 'CANCELLED' }, deletedAt: null },
          _sum: { total: true },
          orderBy: { date: 'asc' },
        }),
        prisma.purchase.groupBy({
          by: ['date'],
          where: { ...bWhere, date: dateRange, deletedAt: null },
          _sum: { total: true },
          orderBy: { date: 'asc' },
        }),
        prisma.expense.groupBy({
          by: ['date'],
          where: { ...bWhere, date: dateRange, deletedAt: null },
          _sum: { amount: true },
          orderBy: { date: 'asc' },
        }),
      ]);

      const revenue = salesSummary.totalRevenue;
      const cogs = purchasesAgg._sum.total ?? 0;
      const expenses = expensesAgg._sum.amount ?? 0;
      const collected = collectionsAgg._sum.amount ?? 0;
      const transport = purchasesAgg._sum.transportCost ?? 0;
      const discounts = salesSummary.discounts;

      const grossProfit = revenue - cogs;
      const netProfit = grossProfit - expenses;
      const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;

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

      return {
        success: true,
        data: {
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          revenue,
          discounts,
          cogs,
          grossProfit,
          grossMarginPct,
          expenses,
          transport,
          netProfit,
          netMarginPct,
          collected,
          wastageCount: wastageAgg._count,
          expensesByCategory: expensesByCategory.map(e => ({ category: e.category, total: e._sum.amount ?? 0 })),
          expensesByPaymentMethod: expensesByPaymentMethod.map(e => ({ method: e.paidBy || 'CASH', total: e._sum.amount ?? 0 })),
          trend,
        }
      };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchPnlPromise);
    try {
      const responsePayload = await fetchPnlPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/reports/pnl:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load PNL report' });
  }
});

// GET /api/reports/cashflow
router.get('/cashflow', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { from, to } = req.query;

    const cacheKey = `cashflow_${branchId || 'all'}_${from || ''}_${to || ''}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchCashflowPromise = (async () => {
      const bWhere = branchId ? { branchId } : {};
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

      return {
        success: true,
        data: {
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          inflow: { collections: collectionsTotal, total: totalInflow },
          outflow: { purchases: purchasesTotal, expenses: expensesTotal, supplierPayments: supplierPaymentsTotal, total: totalOutflow },
          netCashFlow,
          summary: { totalInflow, totalOutflow, netCashFlow },
          trend,
        }
      };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchCashflowPromise);
    try {
      const responsePayload = await fetchCashflowPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/reports/cashflow:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load cashflow report' });
  }
});

// GET /api/reports/aging
router.get('/aging', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const cacheKey = `aging_${branchId || 'all'}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchAgingPromise = (async () => {
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

      return { success: true, data: { clients, totals } };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchAgingPromise);
    try {
      const responsePayload = await fetchAgingPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
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

    const cacheKey = `inv_reg_${branchId || 'all'}_${clientId || ''}_${status || ''}_${search || ''}_${from || ''}_${to || ''}_${limit}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchRegistryPromise = (async () => {
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

      const saleIds = sales.map(s => s.id);
      const invoiceRefList = sales.flatMap(s => [s.invoiceNo, `INV-${s.invoiceNo}`]);
      const [checkoutColls, allocations] = await Promise.all([
        invoiceRefList.length
          ? prisma.collection.findMany({
              where: { reference: { in: invoiceRefList }, deletedAt: null },
              select: { reference: true, amount: true },
            })
          : Promise.resolve([]),
        saleIds.length
          ? prisma.collectionAllocation.findMany({
              where: { saleId: { in: saleIds } },
              select: { saleId: true, allocatedAmount: true },
            })
          : Promise.resolve([]),
      ]);

      const checkoutPayMap: Record<string, number> = {};
      for (const a of allocations) {
        checkoutPayMap[a.saleId] = (checkoutPayMap[a.saleId] ?? 0) + a.allocatedAmount;
      }
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

      return { success: true, data: rows, totals, count: rows.length };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchRegistryPromise);
    try {
      const responsePayload = await fetchRegistryPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
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

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchExecPromise = (async () => {
      const presetRange = getBusinessDatePresetRange(String(preset), from ? String(from) : undefined, to ? String(to) : undefined);
      const fromDate = presetRange.start;
      const toDate = presetRange.end;

      const [metrics, alerts] = await Promise.all([
        getExecutiveDashboardMetrics({ branchId, from: fromDate, to: toDate }),
        getFinancialAlerts(branchId),
      ]);

      return {
        success: true,
        data: {
          ...metrics,
          alerts,
        },
      };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchExecPromise);
    try {
      const responsePayload = await fetchExecPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
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

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchInvoicesProfPromise = (async () => {
      const fromDate = from ? getBusinessDateRange(String(from)).start : new Date(Date.now() - 30 * 86400000);
      const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;
      const rawBranchId = branchId || '';
      const rawClientId = clientId ? String(clientId) : '';
      const rawStatus = (status && status !== 'all') ? String(status) : '';
      const rawSearch = search ? String(search).trim() : '';

      const [sales, activeProducts] = await Promise.all([
        prisma.$queryRaw<Array<{
          id: string;
          invoiceNo: string;
          date: Date;
          grossSales: number;
          discount: number;
          deliveryCharge: number;
          status: string;
          paymentMode: string;
          clientName: string;
          clientType: string;
          items: Array<{
            id: string;
            productId: string | null;
            itemName: string;
            qty: number;
            unit: string;
            rate: number;
            amount: number;
            costPrice: number;
          }>;
        }>>`
          SELECT 
            s.id,
            s."invoiceNo",
            s.date,
            s.subtotal::float as "grossSales",
            s.discount::float as "discount",
            s."deliveryCharge"::float as "deliveryCharge",
            s.status,
            s."paymentMode",
            COALESCE(c.name, '—') as "clientName",
            COALESCE(c.type, 'RETAIL') as "clientType",
            COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'id', si.id,
                    'productId', si."productId",
                    'itemName', si."itemName",
                    'qty', si.qty::float,
                    'unit', si.unit,
                    'rate', si.rate::float,
                    'amount', si.amount::float,
                    'costPrice', si."costPrice"::float
                  )
                )
                FROM sale_items si
                WHERE si."saleId" = s.id
              ),
              '[]'::json
            ) as items
          FROM sales s
          LEFT JOIN clients c ON c.id = s."clientId"
          WHERE s."deletedAt" IS NULL
            AND (${rawStatus} = '' AND s.status != 'CANCELLED' OR ${rawStatus} != '' AND s.status::text = ${rawStatus})
            AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId})
            AND (${rawClientId} = '' OR s."clientId" = ${rawClientId})
            AND s.date >= ${fromDate} AND s.date <= ${toDate}
            AND (${rawSearch} = '' OR (
              s."invoiceNo" ILIKE ${'%' + rawSearch + '%'} OR 
              c.name ILIKE ${'%' + rawSearch + '%'}
            ))
          ORDER BY s.date DESC
          LIMIT 500
        `,
        getCachedActiveProducts(),
      ]);

      const prodMap = new Map<string, any>();
      for (const p of activeProducts) prodMap.set(p.id, p);

      const rows = (sales as any[]).map((s: any) => {
        const grossSales = Number(s.grossSales);
        const discount = Number(s.discount);
        const deliveryCharge = Number(s.deliveryCharge);
        const netSales = Math.max(0, grossSales - discount);

        let invoiceCogs = 0;
        const itemBreakdown = ((s.items || []) as any[]).map((item: any) => {
          const prod = item.productId ? prodMap.get(item.productId) : null;
          const costBasis = Number(item.costPrice) > 0 ? Number(item.costPrice) : (Number(item.rate) * 0.75);
          const itemCogs = Number(item.qty) * costBasis;
          invoiceCogs += itemCogs;

          const itemRevenue = Number(item.qty) * Number(item.rate);
          const itemGrossProfit = itemRevenue - itemCogs;
          const itemMarginPct = itemRevenue > 0 ? (itemGrossProfit / itemRevenue) * 100 : 0;

          return {
            id: item.id,
            productId: item.productId,
            itemName: item.itemName,
            category: prod?.category ?? 'VEGETABLE',
            qty: Number(item.qty),
            unit: item.unit,
            rate: Number(item.rate),
            amount: Number(item.amount),
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
          clientName: s.clientName,
          clientType: s.clientType,
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

      const totals = rows.reduce((acc: any, r: any) => ({
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

      return {
        success: true,
        data: {
          rows,
          totals: {
            ...totals,
            grossMarginPct: Number(grossMarginPct.toFixed(2)),
            contributionMarginPct: Number(contributionMarginPct.toFixed(2)),
          },
        },
      };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchInvoicesProfPromise);
    try {
      const responsePayload = await fetchInvoicesProfPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/reports/sales/invoices:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load invoice profitability report' });
  }
});

// GET /api/reports/sales/customers — Customer Profitability & Volume Report
router.get('/sales/customers', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { from, to } = req.query;

    const cacheKey = `cust_prof_${branchId || 'all'}_${from || ''}_${to || ''}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchCustProfPromise = (async () => {
      const fromDate = from ? getBusinessDateRange(String(from)).start : new Date(Date.now() - 30 * 86400000);
      const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;
      const rawBranchId = branchId || '';

      const rows: Array<{
        clientId: string;
        clientCode: string;
        clientName: string;
        type: string;
        rating: string;
        currentBalance: number;
        invoiceCount: number;
        grossSales: number;
        discounts: number;
        deliveryCharges: number;
        cogs: number;
      }> = await prisma.$queryRaw`
        SELECT 
          c.id as "clientId",
          COALESCE(c."clientId", '—') as "clientCode",
          COALESCE(c.name, '—') as "clientName",
          COALESCE(c.type, 'RETAIL') as "type",
          COALESCE(c.rating::text, 'GREEN') as "rating",
          COALESCE(c."currentBalance", 0)::float as "currentBalance",
          COUNT(s.id)::int as "invoiceCount",
          COALESCE(SUM(s.subtotal), 0)::float as "grossSales",
          COALESCE(SUM(s.discount), 0)::float as "discounts",
          COALESCE(SUM(s."deliveryCharge"), 0)::float as "deliveryCharges",
          COALESCE(SUM(items_cogs.cogs), 0)::float as "cogs"
        FROM sales s
        JOIN clients c ON c.id = s."clientId"
        LEFT JOIN (
          SELECT 
            si."saleId",
            SUM(si.qty * (CASE WHEN si."costPrice" > 0 THEN si."costPrice" ELSE si.rate * 0.75 END)) as cogs
          FROM sale_items si
          GROUP BY si."saleId"
        ) items_cogs ON items_cogs."saleId" = s.id
        WHERE s.status != 'CANCELLED' AND s."deletedAt" IS NULL
          AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId})
          AND s.date >= ${fromDate} AND s.date <= ${toDate}
        GROUP BY c.id, c."clientId", c.name, c.type, c.rating, c."currentBalance"
        ORDER BY (SUM(s.subtotal) - SUM(s.discount)) DESC
      `;

      return rows.map(c => {
        const netSales = Math.max(0, c.grossSales - c.discounts);
        const grossProfit = netSales - c.cogs;
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
          cogs: c.cogs,
          grossProfit,
          grossMarginPct: Number(grossMarginPct.toFixed(2)),
          contributionProfit,
          contributionMarginPct: Number(contributionMarginPct.toFixed(2)),
          currentBalance: c.currentBalance,
        };
      });
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchCustProfPromise);
    try {
      const rows = await fetchCustProfPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: rows });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: rows });
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/reports/sales/customers:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load customer profitability report' });
  }
});

// GET /api/reports/sales/products — Product Profitability & Velocity Report
router.get('/sales/products', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { from, to, category } = req.query;

    const cacheKey = `prod_prof_${branchId || 'all'}_${from || ''}_${to || ''}_${category || 'ALL'}`;
    const cached = REPORT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < REPORT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchProdProfPromise = (async () => {
      const fromDate = from ? getBusinessDateRange(String(from)).start : new Date(Date.now() - 30 * 86400000);
      const toDate = to ? getBusinessDateRange(String(to)).end : getCurrentBusinessDateRange().end;
      const rawBranchId = branchId || '';
      const rawCategory = category ? String(category) : 'ALL';

      const rows: Array<{
        productId: string;
        name: string;
        category: string;
        unit: string;
        totalQty: number;
        grossRevenue: number;
        totalCogs: number;
      }> = await prisma.$queryRaw`
        SELECT 
          COALESCE(si."productId", si."itemName") as "productId",
          COALESCE(p.name, si."itemName") as "name",
          COALESCE(p.category::text, 'VEGETABLE') as "category",
          si.unit,
          SUM(si.qty)::float as "totalQty",
          SUM(si.amount)::float as "grossRevenue",
          SUM(si.qty * (CASE WHEN si."costPrice" > 0 THEN si."costPrice" ELSE si.rate * 0.75 END))::float as "totalCogs"
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        LEFT JOIN products p ON p.id = si."productId"
        WHERE s.status != 'CANCELLED' AND s."deletedAt" IS NULL
          AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId})
          AND (${rawCategory} = '' OR ${rawCategory} = 'ALL' OR p.category::text = ${rawCategory})
          AND s.date >= ${fromDate} AND s.date <= ${toDate}
        GROUP BY COALESCE(si."productId", si."itemName"), COALESCE(p.name, si."itemName"), COALESCE(p.category::text, 'VEGETABLE'), si.unit
        ORDER BY SUM(si.amount) DESC
      `;

      return rows.map(p => {
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
      });
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchProdProfPromise);
    try {
      const rows = await fetchProdProfPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: rows });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: rows });
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/reports/sales/products:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load product profitability report' });
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

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchCostAnalysisPromise = (async () => {
      const rawBranchId = branchId || '';
      const rows: Array<{
        id: string;
        date: Date;
        productName: string;
        category: string;
        supplierName: string;
        buyPrice: number;
        qty: number;
        totalSpent: number;
      }> = await prisma.$queryRaw`
        SELECT 
          pph.id,
          pph.date,
          p.name as "productName",
          COALESCE(p.category::text, 'VEGETABLE') as "category",
          COALESCE(s.name, 'Mandi / General') as "supplierName",
          pph."buyPrice"::float as "buyPrice",
          pph.qty::float as "qty",
          (pph."buyPrice" * pph.qty)::float as "totalSpent"
        FROM purchase_price_histories pph
        JOIN products p ON p.id = pph."productId"
        LEFT JOIN suppliers s ON s.id = pph."supplierId"
        WHERE (${rawBranchId} = '' OR pph."branchId" = ${rawBranchId})
        ORDER BY pph.date DESC
        LIMIT 200
      `;

      return {
        success: true,
        data: rows.map(h => ({
          id: h.id,
          date: h.date.toISOString(),
          productName: h.productName,
          category: h.category,
          supplierName: h.supplierName,
          buyPrice: h.buyPrice,
          qty: h.qty,
          totalSpent: h.totalSpent,
        }))
      };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchCostAnalysisPromise);
    try {
      const responsePayload = await fetchCostAnalysisPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
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

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchValuationPromise = (async () => {
      const rawBranchId = branchId || '';
      const rows: Array<{
        id: string;
        productId: string;
        productName: string;
        category: string;
        unit: string;
        qty: number;
        minStock: number;
        avgCost: number;
        currentBuyPrice: number;
        previousBuyPrice: number;
        avgCostValuation: number;
        latestBuyValuation: number;
        lastPurchaseDate: Date | null;
      }> = await prisma.$queryRaw`
        SELECT 
          i.id,
          i."productId",
          p.name as "productName",
          COALESCE(p.category::text, 'VEGETABLE') as "category",
          p."defaultUnit" as "unit",
          i.qty::float as "qty",
          COALESCE(p."minStock", 0)::float as "minStock",
          i."avgCost"::float as "avgCost",
          i."currentBuyPrice"::float as "currentBuyPrice",
          i."previousBuyPrice"::float as "previousBuyPrice",
          (GREATEST(0, i.qty) * i."avgCost")::float as "avgCostValuation",
          (GREATEST(0, i.qty) * (CASE WHEN i."currentBuyPrice" > 0 THEN i."currentBuyPrice" ELSE i."avgCost" END))::float as "latestBuyValuation",
          i."lastPurchaseDate"
        FROM inventory i
        JOIN products p ON p.id = i."productId"
        WHERE (${rawBranchId} = '' OR i."branchId" = ${rawBranchId})
        ORDER BY p.name ASC
      `;

      const formattedRows = rows.map(inv => ({
        ...inv,
        lastPurchaseDate: inv.lastPurchaseDate ? inv.lastPurchaseDate.toISOString() : null,
      }));

      const totalAvgCostValue = formattedRows.reduce((s, r) => s + r.avgCostValuation, 0);
      const totalLatestBuyValue = formattedRows.reduce((s, r) => s + r.latestBuyValuation, 0);

      return {
        success: true,
        data: {
          rows: formattedRows,
          summary: {
            totalItems: formattedRows.length,
            totalQty: formattedRows.reduce((s, r) => s + r.qty, 0),
            totalAvgCostValue,
            totalLatestBuyValue,
          },
        },
      };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchValuationPromise);
    try {
      const responsePayload = await fetchValuationPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
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

    if (REPORT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await REPORT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchBalSheetPromise = (async () => {
      const bWhere = branchId ? { branchId } : {};

      const [cashAccts, bankAccts, receivablesAgg, inventoryItems, suppliers, suppPurchases, suppPayments] = await Promise.all([
        prisma.cashAccount.findMany({ where: bWhere, select: { name: true, balance: true } }),
        prisma.bankAccount.findMany({ where: bWhere, select: { name: true, bankName: true, balance: true } }),
        prisma.client.aggregate({ where: { ...bWhere, deletedAt: null, currentBalance: { gt: 0 } }, _sum: { currentBalance: true } }),
        prisma.inventory.findMany({ where: bWhere, select: { qty: true, avgCost: true, currentBuyPrice: true } }),
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

      return {
        success: true,
        data: {
          assets: {
            cashAccounts: cashAccts.map(c => ({ name: c.name, balance: c.balance })),
            bankAccounts: bankAccts.map(b => ({ name: `${b.bankName ?? ''} - ${b.name}`, balance: b.balance })),
            totalCashBank,
            receivables,
            inventoryValuation: inventoryAssetValue,
            totalAssets,
          },
          liabilities: {
            payables,
            totalLiabilities,
          },
          equity: {
            netWorth: equity,
            retainedEarnings: equity,
          },
          summary: {
            totalAssets,
            totalLiabilitiesAndEquity: totalLiabilities + equity,
            isBalanced: Math.abs(totalAssets - (totalLiabilities + equity)) < 1,
          },
        },
      };
    })();

    REPORT_IN_FLIGHT.set(cacheKey, fetchBalSheetPromise);
    try {
      const responsePayload = await fetchBalSheetPromise;
      if (REPORT_CACHE.size >= 50) REPORT_CACHE.clear();
      REPORT_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      REPORT_IN_FLIGHT.delete(cacheKey);
    }
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

