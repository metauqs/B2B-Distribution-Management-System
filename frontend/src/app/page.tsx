'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney } from '@/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DashboardData {
  today: {
    sales:       number;
    salesCount:  number;
    purchases:   number;
    expenses:    number;
    collections: number;
    profit:      number;
    cashPosition: number;
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

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
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
  const [data, setData]     = useState<DashboardData | null>(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reports/dashboard');
      if (res.status === 401) { window.location.href = '/login'; return; }
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.error ?? 'Failed to load');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <DashboardLayout><div className="va-loading">Opening the ledger…</div></DashboardLayout>;
  }
  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="va-empty">
          <div className="big">Could not load dashboard</div>
          <div style={{ marginTop: 8 }}>{error}</div>
          <button className="va-btn" style={{ marginTop: 16 }} onClick={load}>Retry</button>
        </div>
      </DashboardLayout>
    );
  }

  const { today, totals, attention, recentSales } = data;
  const health = healthLabel(totals.healthScore);

  return (
    <DashboardLayout>
      {/* ─── KPI Cards ──────────────────────────────────────────── */}
      <div className="va-cards">
        <div className="va-card accent">
          <div className="label">Today&apos;s Sales</div>
          <div className="value">{fmtMoney(today.sales)}</div>
          <div className="foot">{today.salesCount} order{today.salesCount !== 1 ? 's' : ''}</div>
        </div>

        <div className="va-card">
          <div className="label">Today&apos;s Purchases</div>
          <div className="value">{fmtMoney(today.purchases)}</div>
          <div className="foot">stock bought today</div>
        </div>

        <div className="va-card">
          <div className="label">Today&apos;s Profit</div>
          <div className={`value${today.profit < 0 ? ' neg' : ''}`}>{fmtMoney(today.profit)}</div>
          <div className="foot">sales − purchases − expenses</div>
        </div>

        <div className="va-card">
          <div className="label">Cash Position</div>
          <div className={`value${today.cashPosition < 0 ? ' neg' : ''}`}>{fmtMoney(today.cashPosition)}</div>
          <div className="foot">collections − outgoings</div>
        </div>

        <div className="va-card accent">
          <div className="label">Total Receivables</div>
          <div className="value">{fmtMoney(totals.receivables)}</div>
          <div className="foot">owed by {totals.clientCount} clients</div>
        </div>

        <div className="va-card">
          <div className="label">Total Payables</div>
          <div className="value" style={{ color: totals.payables > 0 ? 'var(--clay)' : undefined }}>
            {fmtMoney(totals.payables)}
          </div>
          <div className="foot">owed to suppliers</div>
        </div>

        <div className="va-card">
          <div className="label">Pending Deliveries</div>
          <div className="value" style={{ color: totals.pendingDeliveries > 0 ? 'var(--mustard)' : undefined }}>
            {totals.pendingDeliveries}
          </div>
          <div className="foot">orders not yet delivered</div>
        </div>

        <div className="va-card">
          <div className="label">Business Health</div>
          <div className="value" style={{ color: health.color, fontSize: 20 }}>{health.text}</div>
          <div className="foot">
            score: {totals.healthScore}/100
            {totals.atRiskClients > 0 && ` · ${totals.atRiskClients} at-risk client${totals.atRiskClients > 1 ? 's' : ''}`}
          </div>
        </div>
      </div>

      {/* ─── Low stock alert ─────────────────────────────────────── */}
      {totals.lowStockCount > 0 && (
        <div className="va-panel" style={{ borderLeft: '3px solid var(--mustard)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span style={{ fontWeight: 600, color: 'var(--mustard)' }}>
              {totals.lowStockCount} item{totals.lowStockCount > 1 ? 's' : ''} running low on stock
            </span>
            <a href="/inventory" className="va-btn secondary small" style={{ marginLeft: 'auto' }}>
              View Inventory
            </a>
          </div>
        </div>
      )}

      {/* ─── Needs collection (attention list) ───────────────────── */}
      {attention.length > 0 && (
        <div className="va-panel">
          <div className="va-panel-head">
            <h3>Needs Collection</h3>
            <a href="/collections" className="va-btn secondary small">Collect Payment</a>
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

      {/* ─── Today's ledger summary ────────────────────────────────── */}
      <div className="va-panel">
        <div className="va-panel-head">
          <h3>Today&apos;s Ledger</h3>
          <button className="va-btn secondary small" onClick={load}>↻ Refresh</button>
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="va-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="mono" style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Sales',        today.sales,       false],
              ['Purchases',    today.purchases,   false],
              ['Expenses',     today.expenses,    false],
              ['Collections',  today.collections, false],
              ['Net Profit',   today.profit,      today.profit < 0],
            ].map(([label, val, isNeg]) => (
              <tr key={label as string}>
                <td>{label as string}</td>
                <td className="mono" style={{
                  textAlign: 'right',
                  fontWeight: 600,
                  color: (isNeg as boolean) ? 'var(--danger)' : label === 'Net Profit' ? 'var(--ok)' : undefined
                }}>
                  {fmtMoney(val as number)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* ─── Recent sales ─────────────────────────────────────────── */}
      {recentSales.length > 0 && (
        <div className="va-panel">
          <div className="va-panel-head">
            <h3>Recent Orders</h3>
            <a href="/sales" className="va-btn secondary small">View All</a>
          </div>
          
          <div className="hide-mobile">
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="va-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Date</th>
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
            {recentSales.map(s => (
              <div key={s.id} className="va-mobile-card">
                <div className="card-header">
                  <span className="card-title" style={{ color: '#FFFFFF' }}>{s.invoiceNo}</span>
                  <span className={`card-subtitle text-xs uppercase px-2 py-0.5 rounded border border-white/30 text-white font-bold`}>{s.status}</span>
                </div>
                
                <div className="card-divider" />
                
                <div className="flex flex-col gap-2.5">
                  <div className="card-info-row">
                    <span className="card-label">Invoice Amount</span>
                    <span className="card-value amount">{fmtMoney(s.total)}</span>
                  </div>
                  <div className="card-info-row">
                    <span className="card-label">Client</span>
                    <span className="card-value">{s.client}</span>
                  </div>
                  <div className="card-info-row">
                    <span className="card-label">Invoice Date</span>
                    <span className="card-value">{fmtDate(s.date)}</span>
                  </div>
                </div>

                <div className="card-divider" />

                <div>
                  <a href="/sales" className="card-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                    View Details
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
