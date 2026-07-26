'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, todayInputDate, dateOffset } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, invalidateCache, TTL_SHORT, TTL_MEDIUM } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonChart, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow, MobileCardBox } from '@/components/ui/MobileCard';

type Tab = 'Overview' | 'Sales' | 'Purchases' | 'Collections' | 'Inventory' | 'Expenses' | 'Aging' | 'Cash Flow';

interface PnlSummary {
  revenue:        number;
  cogs:           number;
  transport:      number;
  discounts:      number;
  expenses:       number;
  collected:      number;
  grossProfit:    number;
  netProfit:      number;
  grossMarginPct: number;
  netMarginPct:   number;
  salesCount:     number;
  purchasesCount: number;
  wastageCount:   number;
}

interface ExpenseCategory { category: string; total: number; }
interface TrendEntry      { date: string; sales: number; purchases: number; expenses: number; profit: number; }
interface TopItemEntry    { name: string; total: number; qty: number; }

interface PnlReport {
  period:             { from: string; to: string };
  summary:            PnlSummary;
  expensesByCategory: ExpenseCategory[];
  trend:              TrendEntry[];
  topItems:           TopItemEntry[];
}

interface CashFlowReport {
  period:      { from: string; to: string };
  inflow:      { collections: number; total: number };
  outflow:     { purchases: number; expenses: number; supplierPayments: number; total: number };
  netCashFlow: number;
  trend:       { date: string; inflow: number; outflow: number; net: number }[];
}

