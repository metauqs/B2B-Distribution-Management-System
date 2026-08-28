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
  const bWhere = filters.branchId ? { branchId: filters.branchId } : {};
  const dateRange = (filters.from && filters.to) ? { gte: filters.from, lte: filters.to } : undefined;
  const dateWhere = dateRange ? { date: dateRange } : {};

  const saleWhere = { ...bWhere, ...dateWhere, status: { not: 'CANCELLED' as const }, deletedAt: null };
  const purchaseWhere = { ...bWhere, ...dateWhere, deletedAt: null };
  const expenseWhere = { ...bWhere, ...dateWhere, deletedAt: null };
  const collectionWhere = { ...bWhere, ...dateWhere, deletedAt: null };

  const [
    salesAgg,
    paymentModeAgg,
    purchasesAgg,
    expensesAgg,
    collectionsAgg,
    wastageAgg,
    receivablesAgg,
    inventoryItems,
    allSuppliers,
    supplierPurchases,
    supplierPayments,
    saleItemsAgg,
  ] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { total: true, subtotal: true, discount: true, deliveryCharge: true, paid: true }, _count: true }),
    prisma.sale.groupBy({ by: ['paymentMode'], where: saleWhere, _sum: { total: true } }),
    prisma.purchase.aggregate({ where: purchaseWhere, _sum: { total: true, subtotal: true, transportCost: true }, _count: true }),
    prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: true }),
    prisma.collection.aggregate({ where: collectionWhere, _sum: { amount: true }, _count: true }),
    prisma.wastage.aggregate({ where: { ...bWhere, ...dateWhere }, _sum: { qty: true }, _count: true }),
    prisma.client.aggregate({ where: { ...bWhere, deletedAt: null, currentBalance: { gt: 0 } }, _sum: { currentBalance: true } }),
    prisma.inventory.findMany({
      where: bWhere,
      include: { product: { select: { id: true, name: true, minStock: true, category: true } } },
    }),
    prisma.supplier.findMany({ where: { ...bWhere, deletedAt: null }, select: { id: true, openingBalance: true } }),
    prisma.purchase.groupBy({ by: ['supplierId'], where: { ...bWhere, deletedAt: null }, _sum: { total: true } }),
    prisma.supplierPayment.groupBy({ by: ['supplierId'], where: bWhere, _sum: { amount: true } }),
    prisma.saleItem.findMany({
      where: { sale: saleWhere },
      select: {
        qty: true,
        rate: true,
        amount: true,
        costPrice: true,
        returnedQty: true,
        productId: true,
      },
    }),
  ]);

  // Financial Calculations (using single authoritative gross sales calculation)
  const grossSales = Math.round(salesAgg._sum.subtotal ?? 0);
  const discounts = Math.round(salesAgg._sum.discount ?? 0);
  const deliveryCharge = Math.round(salesAgg._sum.deliveryCharge ?? 0);
  const netSales = Math.max(0, grossSales - discounts);
  const totalRevenue = Math.round(salesAgg._sum.total ?? 0);
  const payModeMap = Object.fromEntries(paymentModeAgg.map(x => [x.paymentMode, x._sum.total ?? 0]));
  const cashSales = payModeMap['CASH'] ?? 0;
  const creditSales = payModeMap['CREDIT'] ?? 0;

  let totalCogs = 0;
  let returnedProductsQty = 0;
  let returnedValue = 0;

  for (const item of saleItemsAgg) {
    // Use locked historical cost basis. If missing (legacy data), fall back to
    // inventory avgCost resolved at query time (done in backfill). Final resort: 0 (no estimation).
    const effectiveCost = item.costPrice > 0 ? item.costPrice : 0;
    totalCogs += (item.qty * effectiveCost);
    if (item.returnedQty > 0) {
      returnedProductsQty += item.returnedQty;
      returnedValue += (item.returnedQty * item.rate);
    }
  }

  const grossProfit = netSales - totalCogs;
  const grossMarginPct = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

  const contributionProfit = grossProfit - deliveryCharge;
  const contributionMarginPct = netSales > 0 ? (contributionProfit / netSales) * 100 : 0;

  const totalPurchases = purchasesAgg._sum.total ?? 0;
  const transportCost = purchasesAgg._sum.transportCost ?? 0;
  const totalExpenses = expensesAgg._sum.amount ?? 0;

  const netOperatingProfit = contributionProfit - totalExpenses;
  const netMarginPct = netSales > 0 ? (netOperatingProfit / netSales) * 100 : 0;

  const salesPaidSum = salesAgg._sum.paid ?? 0;
  const dbCollectionsSum = collectionsAgg._sum.amount ?? 0;
  // Use whichever is higher: sale.paid already includes all amounts
  // collected against invoices; standalone collections table may double-count checkout payments.
  const totalCollections = salesPaidSum > dbCollectionsSum ? salesPaidSum : dbCollectionsSum;
  const totalReceivables = receivablesAgg._sum.currentBalance ?? 0;

  const suppPurchMap = Object.fromEntries(supplierPurchases.map(x => [x.supplierId, x._sum.total ?? 0]));
  const suppPayMap = Object.fromEntries(supplierPayments.map(x => [x.supplierId, x._sum.amount ?? 0]));
  const totalPayables = allSuppliers.reduce((sum, s) => {
    const bal = s.openingBalance + (suppPurchMap[s.id] ?? 0) - (suppPayMap[s.id] ?? 0);
    return sum + Math.max(0, bal);
  }, 0);

  const totalInventoryValue = inventoryItems.reduce((sum, inv) => {
    const rate = inv.avgCost > 0 ? inv.avgCost : inv.currentBuyPrice;
    return sum + (Math.max(0, inv.qty) * rate);
  }, 0);

  // Cash / Bank Total Asset balances
  const [cashAccts, bankAccts] = await Promise.all([
    prisma.cashAccount.aggregate({ where: bWhere, _sum: { balance: true } }),
    prisma.bankAccount.aggregate({ where: bWhere, _sum: { balance: true } }),
  ]);
  const cashBankTotal = (cashAccts._sum.balance ?? 0) + (bankAccts._sum.balance ?? 0);

  const workingCapital = (cashBankTotal + totalReceivables + totalInventoryValue) - totalPayables;

  const lowStockItems = inventoryItems.filter(i => i.qty <= (i.product?.minStock ?? 0));

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
      salesCount: salesAgg._count,
      avgOrderValue: salesAgg._count > 0 ? Math.round(totalRevenue / salesAgg._count) : 0,
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
      purchaseCount: purchasesAgg._count,
    },
    collections: {
      totalCollections,
      collectionCount: collectionsAgg._count,
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
      totalCount: inventoryItems.length,
      lowStockCount: lowStockItems.length,
      wastageCount: wastageAgg._count,
      wastageQty: wastageAgg._sum.qty ?? 0,
    },
  };
}

