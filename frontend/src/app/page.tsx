'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate } from '@/utils/formatters';
import { getTodayBusinessDateString, fmtBusinessDate } from '@/utils/businessDate';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';
import Icon from '@mdi/react';
import { mdiChartLine, mdiCalendarSync, mdiTruckDelivery, mdiScaleBalance, mdiAlertCircleOutline, mdiPackageVariant } from '@mdi/js';
import { useRouter } from 'next/navigation';
import { useAppSelector } from '@/store';
import { getDefaultRouteForRole } from '@/utils/rbac';
import { fetchWithCache, getCachedData, TTL_SHORT } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DashboardData {
  selectedBusinessDate?: string;
  isToday?: boolean;
  today: {
    sales:       number;
    salesCount:  number;
    cashSales?:  number;
    creditSales?: number;
    avgOrderValue?: number;
    purchases:   number;
    expenses:    number;
    collections: number;
    grossProfit?: number;
    netProfit?:   number;
    profit:      number;
    cashPosition: number;
    completedDeliveries?: number;
    failedDeliveries?: number;
    pendingDeliveries?: number;
    returnedProducts?: number;
    returnValue?: number;
    netSales?: number;
    wastageCount?: number;
    wastageQty?: number;
  };
  inventory?: {
    totalValue?: number;
    lowStockCount?: number;
  };
  totals: {
    receivables:       number;
    payables:          number;
    clientCount:       number;
    pendingDeliveries: number;
    lowStockCount:     number;
    atRiskClients:     number;
    healthScore:       number;
  };
  attention: { id: string; name: string; balance: number }[];
  recentSales: {
    id: string; invoiceNo: string; client: string;
    total: number; status: string; date: string;
  }[];
}

