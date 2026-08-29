import prisma from './prisma';
import { getAuthoritativeGrossSales } from '../services/grossSalesService';

export interface ReportFilterParams {
  branchId?: string;
  from?: Date;
  to?: Date;
  clientId?: string;
  supplierId?: string;
  productId?: string;
  category?: string;
  employeeId?: string;
  paymentMethod?: string;
  paymentMode?: string;
  status?: string;
  search?: string;
}

export async function getExecutiveDashboardMetrics(filters: ReportFilterParams) {
  const rawBranchId = filters.branchId || '';
  const fromDate = filters.from || null;
  const toDate = filters.to || null;

  const [
    salesRes,
    cogsRes,
    opsRes,
    bsRes,
    payRes
  ] = await Promise.all([
    prisma.$queryRaw<Array<{
      grossSales: number;
      discounts: number;
      deliveryCharge: number;
      totalRevenue: number;
      salesPaidSum: number;
      salesCount: number;
      cashSales: number;
      creditSales: number;
    }>>`
      SELECT 
        COALESCE(SUM(s.subtotal), 0)::float as "grossSales",
        COALESCE(SUM(s.discount), 0)::float as "discounts",
        COALESCE(SUM(s."deliveryCharge"), 0)::float as "deliveryCharge",
        COALESCE(SUM(s.total), 0)::float as "totalRevenue",
        COALESCE(SUM(s.paid), 0)::float as "salesPaidSum",
        COUNT(s.id)::int as "salesCount",
        COALESCE(SUM(CASE WHEN s."paymentMode" = 'CASH' THEN s.total ELSE 0 END), 0)::float as "cashSales",
        COALESCE(SUM(CASE WHEN s."paymentMode" = 'CREDIT' THEN s.total ELSE 0 END), 0)::float as "creditSales"
      FROM sales s
      WHERE s.status != 'CANCELLED' AND s."deletedAt" IS NULL
        AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId})
        AND (${fromDate}::timestamptz IS NULL OR s.date >= ${fromDate})
        AND (${toDate}::timestamptz IS NULL OR s.date <= ${toDate})
    `,
    prisma.$queryRaw<Array<{
      totalCogs: number;
      returnedQty: number;
      returnedValue: number;
    }>>`
      SELECT
        COALESCE(SUM(si.qty * (CASE WHEN si."costPrice" > 0 THEN si."costPrice" ELSE 0 END)), 0)::float as "totalCogs",
        COALESCE(SUM(CASE WHEN si."returnedQty" > 0 THEN si."returnedQty" ELSE 0 END), 0)::float as "returnedQty",
        COALESCE(SUM(CASE WHEN si."returnedQty" > 0 THEN si."returnedQty" * si.rate ELSE 0 END), 0)::float as "returnedValue"
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status != 'CANCELLED' AND s."deletedAt" IS NULL
        AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId})
        AND (${fromDate}::timestamptz IS NULL OR s.date >= ${fromDate})
        AND (${toDate}::timestamptz IS NULL OR s.date <= ${toDate})
    `,
    prisma.$queryRaw<Array<{
      totalPurchases: number;
      transportCost: number;
      purchaseCount: number;
      totalExpenses: number;
      totalCollections: number;
      collectionCount: number;
      wastageCount: number;
      wastageQty: number;
    }>>`
      SELECT
        (SELECT COALESCE(SUM(total), 0)::float FROM purchases WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "totalPurchases",
        (SELECT COALESCE(SUM("transportCost"), 0)::float FROM purchases WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "transportCost",
        (SELECT COUNT(id)::int FROM purchases WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "purchaseCount",
        (SELECT COALESCE(SUM(amount), 0)::float FROM expenses WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "totalExpenses",
        (SELECT COALESCE(SUM(amount), 0)::float FROM collections WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "totalCollections",
        (SELECT COUNT(id)::int FROM collections WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "collectionCount",
        (SELECT COUNT(id)::int FROM wastages WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "wastageCount",
        (SELECT COALESCE(SUM(qty), 0)::float FROM wastages WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) AND (${fromDate}::timestamptz IS NULL OR date >= ${fromDate}) AND (${toDate}::timestamptz IS NULL OR date <= ${toDate})) as "wastageQty"
    `,
    prisma.$queryRaw<Array<{
      totalReceivables: number;
      cashBalance: number;
      bankBalance: number;
      inventoryValue: number;
      inventoryCount: number;
      lowStockCount: number;
    }>>`
      SELECT
        (SELECT COALESCE(SUM("currentBalance"), 0)::float FROM clients WHERE "deletedAt" IS NULL AND "currentBalance" > 0 AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId})) as "totalReceivables",
        (SELECT COALESCE(SUM(balance), 0)::float FROM cash_accounts WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId})) as "cashBalance",
        (SELECT COALESCE(SUM(balance), 0)::float FROM bank_accounts WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId})) as "bankBalance",
        (SELECT COALESCE(SUM(GREATEST(0, qty) * (CASE WHEN "avgCost" > 0 THEN "avgCost" ELSE "currentBuyPrice" END)), 0)::float FROM inventory WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId})) as "inventoryValue",
        (SELECT COUNT(id)::int FROM inventory WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId})) as "inventoryCount",
        (SELECT COUNT(i.id)::int FROM inventory i JOIN products p ON p.id = i."productId" WHERE (${rawBranchId} = '' OR i."branchId" = ${rawBranchId}) AND i.qty <= p."minStock") as "lowStockCount"
    `,
    prisma.$queryRaw<Array<{ totalPayables: number }>>`
      SELECT COALESCE(SUM(
        GREATEST(0, s."openingBalance" + COALESCE(p.total_purch, 0) - COALESCE(pay.total_pay, 0))
      ), 0)::float as "totalPayables"
      FROM suppliers s
      LEFT JOIN (
        SELECT "supplierId", SUM(total) as total_purch FROM purchases WHERE "deletedAt" IS NULL AND (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) GROUP BY "supplierId"
      ) p ON p."supplierId" = s.id
      LEFT JOIN (
        SELECT "supplierId", SUM(amount) as total_pay FROM supplier_payments WHERE (${rawBranchId} = '' OR "branchId" = ${rawBranchId}) GROUP BY "supplierId"
      ) pay ON pay."supplierId" = s.id
      WHERE s."deletedAt" IS NULL AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId})
    `
  ]);

  const sales = salesRes[0] || ({} as any);
  const cogs = cogsRes[0] || ({} as any);
  const ops = opsRes[0] || ({} as any);
  const bs = bsRes[0] || ({} as any);
  const pay = payRes[0] || ({} as any);

  const grossSales = Math.round(Number(sales.grossSales ?? 0));
  const discounts = Math.round(Number(sales.discounts ?? 0));
  const deliveryCharge = Math.round(Number(sales.deliveryCharge ?? 0));
  const netSales = Math.max(0, grossSales - discounts);
  const totalRevenue = Math.round(Number(sales.totalRevenue ?? 0));
  const cashSales = Number(sales.cashSales ?? 0);
  const creditSales = Number(sales.creditSales ?? 0);

  const totalCogs = Number(cogs.totalCogs ?? 0);
  const returnedProductsQty = Number(cogs.returnedQty ?? 0);
  const returnedValue = Number(cogs.returnedValue ?? 0);

  const grossProfit = netSales - totalCogs;
  const grossMarginPct = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

  const contributionProfit = grossProfit - deliveryCharge;
  const contributionMarginPct = netSales > 0 ? (contributionProfit / netSales) * 100 : 0;

  const totalPurchases = Number(ops.totalPurchases ?? 0);
  const transportCost = Number(ops.transportCost ?? 0);
  const totalExpenses = Number(ops.totalExpenses ?? 0);

  const netOperatingProfit = contributionProfit - totalExpenses;
  const netMarginPct = netSales > 0 ? (netOperatingProfit / netSales) * 100 : 0;

  const salesPaidSum = Number(sales.salesPaidSum ?? 0);
  const dbCollectionsSum = Number(ops.totalCollections ?? 0);
  const totalCollections = salesPaidSum > dbCollectionsSum ? salesPaidSum : dbCollectionsSum;

  const totalReceivables = Number(bs.totalReceivables ?? 0);
  const cashBankTotal = Number(bs.cashBalance ?? 0) + Number(bs.bankBalance ?? 0);
  const totalInventoryValue = Number(bs.inventoryValue ?? 0);
  const totalPayables = Number(pay.totalPayables ?? 0);

  const workingCapital = (cashBankTotal + totalReceivables + totalInventoryValue) - totalPayables;

  return {
    period: {
      from: filters.from ? filters.from.toISOString() : null,
      to: filters.to ? filters.to.toISOString() : null,
    },
    sales: {
      grossSales,
      discounts,
      netSales,
      totalRevenue,
      cashSales,
      creditSales,
      deliveryCharge,
      salesCount: Number(sales.salesCount ?? 0),
      avgOrderValue: Number(sales.salesCount ?? 0) > 0 ? Math.round(totalRevenue / Number(sales.salesCount ?? 0)) : 0,
      returnedQty: returnedProductsQty,
      returnedValue,
    },
    cogs: totalCogs,
    profitability: {
      grossProfit,
      grossMarginPct: Number(grossMarginPct.toFixed(2)),
      contributionProfit,
      contributionMarginPct: Number(contributionMarginPct.toFixed(2)),
      totalExpenses,
      netOperatingProfit,
      netMarginPct: Number(netMarginPct.toFixed(2)),
    },
    purchases: {
      totalPurchases,
      transportCost,
      purchaseCount: Number(ops.purchaseCount ?? 0),
    },
    collections: {
      totalCollections,
      collectionCount: Number(ops.collectionCount ?? 0),
    },
    balanceSheetSummary: {
      cashBankTotal,
      receivables: totalReceivables,
      inventoryValue: totalInventoryValue,
      totalAssets: cashBankTotal + totalReceivables + totalInventoryValue,
      payables: totalPayables,
      totalLiabilities: totalPayables,
      workingCapital,
    },
    inventoryKpis: {
      totalValue: totalInventoryValue,
      totalCount: Number(bs.inventoryCount ?? 0),
      lowStockCount: Number(bs.lowStockCount ?? 0),
      wastageCount: Number(ops.wastageCount ?? 0),
      wastageQty: Number(ops.wastageQty ?? 0),
    },
  };
}