export async function getFinancialAlerts(branchId?: string) {
  const bWhere = branchId ? { branchId } : {};
  const alerts: Array<{ id: string; type: 'DANGER' | 'WARNING' | 'INFO'; title: string; message: string; value?: string }> = [];

  const [salesItemsBelowCost, lowMarginSales, highDiscounts, slowStockItems, inventoryValueAgg, recentPurchases] = await Promise.all([
    prisma.saleItem.findMany({
      where: { sale: { ...bWhere, deletedAt: null, date: { gte: new Date(Date.now() - 7 * 86400000) } } },
      include: { sale: { select: { invoiceNo: true, date: true } }, product: { select: { name: true } } },
    }),
    prisma.sale.findMany({
      where: { ...bWhere, deletedAt: null, date: { gte: new Date(Date.now() - 7 * 86400000) } },
      include: { items: true, client: { select: { name: true } } },
    }),
    prisma.sale.findMany({
      where: { ...bWhere, deletedAt: null, discount: { gt: 0 }, date: { gte: new Date(Date.now() - 7 * 86400000) } },
      include: { client: { select: { name: true } } },
    }),
    prisma.inventory.findMany({
      where: { ...bWhere, qty: { gt: 0 } },
      include: { product: { select: { name: true } } },
    }),
    prisma.inventory.findMany({ where: bWhere }),
    prisma.inventory.findMany({
      where: { ...bWhere, currentBuyPrice: { gt: 0 }, previousBuyPrice: { gt: 0 } },
      include: { product: { select: { name: true } } },
    }),
  ]);

  // 1. Selling Below Cost
  let belowCostCount = 0;
  for (const item of salesItemsBelowCost) {
    if (item.costPrice > 0 && item.rate < item.costPrice) {
      belowCostCount++;
    }
  }
  if (belowCostCount > 0) {
    alerts.push({
      id: 'below-cost',
      type: 'DANGER',
      title: 'Items Sold Below Cost',
      message: `${belowCostCount} sale items were posted below inventory cost in the last 7 days.`,
    });
  }

  // 2. High Discounts
  let highDiscountCount = 0;
  for (const sale of highDiscounts) {
    if (sale.subtotal > 0 && (sale.discount / sale.subtotal) > 0.05) {
      highDiscountCount++;
    }
  }
  if (highDiscountCount > 0) {
    alerts.push({
      id: 'high-discount',
      type: 'WARNING',
      title: 'Excessive Discounts Granted',
      message: `${highDiscountCount} invoices had discounts exceeding 5% of order subtotal.`,
    });
  }

  // 3. Price Spikes on Mandi Purchases
  const priceSpikes = recentPurchases.filter(i => (i.currentBuyPrice / i.previousBuyPrice) > 1.15);
  if (priceSpikes.length > 0) {
    alerts.push({
      id: 'price-spike',
      type: 'WARNING',
      title: 'Supplier Purchase Price Spike',
      message: `${priceSpikes.length} products experienced a purchase rate increase over 15% (e.g. ${priceSpikes[0]?.product?.name}).`,
    });
  }

  return alerts;
}