function healthLabel(score: number) {
  if (score >= 75) return { text: 'Healthy',           color: 'var(--ok)'      };
  if (score >= 50) return { text: 'Fair',               color: 'var(--mustard)' };
  return              { text: 'Needs Attention',     color: 'var(--danger)'  };
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: 'paid', PARTIAL: 'partial', PENDING: 'pending', CANCELLED: 'due',
  };
  return <span className={`va-badge ${map[status] ?? 'pending'}`}>{status}</span>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);
  const todayStr = getTodayBusinessDateString();
  const [selectedDate, setSelectedDate] = useState(() => todayStr);

  const cacheKey = `/api/reports/dashboard?date=${selectedDate}`;
  const [data, setData]       = useState<DashboardData | null>(() => getCachedData<DashboardData>(cacheKey));
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(() => !getCachedData<DashboardData>(cacheKey));

  useEffect(() => {
    if (user) {
      const defaultRoute = getDefaultRouteForRole(user.role);
      if (defaultRoute !== '/') {
        router.replace(defaultRoute);
      }
    }
  }, [user, router]);

  const loadForDate = useCallback(async (targetDate: string, isBackground = false) => {
    const key = `/api/reports/dashboard?date=${targetDate}`;
    if (!isBackground && !getCachedData(key)) setLoading(true);
    try {
      const result = await fetchWithCache<DashboardData>(key, {
        ttl: TTL_SHORT,
        forceRefresh: isBackground,
      });
      if (result) {
        setData(result);
        setError('');
      }
    } catch (err: any) {
      if (err.message?.includes('UNAUTHORIZED')) {
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return;
      }
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForDate(selectedDate, true);
  }, [selectedDate, loadForDate]);

  useEffect(() => {
    if (selectedDate !== todayStr) return; // auto-refresh only on today's view
    const interval = setInterval(() => {
      loadForDate(selectedDate, true);
    }, 20000);

    const handleRevalidate = () => {
      loadForDate(selectedDate, true);
    };

    window.addEventListener('app-revalidate', handleRevalidate);
    return () => {
      clearInterval(interval);
      window.removeEventListener('app-revalidate', handleRevalidate);
    };
  }, [selectedDate, todayStr, loadForDate]);

  const isToday = selectedDate === todayStr;

  if (loading && !data) {
    return (
      <DashboardLayout>
        <div style={{ padding: 16 }}>
          <SkeletonKPI count={6} />
          <SkeletonTable rows={5} cols={4} />
        </div>
      </DashboardLayout>
    );
  }
  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="va-empty">
          <div className="big">Could not load dashboard</div>
          <div style={{ marginTop: 8 }}>{error}</div>
          <button className="va-btn" style={{ marginTop: 16 }} onClick={() => loadForDate(selectedDate, true)}>Retry</button>
        </div>
      </DashboardLayout>
    );
  }

  const { today, totals, attention, recentSales, inventory } = data;
  const health = healthLabel(totals.healthScore);
  const grossProf = today.grossProfit ?? (today.sales - today.purchases);
  const netProf = today.netProfit ?? (grossProf - today.expenses);

  return (
    <DashboardLayout>
      {/* ─── HEADER BAR WITH HISTORICAL BUSINESS DATE SELECTOR ───────────── */}
      <div className="va-panel" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
              <Icon path={mdiChartLine} size={1} color="var(--primary)" />
              <h2 style={{ margin: 0 }}>Executive Analytics Dashboard</h2>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Live 5:00 AM Business Day Tracking &amp; Historical Executive Analytics
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: isToday ? '#F0FDF4' : '#EFF6FF',
              color: isToday ? '#166534' : '#1D4ED8',
              border: `1px solid ${isToday ? '#BBF7D0' : '#BFDBFE'}`
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: isToday ? '#22C55E' : '#3B82F6',
                display: 'inline-block'
              }} />
              {isToday ? 'LIVE TODAY (5:00 AM Start)' : `HISTORICAL (${fmtBusinessDate(selectedDate)})`}
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon path={mdiCalendarSync} size={0.8} color="var(--forest)" />
              <input
                type="date"
                value={selectedDate}
                max={todayStr}
                onChange={e => {
                  if (e.target.value) {
                    setSelectedDate(e.target.value);
                  }
                }}
                style={{
                  padding: '6px 12px', border: '1px solid var(--line)',
                  borderRadius: 6, fontSize: 13, background: 'var(--paper)',
                  fontWeight: 700, color: 'var(--ink)'
                }}
              />
            </div>

            {!isToday && (
              <button
                className="va-btn secondary small"
                onClick={() => setSelectedDate(todayStr)}
                style={{ fontWeight: 700, borderColor: 'var(--forest)', color: 'var(--forest)' }}
              >
                Today
              </button>
            )}
            <button className="va-btn secondary small" onClick={() => loadForDate(selectedDate, true)}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* ─── PRIMARY EXECUTIVE KPI CARDS GRID ───────────────────────────── */}
      <div className="va-cards">
        {/* Sales Card */}
        <div className="va-card accent">
          <div className="label">{isToday ? "Today's Sales" : 'Business Day Sales'}</div>
          <div className="value">{fmtMoney(today.sales)}</div>
          <div className="foot">
            {today.salesCount} invoice{today.salesCount !== 1 ? 's' : ''}
            {today.cashSales !== undefined && ` · Cash: ${fmtMoney(today.cashSales)}`}
          </div>
        </div>

        {/* Collections Card */}
        <div className="va-card">
          <div className="label">{isToday ? "Today's Collections" : 'Day Collections'}</div>
          <div className="value" style={{ color: 'var(--ok)' }}>{fmtMoney(today.collections)}</div>
          <div className="foot">payments received</div>
        </div>

        {/* Purchases Card */}
        <div className="va-card">
          <div className="label">{isToday ? "Today's Purchases" : 'Day Purchases'}</div>
          <div className="value">{fmtMoney(today.purchases)}</div>
          <div className="foot">mandi stock purchases</div>
        </div>

        {/* Expenses Card */}
        <div className="va-card">
          <div className="label">{isToday ? "Today's Expenses" : 'Day Expenses'}</div>
          <div className="value" style={{ color: today.expenses > 0 ? 'var(--clay)' : undefined }}>
            {fmtMoney(today.expenses)}
          </div>
          <div className="foot">operational expenses</div>
        </div>

        {/* Gross Profit */}
        <div className="va-card">
          <div className="label">Gross Profit</div>
          <div className={`value${grossProf < 0 ? ' neg' : ''}`} style={{ color: grossProf >= 0 ? '#166534' : '#DC2626' }}>
            {fmtMoney(grossProf)}
          </div>
          <div className="foot">Net Sales − COGS</div>
        </div>

        {/* Net Profit */}
        <div className="va-card accent">
          <div className="label">Net Profit</div>
          <div className={`value${netProf < 0 ? ' neg' : ''}`} style={{ color: netProf >= 0 ? '#166534' : '#DC2626' }}>
            {fmtMoney(netProf)}
          </div>
          <div className="foot">Gross Profit − Expenses</div>
        </div>

        {/* Inventory Asset Value */}
        <div className="va-card">
          <div className="label">Current Inventory Value</div>
          <div className="value" style={{ color: 'var(--forest)' }}>
            {fmtMoney(inventory?.totalValue ?? 0)}
          </div>
          <div className="foot">Moving Avg Stock Asset</div>
        </div>

        {/* Total Receivables */}
        <div className="va-card">
          <div className="label">Total Receivables</div>
          <div className="value" style={{ color: totals.receivables > 0 ? 'var(--clay)' : undefined }}>
            {fmtMoney(totals.receivables)}
          </div>
          <div className="foot">owed by {totals.clientCount} clients</div>
        </div>

        {/* Deliveries Summary */}
        <div className="va-card">
          <div className="label">Delivery Summary</div>
          <div className="value" style={{ fontSize: 18, color: (today.failedDeliveries || 0) > 0 ? '#DC2626' : undefined }}>
            {today.completedDeliveries ?? 0} Completed / {today.failedDeliveries ?? 0} Failed
          </div>
          <div className="foot">{totals.pendingDeliveries} pending dispatch</div>
        </div>

        {/* Business Health */}
        <div className="va-card">
          <div className="label">Business Health</div>
          <div className="value" style={{ color: health.color, fontSize: 20 }}>{health.text}</div>
          <div className="foot">
            score: {totals.healthScore}/100
            {totals.atRiskClients > 0 && ` · ${totals.atRiskClients} at-risk`}
          </div>
        </div>
      </div>

      {/* ─── LOW STOCK & WASTAGE ALERTS ───────────────────────────────────── */}
      {((inventory?.lowStockCount ?? totals.lowStockCount) > 0 || (today.wastageCount || 0) > 0) && (
        <div className="va-panel" style={{ borderLeft: '3px solid var(--mustard)', padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon path={mdiAlertCircleOutline} size={0.9} color="var(--mustard)" />
              <span style={{ fontWeight: 700, color: 'var(--mustard)' }}>
                {(inventory?.lowStockCount ?? totals.lowStockCount)} low stock product alert(s)
                {(today.wastageCount || 0) > 0 ? ` · ${today.wastageCount} wastage entry recorded (${today.wastageQty || 0} KG)` : ''}
              </span>
            </div>
            <a href="/inventory" className="va-btn secondary small" style={{ fontWeight: 700 }}>
              View Stock Hub →
            </a>
          </div>
        </div>
      )}

      {/* ─── NEEDS COLLECTION (ATTENTION LIST) ───────────────────────────── */}
      {attention.length > 0 && (
        <div className="va-panel">
          <div className="va-panel-head">
            <h3><Icon path={mdiScaleBalance} size={0.8} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Needs Collection (High Dues)</h3>
            <a href="/collections" className="va-btn secondary small" style={{ fontWeight: 700 }}>Collect Payment</a>
          </div>
          {attention.map(c => (
            <div className="va-attn-row" key={c.id}>
              <div className="va-attn-left">
                <span className="va-attn-name">{c.name}</span>
              </div>
              <div className="va-attn-amt">{fmtMoney(c.balance)}</div>
            </div>
          ))}
        </div>
      )}

      {/* ─── BUSINESS DAY LEDGER SUMMARY TABLE ───────────────────────────── */}
      <div className="va-panel">
        <div className="va-panel-head">
          <h3>
            <Icon path={mdiPackageVariant} size={0.8} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Business Day Financial Summary ({fmtBusinessDate(selectedDate)})
          </h3>
        </div>

        {/* Desktop View Table */}
        <div className="hide-mobile">
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="va-table va-table-fit">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="mono" style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Total Sales',        today.sales,       false],
                  ['Cash Sales',         today.cashSales ?? 0, false],
                  ['Credit Sales',       today.creditSales ?? 0, false],
                  ['Purchases',          today.purchases,   false],
                  ['Expenses',           today.expenses,    false],
                  ['Collections',        today.collections, false],
                  ['Gross Profit',       grossProf,         grossProf < 0],
                  ['Net Profit',         netProf,           netProf < 0],
                ].map(([label, val, isNeg]) => (
                  <tr key={label as string} style={{ background: label === 'Gross Profit' || label === 'Net Profit' ? '#F8FAFC' : undefined }}>
                    <td style={{ fontWeight: label === 'Gross Profit' || label === 'Net Profit' ? 700 : 500 }}>{label as string}</td>
                    <td className="mono" style={{
                      textAlign: 'right',
                      fontWeight: 700,
                      color: (isNeg as boolean) ? 'var(--danger)' : label === 'Net Profit' || label === 'Gross Profit' ? 'var(--forest)' : undefined
                    }}>
                      {fmtMoney(val as number)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile View Card List */}
        <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '8px', width: '100%' }}>
          {[
            { label: 'Total Sales', icon: '📈', val: today.sales, isProf: false },
            { label: 'Cash Sales', icon: '💵', val: today.cashSales ?? 0, isProf: false },
            { label: 'Credit Sales', icon: '💳', val: today.creditSales ?? 0, isProf: false },
            { label: 'Purchases', icon: '🛒', val: today.purchases, isProf: false },
            { label: 'Expenses', icon: '💸', val: today.expenses, isProf: false, isExp: true },
            { label: 'Collections', icon: '📥', val: today.collections, isProf: false },
            { label: 'Gross Profit', icon: '📊', val: grossProf, isProf: true, isHighlight: true },
            { label: 'Net Profit', icon: '🏆', val: netProf, isProf: true, isHighlight: true, isAccent: true },
          ].map(item => {
            const isNeg = item.val < 0;
            return (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: item.isAccent
                    ? (isNeg ? '#FEF2F2' : '#F0FDF4')
                    : item.isHighlight
                    ? '#F8FAFC'
                    : '#FFFFFF',
                  border: `1px solid ${
                    item.isAccent
                      ? (isNeg ? '#FCA5A5' : '#86EFAC')
                      : item.isHighlight
                      ? '#CBD5E1'
                      : '#E2E8F0'
                  }`,
                  boxShadow: item.isAccent ? '0 2px 6px rgba(0,0,0,0.03)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  <span style={{
                    fontSize: 13,
                    fontWeight: item.isProf ? 700 : 600,
                    color: item.isAccent
                      ? (isNeg ? '#991B1B' : '#166534')
                      : '#0F172A'
                  }}>
                    {item.label}
                  </span>
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: isNeg
                      ? '#DC2626'
                      : item.isProf
                      ? '#166534'
                      : item.isExp && item.val > 0
                      ? '#C5221F'
                      : '#0F172A',
                  }}
                >
                  {fmtMoney(item.val)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── RECENT ORDERS FOR SELECTED BUSINESS DAY ─────────────────────── */}
      {recentSales.length > 0 && (
        <div className="va-panel">
          <div className="va-panel-head">
            <h3>Orders for {fmtBusinessDate(selectedDate)}</h3>
            <a href="/sales" className="va-btn secondary small" style={{ fontWeight: 700 }}>View Sales Register</a>
          </div>
          
          <div className="hide-mobile">
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table className="va-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Client</th>
                    <th>Date &amp; Time</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map(s => (
                    <tr key={s.id}>
                      <td className="mono" style={{ color: 'var(--forest)', fontWeight: 700 }}>{s.invoiceNo}</td>
                      <td style={{ fontWeight: 600 }}>{s.client}</td>
                      <td style={{ color: 'var(--muted)' }}>{fmtDate(s.date)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(s.total)}</td>
                      <td><StatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card List View */}
          <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
            {recentSales.map(s => {
              const isPaid = s.status === 'PAID';
              const isPartial = s.status === 'PARTIAL';
              return (
                <MobileCard
                  key={s.id}
                  title={s.invoiceNo}
                  headerBadge={fmtDate(s.date)}
                  footer={
                    <a 
                      href="/sales" 
                      className="va-btn small" 
                      style={{ width: '100%', textAlign: 'center', textDecoration: 'none', fontWeight: 700 }}
                    >
                      👁️ View Sales Register
                    </a>
                  }
                >
                  <MobileCardRow label="Customer" value={s.client} />
                  <MobileCardRow label="Invoice Amount" value={fmtMoney(s.total)} isMono />
                  <MobileCardRow label="Status">
                    <MobileCardBadge variant={isPaid ? 'green' : isPartial ? 'yellow' : 'red'}>
                      {s.status}
                    </MobileCardBadge>
                  </MobileCardRow>
                </MobileCard>
              );
            })}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