interface AgingClient { id: string; clientId?: string | null; name: string; phone?: string; rating: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number; }
interface AgingReport {
  clients: AgingClient[];
  totals:  { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [from, setFrom] = useState(() => dateOffset(-30));
  const [to, setTo]     = useState(() => todayInputDate());

  const [pnl,      setPnl]      = useState<PnlReport | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowReport | null>(null);
  const [aging,    setAging]    = useState<AgingReport | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const loadReports = useCallback(async (showLoadingSpinner = false) => {
    if (showLoadingSpinner && (!pnl || !cashFlow || !aging)) setLoading(true);
    try {
      const [pd, cfd, agd] = await Promise.all([
        fetchWithCache<PnlReport>(`/api/reports/pnl?from=${from}&to=${to}`, { ttl: TTL_SHORT, forceRefresh: !showLoadingSpinner }),
        fetchWithCache<CashFlowReport>(`/api/reports/cashflow?from=${from}&to=${to}`, { ttl: TTL_SHORT, forceRefresh: !showLoadingSpinner }),
        fetchWithCache<AgingReport>('/api/reports/aging', { ttl: TTL_MEDIUM, forceRefresh: !showLoadingSpinner }),
      ]);
      if (pd)  setPnl(pd);
      if (cfd) setCashFlow(cfd);
      if (agd) setAging(agd);
      setLastSyncTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, [from, to, pnl, cashFlow, aging]);

  // Initial load & date filter change
  useEffect(() => { loadReports(true); }, [loadReports]);

  // Real-Time Sync: Periodic 10-second polling & Window Focus sync
  useEffect(() => {
    const interval = setInterval(() => {
      loadReports(false);
    }, 10000);

    const onFocus = () => {
      loadReports(false);
    };

    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadReports]);

  // Max value calculators for custom CSS bar charts
  const maxVegTotal = (pnl?.topItems && pnl.topItems.length > 0) ? Math.max(...pnl.topItems.map(x => x.total), 1) : 1;
  const maxCatExp   = (pnl?.expensesByCategory && pnl.expensesByCategory.length > 0) ? Math.max(...pnl.expensesByCategory.map(x => x.total), 1) : 1;

  const RATING_EMOJI: Record<string, string> = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', NEW: '⚪' };

  return (
    <DashboardLayout>
      {/* Date Range Selector & Real-Time Sync Badge */}
      <div className="va-panel" style={{ padding: '14px 20px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748B' }}>From</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ display: 'block', padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#F8FAFC', fontSize: 13, fontWeight: 600 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748B' }}>To</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ display: 'block', padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#F8FAFC', fontSize: 13, fontWeight: 600 }} />
            </div>
            <button className="va-btn small" style={{ fontWeight: 700, borderRadius: '6px' }} onClick={() => loadReports(true)}>↻ Refresh Financials</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F0FDF4', border: '1px solid #DCFCE7', padding: '6px 12px', borderRadius: '20px' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#16A34A', boxShadow: '0 0 0 3px rgba(22, 163, 74, 0.2)' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#166534' }}>
              Real-Time Sync Active {lastSyncTime && `(Last updated: ${lastSyncTime})`}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="va-tabs-inline">
        {(['Overview', 'Sales', 'Purchases', 'Cash Flow', 'Aging', 'Expenses'] as Tab[]).map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {loading ? (
        <div className="va-loading">Compiling database financials…</div>
      ) : (
        <>
          {/* ─── Overview ─── */}
          {tab === 'Overview' && pnl && (
            <>
              <div className="va-cards">
                <div className="va-card accent">
                  <div className="label">Total Revenue</div>
                  <div className="value">{fmtMoney(pnl.summary.revenue)}</div>
                  <div className="foot">{pnl.summary.salesCount} invoices</div>
                </div>
                <div className="va-card">
                  <div className="label">Net Profit</div>
                  <div className={`value ${pnl.summary.netProfit < 0 ? 'neg' : ''}`}>{fmtMoney(pnl.summary.netProfit)}</div>
                  <div className="foot">{pnl.summary.netMarginPct}% net margin</div>
                </div>
                <div className="va-card">
                  <div className="label">Receivables Dues</div>
                  <div className="value" style={{ color: (aging?.totals.total ?? 0) > 0 ? 'var(--clay)' : 'var(--ok)' }}>
                    {fmtMoney(aging?.totals.total ?? 0)}
                  </div>
                  <div className="foot">overdue client balances</div>
                </div>
                <div className="va-card">
                  <div className="label">Collection Rate</div>
                  <div className="value">
                    {pnl.summary.revenue > 0 ? ((pnl.summary.collected / pnl.summary.revenue) * 100).toFixed(0) : 0}%
                  </div>
                  <div className="foot">of revenue collected</div>
                </div>
              </div>

              {/* Profit Loss Summary sheet */}
              <div className="va-panel">
                <div className="va-panel-head"><h3>Profit &amp; Loss Statement</h3></div>
                
                {/* Desktop Table View */}
                <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                  <table className="va-table">
                    <tbody>
                      <tr>
                        <td><strong>Gross Revenue</strong> (Subtotal - Discount)</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(pnl.summary.revenue)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 24, color: 'var(--muted)' }}>Discounts Given</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmtMoney(pnl.summary.discounts)}</td>
                      </tr>
                      <tr style={{ borderTop: '1.5px solid var(--line)' }}>
                        <td><strong>Cost of Goods Sold (COGS)</strong></td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--clay)' }}>-{fmtMoney(pnl.summary.cogs)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 24, color: 'var(--muted)' }}>Transport Costs</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>{pnl.summary.transport > 0 ? fmtMoney(pnl.summary.transport) : '—'}</td>
                      </tr>
                      <tr style={{ background: 'var(--line-soft)', fontWeight: 700 }}>
                        <td>Gross Profit</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--ok)' }}>{fmtMoney(pnl.summary.grossProfit)} ({pnl.summary.grossMarginPct}%)</td>
                      </tr>
                      <tr>
                        <td><strong>Operating Expenses</strong></td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--clay)' }}>-{fmtMoney(pnl.summary.expenses)}</td>
                      </tr>
                      <tr style={{ background: 'var(--forest)', color: 'var(--cream)', fontWeight: 700, fontSize: 15 }}>
                        <td>Net Profit</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(pnl.summary.netProfit)} ({pnl.summary.netMarginPct}%)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '8px' }}>
                  <MobileCardBox title="Revenue &amp; COGS Summary" bg="#F8FAFC" borderColor="#CBD5E1">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <MobileCardRow label="Gross Revenue" value={fmtMoney(pnl.summary.revenue)} isMono />
                      <MobileCardRow label="Discounts Given" value={`-${fmtMoney(pnl.summary.discounts)}`} valueColor="#991B1B" isMono />
                      <MobileCardRow label="Cost of Goods Sold (COGS)" value={`-${fmtMoney(pnl.summary.cogs)}`} valueColor="#991B1B" isMono />
                      <MobileCardRow label="Transport Costs" value={pnl.summary.transport > 0 ? fmtMoney(pnl.summary.transport) : '—'} isMono />
                      