export async function getFinancialAlerts(branchId?: string) {
  const rawBranchId = branchId || '';
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const alerts: Array<{ id: string; type: 'DANGER' | 'WARNING' | 'INFO'; title: string; message: string; value?: string }> = [];

  const [aggRes, priceSpikes] = await Promise.all([
    prisma.$queryRaw<Array<{ belowCostCount: number; highDiscountCount: number }>>`
      SELECT
        (SELECT COUNT(*)::int FROM sale_items si JOIN sales s ON s.id = si."saleId" WHERE s."deletedAt" IS NULL AND s.date >= ${sevenDaysAgo} AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId}) AND si."costPrice" > 0 AND si.rate < si."costPrice") as "belowCostCount",
        (SELECT COUNT(*)::int FROM sales s WHERE s."deletedAt" IS NULL AND s.date >= ${sevenDaysAgo} AND (${rawBranchId} = '' OR s."branchId" = ${rawBranchId}) AND s.subtotal > 0 AND (s.discount / s.subtotal) > 0.05) as "highDiscountCount"
    `,
    prisma.$queryRaw<Array<{ productName: string; currentBuyPrice: number; previousBuyPrice: number }>>`
      SELECT p.name as "productName", i."currentBuyPrice"::float, i."previousBuyPrice"::float
      FROM inventory i
      JOIN products p ON p.id = i."productId"
      WHERE (${rawBranchId} = '' OR i."branchId" = ${rawBranchId})
        AND i."currentBuyPrice" > 0 AND i."previousBuyPrice" > 0
        AND (i."currentBuyPrice" / i."previousBuyPrice") > 1.15
      LIMIT 5
    `,
  ]);

  const belowCostCount = aggRes[0]?.belowCostCount ?? 0;
  if (belowCostCount > 0) {
    alerts.push({
      id: 'below-cost',
      type: 'DANGER',
      title: 'Items Sold Below Cost',
      message: `${belowCostCount} sale items were posted below inventory cost in the last 7 days.`,
    });
  }

  const highDiscountCount = aggRes[0]?.highDiscountCount ?? 0;
  if (highDiscountCount > 0) {
    alerts.push({
      id: 'high-discount',
      type: 'WARNING',
      title: 'Excessive Discounts Granted',
      message: `${highDiscountCount} invoices had discounts exceeding 5% of order subtotal.`,
    });
  }

  if (priceSpikes.length > 0) {
    alerts.push({
      id: 'price-spike',
      type: 'WARNING',
      title: 'Supplier Purchase Price Spike',
      message: `${priceSpikes.length} products experienced a purchase rate increase over 15% (e.g. ${priceSpikes[0]?.productName}).`,
    });
  }

  return alerts;
}
