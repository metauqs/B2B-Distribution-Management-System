'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney } from '@/utils/formatters';
import { getTodayBusinessDateString, fmtBusinessDate } from '@/utils/businessDate';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';
import Icon from '@mdi/react';
import {
  mdiChartLine,
  mdiCalendarSync,
  mdiTruckDelivery,
  mdiScaleBalance,
  mdiAlertCircleOutline,
  mdiPackageVariant,
  mdiCashMultiple,
  mdiCartOutline,
  mdiReceiptTextOutline,
  mdiWalletOutline,
  mdiTrendingUp,
  mdiAccountGroupOutline,
  mdiRefresh,
  mdiShieldCheckOutline
} from '@mdi/js';
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
  if (score >= 75) return { text: 'Healthy',        color: '#166534', bg: '#F0FDF4', border: '#BBF7D0' };
  if (score >= 50) return { text: 'Fair',           color: '#B45309', bg: '#FEF3C7', border: '#FDE68A' };
  return              { text: 'Needs Attention', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' };
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: 'paid',
    PARTIAL: 'partial',
    PENDING: 'pending',
    CANCELLED: 'due',
  };
  return <span className={`va-badge ${map[status] ?? 'pending'}`}>{status}</span>;
}

// ─── Main Dashboard Component ─────────────────────────────────────────────────
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

  const loadForDate = useCallback(async (targetDate: string, showLoadingSpinner = false) => {
    const key = `/api/reports/dashboard?date=${targetDate}`;
    if (showLoadingSpinner && !getCachedData(key)) setLoading(true);
    try {
      const result = await fetchWithCache<DashboardData>(key, {
        ttl: TTL_SHORT,
        forceRefresh: !showLoadingSpinner,
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
    loadForDate(selectedDate, false);
  }, [selectedDate, loadForDate]);

  useEffect(() => {
    if (selectedDate !== todayStr) return; // auto-refresh only on today's view
    const interval = setInterval(() => {
      loadForDate(selectedDate, false);
    }, 30000);

    const handleRevalidate = () => {
      loadForDate(selectedDate, false);
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
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SkeletonKPI count={6} />
          <SkeletonTable rows={5} cols={4} />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="va-empty" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div className="big" style={{ fontSize: 20, fontWeight: 700, color: 'var(--forest)' }}>Could not load dashboard</div>
          <div style={{ marginTop: 8, color: 'var(--muted)' }}>{error}</div>
          <button className="va-btn" style={{ marginTop: 16 }} onClick={() => loadForDate(selectedDate, true)}>
            Retry
          </button>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1600, margin: '0 auto', width: '100%' }}>

        {/* ─── 1. EXECUTIVE HEADER & BUSINESS DATE CONTROLLER ─────────────── */}
        <div
          className="va-panel"
          style={{
            padding: '16px 20px',
            borderRadius: 12,
            background: 'var(--paper, #FFFDF8)',
            border: '1px solid var(--line, #DCE0D2)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            
            {/* Title & Subtitle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'rgba(31, 61, 43, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <Icon path={mdiChartLine} size={1.1} color="var(--forest)" />
              </div>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--forest)', margin: 0, letterSpacing: '-0.01em' }}>
                  Executive Analytics Dashboard
                </h2>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: '2px 0 0 0', fontWeight: 500 }}>
                  Live 5:00 AM Business Day Tracking &amp; Historical Executive Analytics
                </p>
              </div>
            </div>

            {/* Live Pill & Date Selectors */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              
              {/* Status Badge */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  background: isToday ? '#F0FDF4' : '#EFF6FF',
                  color: isToday ? '#166534' : '#1D4ED8',
                  border: `1px solid ${isToday ? '#BBF7D0' : '#BFDBFE'}`,
                  letterSpacing: '0.02em'
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: isToday ? '#22C55E' : '#3B82F6',
                    display: 'inline-block',
                    boxShadow: isToday ? '0 0 0 2px rgba(34, 197, 94, 0.2)' : 'none'
                  }}
                />
                {isToday ? 'LIVE TODAY (5:00 AM Start)' : `HISTORICAL (${fmtBusinessDate(selectedDate)})`}
              </div>

              {/* Date Input */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#FFFFFF',
                  border: '1px solid var(--line, #DCE0D2)',
                  borderRadius: 8,
                  padding: '3px 8px',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                }}
              >
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
                    border: 'none',
                    outline: 'none',
                    fontSize: 13,
                    background: 'transparent',
                    fontWeight: 700,
                    color: 'var(--ink)',
                    cursor: 'pointer'
                  }}
                />
              </div>

              {/* Today Button */}
              {!isToday && (
                <button
                  className="va-btn secondary small"
                  onClick={() => setSelectedDate(todayStr)}
                  style={{ fontWeight: 700, borderColor: 'var(--forest)', color: 'var(--forest)', borderRadius: 8 }}
                >
                  Today
                </button>
              )}

              {/* Refresh Button */}
              <button
                className="va-btn secondary small"
                onClick={() => loadForDate(selectedDate, true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, borderRadius: 8 }}
              >
                <Icon path={mdiRefresh} size={0.7} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* ─── 2. PRIMARY EXECUTIVE KPI CARDS GRID ────────────────────────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
            width: '100%'
          }}
        >
          {/* 1. Today's Sales Card */}
          <div
            className="va-card accent"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #FFFFFF 0%, #F4FBF6 100%)',
              border: '1px solid #C6E7D2',
              borderTop: '3px solid var(--forest)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--forest)' }}>
                {isToday ? "Today's Sales" : 'Business Day Sales'}
              </span>
              <Icon path={mdiReceiptTextOutline} size={0.85} color="var(--forest)" />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: 'var(--forest)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(today.sales)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              {today.salesCount} invoice{today.salesCount !== 1 ? 's' : ''}
              {today.cashSales !== undefined && ` · Cash: ${fmtMoney(today.cashSales)}`}
            </div>
          </div>

          {/* 2. Today's Collections Card */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line, #DCE0D2)',
              borderTop: '3px solid #166534',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#166534' }}>
                {isToday ? "Today's Collections" : 'Day Collections'}
              </span>
              <Icon path={mdiCashMultiple} size={0.85} color="#166534" />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: '#166534',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(today.collections)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              payments received
            </div>
          </div>

          {/* 3. Today's Purchases Card */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line, #DCE0D2)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink)' }}>
                {isToday ? "Today's Purchases" : 'Day Purchases'}
              </span>
              <Icon path={mdiCartOutline} size={0.85} color="var(--muted)" />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(today.purchases)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              mandi stock purchases
            </div>
          </div>

          {/* 4. Today's Expenses Card */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line, #DCE0D2)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: today.expenses > 0 ? '#B5533C' : 'var(--ink)' }}>
                {isToday ? "Today's Expenses" : 'Day Expenses'}
              </span>
              <Icon path={mdiWalletOutline} size={0.85} color={today.expenses > 0 ? '#B5533C' : 'var(--muted)'} />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: today.expenses > 0 ? '#B5533C' : 'var(--ink)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(today.expenses)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              operational expenses
            </div>
          </div>

          {/* 5. Gross Profit */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line, #DCE0D2)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: grossProf >= 0 ? '#166534' : '#DC2626' }}>
                Gross Profit
              </span>
              <Icon path={mdiTrendingUp} size={0.85} color={grossProf >= 0 ? '#166534' : '#DC2626'} />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: grossProf >= 0 ? '#166534' : '#DC2626',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(grossProf)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              Net Sales − COGS
            </div>
          </div>

          {/* 6. Net Profit */}
          <div
            className="va-card accent"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #FFFFFF 0%, #F0FDF4 100%)',
              border: `1px solid ${netProf >= 0 ? '#86EFAC' : '#FCA5A5'}`,
              borderTop: `3px solid ${netProf >= 0 ? '#166534' : '#DC2626'}`,
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: netProf >= 0 ? '#166534' : '#DC2626' }}>
                Net Profit
              </span>
              <Icon path={mdiTrendingUp} size={0.85} color={netProf >= 0 ? '#166534' : '#DC2626'} />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: netProf >= 0 ? '#166534' : '#DC2626',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(netProf)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              Gross Profit − Expenses
            </div>
          </div>

          {/* 7. Current Inventory Value */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line, #DCE0D2)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--forest)' }}>
                Current Inventory Value
              </span>
              <Icon path={mdiPackageVariant} size={0.85} color="var(--forest)" />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: 'var(--forest)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(inventory?.totalValue ?? 0)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              Moving Avg Stock Asset
            </div>
          </div>

          {/* 8. Total Receivables */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line, #DCE0D2)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: totals.receivables > 0 ? '#B5533C' : 'var(--ink)' }}>
                Total Receivables
              </span>
              <Icon path={mdiAccountGroupOutline} size={0.85} color={totals.receivables > 0 ? '#B5533C' : 'var(--muted)'} />
            </div>
            <div
              className="mono"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: totals.receivables > 0 ? '#B5533C' : 'var(--ink)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1
              }}
            >
              {fmtMoney(totals.receivables)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              owed by {totals.clientCount} clients
            </div>
          </div>

          {/* 9. Delivery Summary */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#FFFFFF',
              border: '1px solid var(--line, #DCE0D2)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: (today.failedDeliveries || 0) > 0 ? '#DC2626' : 'var(--ink)' }}>
                Delivery Summary
              </span>
              <Icon path={mdiTruckDelivery} size={0.85} color="var(--forest)" />
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: (today.failedDeliveries || 0) > 0 ? '#DC2626' : 'var(--forest)',
                letterSpacing: '-0.01em',
                lineHeight: 1.2
              }}
            >
              {today.completedDeliveries ?? 0} Completed / {today.failedDeliveries ?? 0} Failed
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              {totals.pendingDeliveries} pending dispatch
            </div>
          </div>

          {/* 10. Business Health */}
          <div
            className="va-card"
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: health.bg,
              border: `1px solid ${health.border}`,
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: health.color }}>
                Business Health
              </span>
              <Icon path={mdiShieldCheckOutline} size={0.85} color={health.color} />
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: health.color,
                letterSpacing: '-0.01em',
                lineHeight: 1.1
              }}
            >
              {health.text}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 6 }}>
              score: {totals.healthScore}/100{totals.atRiskClients > 0 && ` · ${totals.atRiskClients} at-risk`}
            </div>
          </div>
        </div>

        {/* ─── 3. LOW STOCK & WASTAGE ALERTS ──────────────────────────────── */}
        {((inventory?.lowStockCount ?? totals.lowStockCount) > 0 || (today.wastageCount || 0) > 0) && (
          <div
            className="va-panel"
            style={{
              borderLeft: '4px solid var(--mustard, #C99A2E)',
              borderRadius: 10,
              padding: '14px 18px',
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderLeftWidth: 4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: '#FEF3C7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <Icon path={mdiAlertCircleOutline} size={0.9} color="#B45309" />
                </div>
                <span style={{ fontWeight: 700, color: '#92400E', fontSize: 13 }}>
                  {(inventory?.lowStockCount ?? totals.lowStockCount)} low stock product alert(s)
                  {(today.wastageCount || 0) > 0 ? ` · ${today.wastageCount} wastage entry recorded (${today.wastageQty || 0} KG)` : ''}
                </span>
              </div>
              <a
                href="/inventory"
                className="va-btn secondary small"
                style={{
                  fontWeight: 700,
                  borderRadius: 6,
                  borderColor: '#D97706',
                  color: '#92400E',
                  background: '#FFFFFF'
                }}
              >
                View Stock Hub →
              </a>
            </div>
          </div>
        )}

        {/* ─── 4. EXECUTIVE SECTION (FINANCIAL SUMMARY + NEEDS COLLECTION) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: attention.length > 0 ? 'minmax(0, 1.4fr) minmax(0, 1fr)' : '1fr', gap: 16 }}>
          
          {/* Financial Summary Table */}
          <div
            className="va-panel"
            style={{
              borderRadius: 12,
              background: 'var(--paper, #FFFDF8)',
              border: '1px solid var(--line, #DCE0D2)',
              padding: '16px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
            }}
          >
            <div className="va-panel-head" style={{ marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--line-soft, #EDEFE6)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--forest)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon path={mdiPackageVariant} size={0.9} color="var(--forest)" />
                Business Day Financial Summary ({fmtBusinessDate(selectedDate)})
              </h3>
            </div>

            {/* Desktop Table View */}
            <div className="hide-mobile">
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table va-table-fit" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--line, #DCE0D2)' }}>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Category</th>
                      <th className="mono" style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Amount</th>
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
                    ].map(([label, val, isNeg]) => {
                      const isProfit = label === 'Gross Profit' || label === 'Net Profit';
                      return (
                        <tr
                          key={label as string}
                          style={{
                            borderBottom: '1px solid var(--line-soft, #EDEFE6)',
                            background: isProfit ? '#F8FAFC' : undefined
                          }}
                        >
                          <td style={{ padding: '10px 12px', fontWeight: isProfit ? 800 : 600, fontSize: 13, color: isProfit ? 'var(--forest)' : 'var(--ink)' }}>
                            {label as string}
                          </td>
                          <td
                            className="mono"
                            style={{
                              textAlign: 'right',
                              padding: '10px 12px',
                              fontWeight: 800,
                              fontSize: 14,
                              color: (isNeg as boolean)
                                ? '#DC2626'
                                : isProfit
                                ? '#166534'
                                : 'var(--ink)'
                            }}
                          >
                            {fmtMoney(val as number)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card List View */}
            <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: 8, width: '100%' }}>
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
                      borderRadius: 10,
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
                      boxShadow: item.isAccent ? '0 2px 6px rgba(0,0,0,0.03)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{item.icon}</span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: item.isProf ? 700 : 600,
                          color: item.isAccent
                            ? (isNeg ? '#991B1B' : '#166534')
                            : '#0F172A'
                        }}
                      >
                        {item.label}
                      </span>
                    </div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: isNeg
                          ? '#DC2626'
                          : item.isProf
                          ? '#166534'
                          : item.isExp && item.val > 0
                          ? '#B5533C'
                          : '#0F172A'
                      }}
                    >
                      {fmtMoney(item.val)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Needs Collection (Attention List) */}
          {attention.length > 0 && (
            <div
              className="va-panel"
              style={{
                borderRadius: 12,
                background: 'var(--paper, #FFFDF8)',
                border: '1px solid var(--line, #DCE0D2)',
                padding: '16px 20px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div
                className="va-panel-head"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--line-soft, #EDEFE6)'
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#B5533C', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon path={mdiScaleBalance} size={0.9} color="#B5533C" />
                  Needs Collection (High Dues)
                </h3>
                <a
                  href="/collections"
                  className="va-btn secondary small"
                  style={{
                    fontWeight: 700,
                    borderRadius: 6,
                    borderColor: '#B5533C',
                    color: '#B5533C',
                    background: '#FFFFFF'
                  }}
                >
                  Collect Payment
                </a>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: 380 }}>
                {attention.map(c => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: '#FFF5F5',
                      border: '1px solid #FED7D7',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: '#FEB2B2',
                          color: '#742A2A',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700
                        }}
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#2D3748' }}>
                        {c.name}
                      </span>
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: '#C53030'
                      }}
                    >
                      {fmtMoney(c.balance)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── 5. RECENT ORDERS FOR SELECTED BUSINESS DAY ─────────────────── */}
        {recentSales.length > 0 && (
          <div
            className="va-panel"
            style={{
              borderRadius: 12,
              background: 'var(--paper, #FFFDF8)',
              border: '1px solid var(--line, #DCE0D2)',
              padding: '16px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
            }}
          >
            <div
              className="va-panel-head"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
                paddingBottom: 10,
                borderBottom: '1px solid var(--line-soft, #EDEFE6)',
                flexWrap: 'wrap',
                gap: 10
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--forest)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon path={mdiReceiptTextOutline} size={0.9} color="var(--forest)" />
                Orders for {fmtBusinessDate(selectedDate)}
              </h3>
              <a
                href="/sales"
                className="va-btn secondary small"
                style={{
                  fontWeight: 700,
                  borderRadius: 8,
                  borderColor: 'var(--forest)',
                  color: 'var(--forest)'
                }}
              >
                View Sales Register
              </a>
            </div>

            {/* Desktop Table View */}
            <div className="hide-mobile">
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--line, #DCE0D2)' }}>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Invoice</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Client</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Date &amp; Time</th>
                      <th className="mono" style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Total</th>
                      <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSales.map(s => (
                      <tr
                        key={s.id}
                        style={{
                          borderBottom: '1px solid var(--line-soft, #EDEFE6)',
                          transition: 'background 0.15s ease'
                        }}
                      >
                        <td className="mono" style={{ color: 'var(--forest)', fontWeight: 800, padding: '12px 12px', fontSize: 13 }}>
                          {s.invoiceNo}
                        </td>
                        <td style={{ fontWeight: 700, padding: '12px 12px', fontSize: 13, color: 'var(--ink)' }}>
                          {s.client}
                        </td>
                        <td style={{ color: 'var(--muted)', padding: '12px 12px', fontSize: 12 }}>
                          {fmtDate(s.date)}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800, padding: '12px 12px', fontSize: 14, color: 'var(--ink)' }}>
                          {fmtMoney(s.total)}
                        </td>
                        <td style={{ textAlign: 'center', padding: '12px 12px' }}>
                          <StatusBadge status={s.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card List View */}
            <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: 12, width: '100%' }}>
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
                        style={{
                          width: '100%',
                          textAlign: 'center',
                          textDecoration: 'none',
                          fontWeight: 700,
                          borderRadius: 6,
                          padding: '8px 12px',
                          display: 'block'
                        }}
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

      </div>
    </DashboardLayout>
  );
}
