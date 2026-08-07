'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, todayInputDate, dateOffset } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, TTL_SHORT, TTL_MEDIUM } from '@/utils/cacheStore';
import { MobileCardRow, MobileCardBox } from '@/components/ui/MobileCard';
import { usePreservedState } from '@/hooks/usePreservedState';
import Icon from '@mdi/react';
import {
  mdiViewDashboard,
  mdiReceiptText,
  mdiCart,
  mdiPackageVariantClosed,
  mdiScaleBalance,
  mdiAlertCircle,
  mdiDownload,
  mdiPrinter,
  mdiFilterVariant,
  mdiTrendingUp,
  mdiTrendingDown,
  mdiAccountGroup,
  mdiRefresh,
  mdiFormatListBulleted,
  mdiShieldAlert,
} from '@mdi/js';

type MainCategory = 'Executive Dashboard' | 'Sales' | 'Purchases' | 'Inventory' | 'Finance' | 'Management Analytics';

type SalesSubTab = 'Invoice Profitability' | 'Customer Profitability' | 'Product Profitability' | 'Sales Registry';
type PurchaseSubTab = 'Cost Analysis' | 'Purchase Summary';
type InventorySubTab = 'Inventory Valuation' | 'Wastage Loss';
type FinanceSubTab = 'Profit & Loss' | 'Balance Sheet' | 'Cash Flow' | 'Receivables Aging';
type AnalyticsSubTab = 'Financial Risk Alerts' | 'Working Capital';

interface ExecutiveData {
  sales: {
    grossSales: number;
    discounts: number;
    netSales: number;
    totalRevenue: number;
    cashSales: number;
    creditSales: number;
    deliveryCharge: number;
    salesCount: number;
    avgOrderValue: number;
    returnedQty: number;
    returnedValue: number;
  };
  cogs: number;
  profitability: {
    grossProfit: number;
    grossMarginPct: number;
    contributionProfit: number;
    contributionMarginPct: number;
    totalExpenses: number;
    netOperatingProfit: number;
    netMarginPct: number;
  };
  balanceSheetSummary: {
    cashBankTotal: number;
    receivables: number;
    inventoryValue: number;
    totalAssets: number;
    payables: number;
    totalLiabilities: number;
    workingCapital: number;
  };
  inventoryKpis: {
    totalValue: number;
    totalCount: number;
    lowStockCount: number;
    wastageCount: number;
    wastageQty: number;
  };
  alerts: Array<{ id: string; type: 'DANGER' | 'WARNING' | 'INFO'; title: string; message: string }>;
}