                      <div style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />
                      
                      <MobileCardRow 
                        label="Gross Profit" 
                        value={`${fmtMoney(pnl.summary.grossProfit)} (${pnl.summary.grossMarginPct}%)`} 
                        valueColor="#166534" 
                        isMono 
                      />
                      <MobileCardRow label="Operating Expenses" value={`-${fmtMoney(pnl.summary.expenses)}`} valueColor="#991B1B" isMono />
                      
                      <div style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />
                      
                      <div style={{
                        background: '#1E5E3A',
                        color: '#FFFFFF',
                        padding: '12px 14px',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontWeight: 700,
                        marginTop: '4px'
                      }}>
                        <span>Net Profit</span>
                        <span className="mono" style={{ fontSize: '15px' }}>
                          {fmtMoney(pnl.summary.netProfit)} ({pnl.summary.netMarginPct}%)
                        </span>
                      </div>
                    </div>
                  </MobileCardBox>
                </div>
              </div>
            </>
          )}

          {/* ─── Sales tab ─── */}
          {tab === 'Sales' && pnl && (
            <div className="va-panel">
              <div className="va-panel-head"><h3>Top Vegetables &amp; Fruits Revenue</h3></div>
              {!pnl?.topItems || pnl.topItems.length === 0 ? (
                <div className="va-empty">No sales entries for this range</div>
              ) : (
                pnl.topItems.map(item => (
                  <div className="va-bar-row" key={item.name}>
                    <div className="va-bar-label"><strong>{item.name}</strong></div>
                    <div className="va-bar-track">
                      <div className="va-bar-fill" style={{ width: `${(item.total / maxVegTotal) * 100}%` }} />
                    </div>
                    <div className="va-bar-val mono" style={{ fontWeight: 600 }}>{fmtMoney(item.total)} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>({item.qty.toFixed(0)} units)</span></div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ─── Purchases tab ─── */}
          {tab === 'Purchases' && pnl && (
            <div className="va-panel">
              <div className="va-panel-head"><h3>COGS Analytics</h3></div>
              <div className="va-cards" style={{ marginBottom: 18 }}>
                <div className="va-card">
                  <div className="label">Cost of Mandi Purchases</div>
                  <div className="value">{fmtMoney(pnl.summary.cogs)}</div>
                  <div className="foot">{pnl.summary.purchasesCount} sheets</div>
                </div>
                <div className="va-card">
                  <div className="label">Transport Cost</div>
                  <div className="value">{pnl.summary.transport > 0 ? fmtMoney(pnl.summary.transport) : 'Rs 0'}</div>
                  <div className="foot">mandi delivery log</div>
                </div>
                <div className="va-card">
                  <div className="label">% of Revenue</div>
                  <div className="value">{pnl.summary.revenue > 0 ? ((pnl.summary.cogs / pnl.summary.revenue) * 100).toFixed(0) : 0}%</div>
                  <div className="foot">purchase ratio</div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Cash Flow tab ─── */}
          {tab === 'Cash Flow' && cashFlow && (
            <>
              <div className="va-cards">
                <div className="va-card accent">
                  <div className="label">Cash Inflow</div>
                  <div className="value" style={{ color: 'var(--ok)' }}>{fmtMoney(cashFlow.inflow?.total ?? 0)}</div>
                  <div className="foot">collections received</div>
                </div>
                <div className="va-card">
                  <div className="label">Cash Outflow</div>
                  <div className="value" style={{ color: 'var(--danger)' }}>-{fmtMoney(cashFlow.outflow?.total ?? 0)}</div>
                  <div className="foot">purchases + expenses + supplier payments</div>
                </div>
                <div className="va-card">
                  <div className="label">Net Cash Flow</div>
                  <div className={`value ${(cashFlow.netCashFlow ?? 0) < 0 ? 'neg' : ''}`}>{fmtMoney(cashFlow.netCashFlow ?? 0)}</div>
                  <div className="foot">operational net gain</div>
                </div>
              </div>

              {/* Cash Flow Statement */}
              <div className="va-panel">
                <div className="va-panel-head"><h3>Cash Inflows and Outflows</h3></div>
                
                {/* Desktop Table View */}
                <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                  <table className="va-table">
                    <tbody>
                      <tr style={{ background: 'var(--line-soft)', fontWeight: 600 }}>
                        <td>Operating Cash Inflow</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--ok)' }}>+{fmtMoney(cashFlow.inflow?.total ?? 0)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 24 }}>Client Collections</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(cashFlow.inflow?.collections ?? 0)}</td>
                      </tr>
                      <tr style={{ background: 'var(--line-soft)', fontWeight: 600, borderTop: '1.5px solid var(--line)' }}>
                        <td>Operating Cash Outflow</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmtMoney(cashFlow.outflow?.total ?? 0)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 24 }}>Supplier Mandi Payments (Cash/Paid)</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(cashFlow.outflow?.purchases ?? 0)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 24 }}>Operating &amp; Overhead Expenses</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(cashFlow.outflow?.expenses ?? 0)}</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 24 }}>Supplier Balance Payments</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(cashFlow.outflow?.supplierPayments ?? 0)}</td>
                      </tr>
                      <tr style={{ background: 'var(--forest)', color: 'var(--cream)', fontWeight: 700, fontSize: 15 }}>
                        <td>Net Cash Position Increase/Decrease</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(cashFlow.netCashFlow ?? 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '8px' }}>
                  <MobileCardBox title="Cash Flow Breakdown" bg="#F8FAFC" borderColor="#CBD5E1">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <MobileCardRow label="Operating Cash Inflow" value={`+${fmtMoney(cashFlow.inflow?.total ?? 0)}`} valueColor="#166534" isMono />
                      <MobileCardRow label="Client Collections" value={fmtMoney(cashFlow.inflow?.collections ?? 0)} isMono />
                      
                      <div style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />
                      
                      <MobileCardRow label="Operating Cash Outflow" value={`-${fmtMoney(cashFlow.outflow?.total ?? 0)}`} valueColor="#991B1B" isMono />
                      <MobileCardRow label="Supplier Mandi Payments" value={fmtMoney(cashFlow.outflow?.purchases ?? 0)} isMono />
                      <MobileCardRow label="Operating &amp; Overhead Expenses" value={fmtMoney(cashFlow.outflow?.expenses ?? 0)} isMono />
                      <MobileCardRow label="Supplier Balance Payments" value={fmtMoney(cashFlow.outflow?.supplierPayments ?? 0)} isMono />
                      
                      <div style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />
                      
                      <div style={{
                        background: '#1E5E3A',
                        color: '#FFFFFF',
                        padding: '12px 14px',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontWeight: 700,
                        marginTop: '4px'
                      }}>
                        <span>Net Cash Position Change</span>
                        <span className="mono" style={{ fontSize: '15px' }}>
                          {fmtMoney(cashFlow.netCashFlow ?? 0)}
                        </span>
                      </div>
                    </div>
                  </MobileCardBox>
                </div>
              </div>
            </>
          )}

          {/* ─── Aging tab ─── */}
          {tab === 'Aging' && aging && (
            <div className="va-panel">
              <div className="va-panel-head"><h3>Client Receivables Aging (Days Overdue)</h3></div>
              <div className="va-cards" style={{ marginBottom: 18 }}>
                <div className="va-card"><div className="label">Total Dues</div><div className="value">{fmtMoney(aging.totals.total)}</div></div>
                <div className="va-card"><div className="label">Current</div><div className="value">{fmtMoney(aging.totals.current)}</div></div>
                <div className="va-card"><div className="label">30+ Days Overdue</div><div className="value" style={{ color: 'var(--danger)' }}>{fmtMoney(aging.totals.d31_60 + aging.totals.d61_90 + aging.totals.d90plus)}</div></div>
              </div>

              {/* Desktop Table View */}
              <div className="hide-mobile">
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table" style={{ minWidth: 600 }}>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th style={{ textAlign: 'right' }}>Current</th>
                      <th style={{ textAlign: 'right' }}>1–30 Days</th>
                      <th style={{ textAlign: 'right' }}>31–60 Days</th>
                      <th style={{ textAlign: 'right' }}>61–90 Days</th>
                      <th style={{ textAlign: 'right' }}>90+ Days</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.clients.length === 0 ? (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 18 }}>No client receivables</td></tr>
                    ) : (
                      aging.clients.map(c => (
                        <tr key={c.id}>
                          <td>
                            <strong>{RATING_EMOJI[c.rating] ?? ''} {c.name}</strong>
                            <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--muted)', background: '#e9ecef', padding: '1px 4px', borderRadius: 4, marginLeft: 4 }}>
                              {c.clientId || 'WH-0000'}
                            </span>
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{c.current > 0 ? fmtMoney(c.current) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{c.d1_30 > 0 ? fmtMoney(c.d1_30) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right', color: c.d31_60 > 0 ? 'var(--mustard)' : undefined }}>{c.d31_60 > 0 ? fmtMoney(c.d31_60) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right', color: c.d61_90 > 0 ? 'var(--clay)' : undefined }}>{c.d61_90 > 0 ? fmtMoney(c.d61_90) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right', color: c.d90plus > 0 ? 'var(--danger)' : undefined, fontWeight: c.d90plus > 0 ? 600 : undefined }}>{c.d90plus > 0 ? fmtMoney(c.d90plus) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(c.total)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                </div>
              </div>

              {/* Mobile Card List View */}
              <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
                {aging.clients.length === 0 ? (
                  <div className="va-empty">No client receivables</div>
                ) : (
                  aging.clients.map(c => (
                    <MobileCard
                      key={c.id}
                      title={c.name}
                      headerBadge={c.clientId || 'WH-0000'}
                    >
                      <MobileCardRow label="Total Outstanding" value={fmtMoney(c.total)} valueColor="#991B1B" isMono />
                      <MobileCardRow label="Current (Not Overdue)" value={c.current > 0 ? fmtMoney(c.current) : '—'} isMono />
                      <MobileCardRow label="1–30 Days Overdue" value={c.d1_30 > 0 ? fmtMoney(c.d1_30) : '—'} isMono />
                      <MobileCardRow label="31–60 Days Overdue" value={c.d31_60 > 0 ? fmtMoney(c.d31_60) : '—'} valueColor={c.d31_60 > 0 ? '#B45309' : undefined} isMono />
                      <MobileCardRow label="61–90 Days Overdue" value={c.d61_90 > 0 ? fmtMoney(c.d61_90) : '—'} valueColor={c.d61_90 > 0 ? '#C2410C' : undefined} isMono />
                      <MobileCardRow label="90+ Days Overdue" value={c.d90plus > 0 ? fmtMoney(c.d90plus) : '—'} valueColor={c.d90plus > 0 ? '#991B1B' : undefined} isMono />
                    </MobileCard>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ─── Expenses tab ─── */}
          {tab === 'Expenses' && pnl && (
            <div className="va-panel">
              <div className="va-panel-head"><h3>Expenses by Category</h3></div>
              {!pnl?.expensesByCategory || pnl.expensesByCategory.length === 0 ? (
                <div className="va-empty">No expenses recorded for this range</div>
              ) : (
                pnl.expensesByCategory.map(item => (
                  <div className="va-bar-row" key={item.category}>
                    <div className="va-bar-label"><strong>{item.category}</strong></div>
                    <div className="va-bar-track">
                      <div className="va-bar-fill" style={{ width: `${(item.total / maxCatExp) * 100}%` }} />
                    </div>
                    <div className="va-bar-val mono" style={{ fontWeight: 600 }}>{fmtMoney(item.total)}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  );
}