export default function ReportsPage() {
  const [rState, setRState] = usePreservedState('reports_v2', {
    mainTab: 'Executive Dashboard' as MainCategory,
    salesTab: 'Invoice Profitability' as SalesSubTab,
    purchaseTab: 'Cost Analysis' as PurchaseSubTab,
    inventoryTab: 'Inventory Valuation' as InventorySubTab,
    financeTab: 'Profit & Loss' as FinanceSubTab,
    analyticsTab: 'Financial Risk Alerts' as AnalyticsSubTab,
    datePreset: 'this_month',
    from: dateOffset(-30),
    to: todayInputDate(),
    searchQuery: '',
  });

  const { mainTab, salesTab, purchaseTab, inventoryTab, financeTab, analyticsTab, datePreset, from, to, searchQuery } = rState;

  const setMainTab = (tab: MainCategory) => setRState({ mainTab: tab });
  const setSalesTab = (t: SalesSubTab) => setRState({ salesTab: t });
  const setPurchaseTab = (t: PurchaseSubTab) => setRState({ purchaseTab: t });
  const setInventoryTab = (t: InventorySubTab) => setRState({ inventoryTab: t });
  const setFinanceTab = (t: FinanceSubTab) => setRState({ financeTab: t });
  const setAnalyticsTab = (t: AnalyticsSubTab) => setRState({ analyticsTab: t });

  const [loading, setLoading] = useState(true);
  const [execData, setExecData] = useState<ExecutiveData | null>(null);
  const [invoiceReport, setInvoiceReport] = useState<any>(null);
  const [customerReport, setCustomerReport] = useState<any[]>([]);
  const [productReport, setProductReport] = useState<any[]>([]);
  const [valuationReport, setValuationReport] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [costAnalysis, setCostAnalysis] = useState<any[]>([]);
  const [selectedInvoiceModal, setSelectedInvoiceModal] = useState<any | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const loadData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [execRes, invProfRes, custRes, prodRes, valRes, bsRes, costRes] = await Promise.all([
        fetchWithCache<{ success: boolean; data: ExecutiveData }>(`/api/reports/executive-dashboard?preset=${datePreset}&from=${from}&to=${to}`, { ttl: TTL_SHORT, forceRefresh: !showSpinner }),
        fetchWithCache<{ success: boolean; data: any[]; summary: any }>(`/api/reports/sales/invoices?from=${from}&to=${to}&search=${encodeURIComponent(searchQuery)}`, { ttl: TTL_SHORT, forceRefresh: !showSpinner }),
        fetchWithCache<{ success: boolean; data: any[] }>(`/api/reports/sales/customers?from=${from}&to=${to}`, { ttl: TTL_SHORT, forceRefresh: !showSpinner }),
        fetchWithCache<{ success: boolean; data: any[] }>(`/api/reports/sales/products?from=${from}&to=${to}`, { ttl: TTL_SHORT, forceRefresh: !showSpinner }),
        fetchWithCache<{ success: boolean; data: any[]; summary: any }>(`/api/reports/inventory/valuation`, { ttl: TTL_MEDIUM, forceRefresh: !showSpinner }),
        fetchWithCache<{ success: boolean; data: any }>(`/api/reports/finance/balance-sheet`, { ttl: TTL_MEDIUM, forceRefresh: !showSpinner }),
        fetchWithCache<{ success: boolean; data: any[] }>(`/api/reports/purchases/cost-analysis`, { ttl: TTL_MEDIUM, forceRefresh: !showSpinner }),
      ]);

      if (execRes?.data) setExecData(execRes.data);
      if (invProfRes) setInvoiceReport(invProfRes);
      if (custRes?.data) setCustomerReport(custRes.data);
      if (prodRes?.data) setProductReport(prodRes.data);
      if (valRes) setValuationReport(valRes);
      if (bsRes?.data) setBalanceSheet(bsRes.data);
      if (costRes?.data) setCostAnalysis(costRes.data);

      setLastSyncTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('Failed to fetch reports:', err);
    } finally {
      setLoading(false);
    }
  }, [datePreset, from, to, searchQuery]);

  useEffect(() => { loadData(true); }, [loadData]);

  // Handle Date Preset Changes
  const handlePresetChange = (preset: string) => {
    if (preset === 'today') {
      const today = todayInputDate();
      setRState({ datePreset: preset, from: today, to: today });
    } else if (preset === 'yesterday') {
      const yest = dateOffset(-1);
      setRState({ datePreset: preset, from: yest, to: yest });
    } else if (preset === 'this_week') {
      setRState({ datePreset: preset, from: dateOffset(-7), to: todayInputDate() });
    } else if (preset === 'this_month') {
      setRState({ datePreset: preset, from: dateOffset(-30), to: todayInputDate() });
    } else {
      setRState({ datePreset: preset });
    }
  };

  // Export current table view to CSV
  const exportToCSV = () => {
    let headers: string[] = [];
    let rows: string[][] = [];
    let filename = `financial_report_${mainTab.toLowerCase().replace(/\s+/g, '_')}.csv`;

    if (mainTab === 'Sales' && salesTab === 'Invoice Profitability' && invoiceReport?.data) {
      filename = `invoice_profitability_${from}_to_${to}.csv`;
      headers = ['Invoice No', 'Date', 'Customer', 'Gross Sales', 'Discount', 'Net Sales', 'COGS', 'Gross Profit', 'Margin %', 'Contribution Profit', 'Status'];
      rows = invoiceReport.data.map((r: any) => [
        r.invoiceNo, fmtDate(r.date), `"${r.clientName}"`, r.grossSales, r.discount, r.netSales, r.cogs, r.grossProfit, `${r.grossMarginPct}%`, r.contributionProfit, r.status
      ]);
    } else if (mainTab === 'Sales' && salesTab === 'Customer Profitability') {
      filename = `customer_profitability_${from}_to_${to}.csv`;
      headers = ['Customer', 'Type', 'Invoices', 'Gross Sales', 'Discounts', 'Net Sales', 'COGS', 'Gross Profit', 'Margin %', 'Balance Due'];
      rows = customerReport.map(r => [
        `"${r.clientName}"`, r.type, r.invoiceCount, r.grossSales, r.discounts, r.netSales, r.cogs, r.grossProfit, `${r.grossMarginPct}%`, r.currentBalance
      ]);
    } else if (mainTab === 'Sales' && salesTab === 'Product Profitability') {
      filename = `product_profitability_${from}_to_${to}.csv`;
      headers = ['Product', 'Category', 'Qty Sold', 'Revenue', 'Total COGS', 'Gross Profit', 'Margin %', 'Avg Sell Rate', 'Avg Unit Cost'];
      rows = productReport.map(r => [
        `"${r.name}"`, r.category, r.totalQty, r.grossRevenue, r.totalCogs, r.grossProfit, `${r.marginPct}%`, r.avgSellRate, r.avgUnitCost
      ]);
    } else if (mainTab === 'Inventory') {
      filename = `inventory_valuation.csv`;
      headers = ['Product', 'Category', 'Stock Qty', 'Avg Cost', 'Latest Buy Rate', 'Avg Cost Valuation', 'Latest Buy Valuation'];
      rows = (valuationReport?.data || []).map((r: any) => [
        `"${r.productName}"`, r.category, r.qty, r.avgCost, r.currentBuyPrice, r.avgCostValuation, r.latestBuyValuation
      ]);
    }

    if (rows.length === 0) return;

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <DashboardLayout>
      {/* Top Filter & Toolbar Bar */}
      <div className="va-panel" style={{ padding: '16px 20px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F8FAFC', padding: '4px 8px', border: '1px solid #CBD5E1', borderRadius: 8 }}>
              <Icon path={mdiFilterVariant} size={0.7} color="#64748B" />
              <select
                value={datePreset}
                onChange={e => handlePresetChange(e.target.value)}
                style={{ background: 'transparent', border: 'none', fontSize: 13, fontWeight: 700, color: '#1E293B', cursor: 'pointer', outline: 'none' }}
              >
                <option value="today">Today (Active Business Day)</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>From</span>
              <input type="date" value={from} onChange={e => setRState({ from: e.target.value, datePreset: 'custom' })} style={{ padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#F8FAFC', fontSize: 13, fontWeight: 600 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>To</span>
              <input type="date" value={to} onChange={e => setRState({ to: e.target.value, datePreset: 'custom' })} style={{ padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#F8FAFC', fontSize: 13, fontWeight: 600 }} />
            </div>

            <input
              type="text"
              placeholder="Search invoice or client..."
              value={searchQuery}
              onChange={e => setRState({ searchQuery: e.target.value })}
              style={{ padding: '6px 12px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13, width: 180 }}
            />

            <button className="va-btn small" style={{ fontWeight: 700, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => loadData(true)}>
              <Icon path={mdiRefresh} size={0.65} /> Refresh
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="va-btn outline small" style={{ fontWeight: 700, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={exportToCSV}>
              <Icon path={mdiDownload} size={0.7} color="#2563EB" /> Export CSV
            </button>

            <button className="va-btn outline small" style={{ fontWeight: 700, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => window.print()}>
              <Icon path={mdiPrinter} size={0.7} color="#475569" /> Print
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F0FDF4', border: '1px solid #DCFCE7', padding: '6px 12px', borderRadius: '20px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A', boxShadow: '0 0 0 3px rgba(22, 163, 74, 0.2)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>
                Real-Time {lastSyncTime && `(${lastSyncTime})`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Financial Module Tabs */}
      <div className="va-tabs-inline" style={{ marginTop: 12, borderBottom: '2px solid #E2E8F0', paddingBottom: 0 }}>
        {(['Executive Dashboard', 'Sales', 'Purchases', 'Inventory', 'Finance', 'Management Analytics'] as MainCategory[]).map(t => (
          <button
            key={t}
            className={mainTab === t ? 'active' : ''}
            onClick={() => setMainTab(t)}
            style={{ fontWeight: 800, padding: '10px 18px', fontSize: 14 }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="va-loading" style={{ margin: '40px 0', textAlign: 'center' }}>Compiling Financial Intelligence Layer…</div>
      ) : (
        <div style={{ marginTop: 16 }}>

          {/* ══════════════════ 1. EXECUTIVE DASHBOARD ══════════════════ */}
          {mainTab === 'Executive Dashboard' && execData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Financial Risk Alerts Banner */}
              {execData.alerts && execData.alerts.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#991B1B', fontWeight: 800, fontSize: 14 }}>
                    <Icon path={mdiShieldAlert} size={0.85} color="#DC2626" />
                    <span>Active Financial Risk &amp; Margin Alerts ({execData.alerts.length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {execData.alerts.map(a => (
                      <div key={a.id} style={{ fontSize: 13, color: '#7F1D1D', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ textTransform: 'uppercase', fontSize: 11, background: '#FEE2E2', padding: '2px 6px', borderRadius: 4, color: '#991B1B' }}>{a.type}</strong>
                        <span><strong>{a.title}:</strong> {a.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Real-time Executive KPI Grid */}
              <div className="va-cards">
                <div className="va-card accent">
                  <div className="label">Gross Sales</div>
                  <div className="value">{fmtMoney(execData.sales.grossSales)}</div>
                  <div className="foot">{execData.sales.salesCount} Invoices | Net: {fmtMoney(execData.sales.netSales)}</div>
                </div>

                <div className="va-card">
                  <div className="label">Cost of Goods Sold (COGS)</div>
                  <div className="value neg">{fmtMoney(execData.cogs)}</div>
                  <div className="foot">Weighted Avg Cost Basis</div>
                </div>

                <div className="va-card">
                  <div className="label">Gross Profit</div>
                  <div className="value" style={{ color: '#15803D' }}>{fmtMoney(execData.profitability.grossProfit)}</div>
                  <div className="foot">Gross Margin: <strong>{execData.profitability.grossMarginPct}%</strong></div>
                </div>

                <div className="va-card">
                  <div className="label">Contribution Profit</div>
                  <div className="value" style={{ color: '#0369A1' }}>{fmtMoney(execData.profitability.contributionProfit)}</div>
                  <div className="foot">After Delivery Freight ({fmtMoney(execData.sales.deliveryCharge)})</div>
                </div>

                <div className="va-card">
                  <div className="label">Net Operating Profit</div>
                  <div className={`value ${execData.profitability.netOperatingProfit < 0 ? 'neg' : ''}`}>
                    {fmtMoney(execData.profitability.netOperatingProfit)}
                  </div>
                  <div className="foot">Net Margin: <strong>{execData.profitability.netMarginPct}%</strong></div>
                </div>

                <div className="va-card">
                  <div className="label">Working Capital</div>
                  <div className="value" style={{ color: execData.balanceSheetSummary.workingCapital >= 0 ? '#166534' : '#991B1B' }}>
                    {fmtMoney(execData.balanceSheetSummary.workingCapital)}
                  </div>
                  <div className="foot">Current Assets - Payables</div>
                </div>
              </div>

              {/* Financial Position & Inventory Overview Panel */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                <div className="va-panel">
                  <div className="va-panel-head">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon path={mdiScaleBalance} size={0.8} color="#0EA5E9" /> Balance Sheet Asset Summary
                    </h3>
                  </div>
                  <table className="va-table">
                    <tbody>
                      <tr>
                        <td>Cash &amp; Bank Balances</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(execData.balanceSheetSummary.cashBankTotal)}</td>
                      </tr>
                      <tr>
                        <td>Accounts Receivable (Client Dues)</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#B45309', fontWeight: 700 }}>{fmtMoney(execData.balanceSheetSummary.receivables)}</td>
                      </tr>
                      <tr>
                        <td>Inventory Valuation (Avg Cost)</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#16A34A', fontWeight: 700 }}>{fmtMoney(execData.balanceSheetSummary.inventoryValue)}</td>
                      </tr>
                      <tr style={{ background: '#F8FAFC', fontWeight: 800 }}>
                        <td>Total Current Assets</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#0369A1' }}>{fmtMoney(execData.balanceSheetSummary.totalAssets)}</td>
                      </tr>
                      <tr style={{ borderTop: '2px solid #E2E8F0' }}>
                        <td>Accounts Payable (Supplier Dues)</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#991B1B', fontWeight: 700 }}>-{fmtMoney(execData.balanceSheetSummary.payables)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="va-panel">
                  <div className="va-panel-head">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon path={mdiPackageVariantClosed} size={0.8} color="#16A34A" /> Inventory &amp; Wastage KPIs
                    </h3>
                  </div>
                  <table className="va-table">
                    <tbody>
                      <tr>
                        <td>Total Stock Asset Value</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(execData.inventoryKpis.totalValue)}</td>
                      </tr>
                      <tr>
                        <td>Tracked Inventory Items</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{execData.inventoryKpis.totalCount} Products</td>
                      </tr>
                      <tr>
                        <td>Low Stock Items Alert</td>
                        <td className="mono" style={{ textAlign: 'right', color: execData.inventoryKpis.lowStockCount > 0 ? '#DC2626' : '#166534', fontWeight: 700 }}>
                          {execData.inventoryKpis.lowStockCount} Items
                        </td>
                      </tr>
                      <tr>
                        <td>Wastage Loss Quantity</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#991B1B' }}>{execData.inventoryKpis.wastageQty} KG ({execData.inventoryKpis.wastageCount} Records)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* ══════════════════ 2. SALES MODULE ══════════════════ */}
          {mainTab === 'Sales' && (
            <div>
              <div className="va-tabs-inline" style={{ marginBottom: 16 }}>
                {(['Invoice Profitability', 'Customer Profitability', 'Product Profitability'] as SalesSubTab[]).map(st => (
                  <button key={st} className={salesTab === st ? 'active' : ''} onClick={() => setSalesTab(st)}>{st}</button>
                ))}
              </div>

              {/* Sub-tab 1: Invoice Profitability */}
              {salesTab === 'Invoice Profitability' && invoiceReport && (
                <div className="va-panel">
                  <div className="va-panel-head" style={{ justifyContent: 'space-between' }}>
                    <h3>Invoice Profitability Inspector</h3>
                    {invoiceReport.summary && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>
                        Overall Gross Margin: <strong>{invoiceReport.summary.grossMarginPct}%</strong> | Contribution Profit: <strong>{fmtMoney(invoiceReport.summary.contributionProfit)}</strong>
                      </div>
                    )}
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table className="va-table">
                      <thead>
                        <tr>
                          <th>Invoice #</th>
                          <th>Date</th>
                          <th>Customer</th>
                          <th>Gross Sales</th>
                          <th>Discount</th>
                          <th>Net Sales</th>
                          <th>COGS</th>
                          <th>Gross Profit</th>
                          <th>Margin %</th>
                          <th>Delivery Charge</th>
                          <th>Contribution Profit</th>
                          <th>Inspect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceReport.data?.map((row: any) => (
                          <tr key={row.id}>
                            <td className="mono" style={{ fontWeight: 700 }}>{row.invoiceNo}</td>
                            <td>{fmtDate(row.date)}</td>
                            <td><strong>{row.clientName}</strong></td>
                            <td className="mono">{fmtMoney(row.grossSales)}</td>
                            <td className="mono" style={{ color: '#991B1B' }}>{row.discount > 0 ? `-${fmtMoney(row.discount)}` : '—'}</td>
                            <td className="mono" style={{ fontWeight: 700 }}>{fmtMoney(row.netSales)}</td>
                            <td className="mono" style={{ color: '#991B1B' }}>{fmtMoney(row.cogs)}</td>
                            <td className="mono" style={{ color: row.grossProfit >= 0 ? '#166534' : '#DC2626', fontWeight: 700 }}>
                              {fmtMoney(row.grossProfit)}
                            </td>
                            <td>
                              <span style={{ padding: '2px 8px', borderRadius: 12, background: row.grossMarginPct >= 15 ? '#DCFCE7' : '#FEE2E2', color: row.grossMarginPct >= 15 ? '#166534' : '#991B1B', fontWeight: 800, fontSize: 12 }}>
                                {row.grossMarginPct}%
                              </span>
                            </td>
                            <td className="mono">{row.deliveryCharge > 0 ? fmtMoney(row.deliveryCharge) : '—'}</td>
                            <td className="mono" style={{ fontWeight: 700, color: row.contributionProfit >= 0 ? '#0369A1' : '#991B1B' }}>
                              {fmtMoney(row.contributionProfit)}
                            </td>
                            <td>
                              <button className="va-btn small outline" onClick={() => setSelectedInvoiceModal(row)} style={{ padding: '4px 8px', fontSize: 12 }}>
                                View Items
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sub-tab 2: Customer Profitability */}
              {salesTab === 'Customer Profitability' && (
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Customer Economics &amp; Profitability</h3></div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="va-table">
                      <thead>
                        <tr>
                          <th>Customer Name</th>
                          <th>Type</th>
                          <th>Invoices</th>
                          <th>Gross Sales</th>
                          <th>Discounts</th>
                          <th>Net Sales</th>
                          <th>COGS</th>
                          <th>Gross Profit</th>
                          <th>Margin %</th>
                          <th>Current Dues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerReport.map(c => (
                          <tr key={c.clientId}>
                            <td><strong>{c.clientName}</strong> ({c.clientCode})</td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', background: '#F1F5F9', borderRadius: 4 }}>{c.type}</span></td>
                            <td className="mono">{c.invoiceCount}</td>
                            <td className="mono">{fmtMoney(c.grossSales)}</td>
                            <td className="mono" style={{ color: '#991B1B' }}>{c.discounts > 0 ? `-${fmtMoney(c.discounts)}` : '—'}</td>
                            <td className="mono" style={{ fontWeight: 700 }}>{fmtMoney(c.netSales)}</td>
                            <td className="mono" style={{ color: '#991B1B' }}>{fmtMoney(c.cogs)}</td>
                            <td className="mono" style={{ color: c.grossProfit >= 0 ? '#166534' : '#DC2626', fontWeight: 700 }}>{fmtMoney(c.grossProfit)}</td>
                            <td style={{ fontWeight: 800 }}>{c.grossMarginPct}%</td>
                            <td className="mono" style={{ color: c.currentBalance > 0 ? '#B45309' : '#166534', fontWeight: 700 }}>{fmtMoney(c.currentBalance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sub-tab 3: Product Profitability */}
              {salesTab === 'Product Profitability' && (
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Product Line Profitability &amp; Cost Analysis</h3></div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="va-table">
                      <thead>
                        <tr>
                          <th>Product Name</th>
                          <th>Category</th>
                          <th>Qty Sold</th>
                          <th>Avg Sell Rate</th>
                          <th>Avg Cost Rate</th>
                          <th>Gross Revenue</th>
                          <th>Total COGS</th>
                          <th>Gross Profit</th>
                          <th>Margin %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productReport.map(p => (
                          <tr key={p.productId}>
                            <td><strong>{p.name}</strong></td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, background: '#F8FAFC', padding: '2px 6px', borderRadius: 4 }}>{p.category}</span></td>
                            <td className="mono">{p.totalQty} {p.unit}</td>
                            <td className="mono">Rs {p.avgSellRate}</td>
                            <td className="mono" style={{ color: '#991B1B' }}>Rs {p.avgUnitCost}</td>
                            <td className="mono" style={{ fontWeight: 700 }}>{fmtMoney(p.grossRevenue)}</td>
                            <td className="mono" style={{ color: '#991B1B' }}>{fmtMoney(p.totalCogs)}</td>
                            <td className="mono" style={{ color: p.grossProfit >= 0 ? '#166534' : '#DC2626', fontWeight: 700 }}>{fmtMoney(p.grossProfit)}</td>
                            <td style={{ fontWeight: 800 }}>{p.marginPct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ══════════════════ 3. PURCHASES MODULE ══════════════════ */}
          {mainTab === 'Purchases' && (
            <div className="va-panel">
              <div className="va-panel-head"><h3>Mandi Purchase Cost &amp; Rate History Log</h3></div>
              <div style={{ overflowX: 'auto' }}>
                <table className="va-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Supplier / Source</th>
                      <th>Buy Rate (Rs/Unit)</th>
                      <th>Purchase Qty</th>
                      <th>Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costAnalysis.map(h => (
                      <tr key={h.id}>
                        <td>{fmtDate(h.date)}</td>
                        <td><strong>{h.productName}</strong></td>
                        <td>{h.category}</td>
                        <td>{h.supplierName}</td>
                        <td className="mono" style={{ fontWeight: 700, color: '#0369A1' }}>Rs {h.buyPrice}</td>
                        <td className="mono">{h.qty}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{fmtMoney(h.totalSpent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════ 4. INVENTORY MODULE ══════════════════ */}
          {mainTab === 'Inventory' && valuationReport && (
            <div className="va-panel">
              <div className="va-panel-head" style={{ justifyContent: 'space-between' }}>
                <h3>Inventory Valuation (Weighted Average Cost Basis)</h3>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>
                  Total Valuation: <strong>{fmtMoney(valuationReport.summary?.totalAvgCostValue ?? 0)}</strong>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="va-table">
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th>Category</th>
                      <th>Current Stock</th>
                      <th>Average Cost</th>
                      <th>Latest Buy Rate</th>
                      <th>Avg Cost Valuation</th>
                      <th>Latest Buy Valuation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuationReport.data?.map((item: any) => (
                      <tr key={item.id}>
                        <td><strong>{item.productName}</strong></td>
                        <td>{item.category}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{item.qty} {item.unit}</td>
                        <td className="mono">Rs {item.avgCost.toFixed(2)}</td>
                        <td className="mono">Rs {item.currentBuyPrice.toFixed(2)}</td>
                        <td className="mono" style={{ fontWeight: 700, color: '#16A34A' }}>{fmtMoney(item.avgCostValuation)}</td>
                        <td className="mono" style={{ fontWeight: 700, color: '#0369A1' }}>{fmtMoney(item.latestBuyValuation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════ 5. FINANCE MODULE ══════════════════ */}
          {mainTab === 'Finance' && balanceSheet && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
              <div className="va-panel">
                <div className="va-panel-head"><h3>Balance Sheet Statement - Assets</h3></div>
                <table className="va-table">
                  <tbody>
                    {balanceSheet.assets?.cashAccounts?.map((c: any, i: number) => (
                      <tr key={i}>
                        <td>{c.name}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(c.balance)}</td>
                      </tr>
                    ))}
                    {balanceSheet.assets?.bankAccounts?.map((b: any, i: number) => (
                      <tr key={i}>
                        <td>{b.name}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(b.balance)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>Accounts Receivable (Client Dues)</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#B45309', fontWeight: 700 }}>{fmtMoney(balanceSheet.assets?.receivables ?? 0)}</td>
                    </tr>
                    <tr>
                      <td>Inventory Asset Value</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#16A34A', fontWeight: 700 }}>{fmtMoney(balanceSheet.assets?.inventoryAssetValue ?? 0)}</td>
                    </tr>
                    <tr style={{ background: '#F0FDF4', fontWeight: 800, fontSize: 15 }}>
                      <td>TOTAL ASSETS</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#15803D' }}>{fmtMoney(balanceSheet.assets?.totalAssets ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="va-panel">
                <div className="va-panel-head"><h3>Liabilities &amp; Equity</h3></div>
                <table className="va-table">
                  <tbody>
                    <tr>
                      <td>Accounts Payable (Supplier Dues)</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#991B1B', fontWeight: 700 }}>{fmtMoney(balanceSheet.liabilities?.payables ?? 0)}</td>
                    </tr>
                    <tr style={{ background: '#FEF2F2', fontWeight: 800 }}>
                      <td>TOTAL LIABILITIES</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#991B1B' }}>{fmtMoney(balanceSheet.liabilities?.totalLiabilities ?? 0)}</td>
                    </tr>
                    <tr style={{ borderTop: '2px solid #E2E8F0' }}>
                      <td>Retained Equity</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(balanceSheet.equity?.retainedEarnings ?? 0)}</td>
                    </tr>
                    <tr style={{ background: '#F8FAFC', fontWeight: 800, fontSize: 15 }}>
                      <td>TOTAL LIABILITIES &amp; EQUITY</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney((balanceSheet.liabilities?.totalLiabilities ?? 0) + (balanceSheet.equity?.retainedEarnings ?? 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════ 6. MANAGEMENT ANALYTICS MODULE ══════════════════ */}
          {mainTab === 'Management Analytics' && execData && (
            <div className="va-panel">
              <div className="va-panel-head"><h3>Financial Risk &amp; Management Analytics</h3></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {execData.alerts?.map(alert => (
                  <div key={alert.id} style={{ padding: '16px 20px', borderRadius: 10, background: alert.type === 'DANGER' ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${alert.type === 'DANGER' ? '#FCA5A5' : '#FDE68A'}` }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: alert.type === 'DANGER' ? '#991B1B' : '#92400E', marginBottom: 4 }}>
                      {alert.title}
                    </div>
                    <div style={{ fontSize: 13, color: alert.type === 'DANGER' ? '#7F1D1D' : '#78350F' }}>
                      {alert.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Invoice Profitability Line-Item Modal Inspector */}
      {selectedInvoiceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 14, maxWidth: 700, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Invoice Profitability Breakdown</h3>
                <div style={{ fontSize: 12, color: '#64748B' }}>Invoice: <strong>{selectedInvoiceModal.invoiceNo}</strong> | Customer: <strong>{selectedInvoiceModal.clientName}</strong></div>
              </div>
              <button className="va-btn small outline" onClick={() => setSelectedInvoiceModal(null)}>Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16, background: '#F8FAFC', padding: 12, borderRadius: 8 }}>
              <div><span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Net Sales</span><strong style={{ fontSize: 15 }}>{fmtMoney(selectedInvoiceModal.netSales)}</strong></div>
              <div><span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>COGS</span><strong style={{ fontSize: 15, color: '#991B1B' }}>{fmtMoney(selectedInvoiceModal.cogs)}</strong></div>
              <div><span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Gross Profit</span><strong style={{ fontSize: 15, color: '#166534' }}>{fmtMoney(selectedInvoiceModal.grossProfit)} ({selectedInvoiceModal.grossMarginPct}%)</strong></div>
            </div>

            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Itemized Cost Basis &amp; Line Margins</h4>
            <table className="va-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Sell Rate</th>
                  <th>Cost Basis</th>
                  <th>Line Revenue</th>
                  <th>Line COGS</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoiceModal.items?.map((item: any) => (
                  <tr key={item.id}>
                    <td><strong>{item.itemName}</strong></td>
                    <td className="mono">{item.qty} {item.unit}</td>
                    <td className="mono">Rs {item.rate}</td>
                    <td className="mono" style={{ color: '#991B1B' }}>Rs {item.costPrice}</td>
                    <td className="mono">{fmtMoney(item.amount)}</td>
                    <td className="mono" style={{ color: '#991B1B' }}>{fmtMoney(item.itemCogs)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: item.grossProfit >= 0 ? '#166534' : '#DC2626' }}>
                      {fmtMoney(item.grossProfit)} ({item.grossMarginPct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </DashboardLayout>
  );
}
