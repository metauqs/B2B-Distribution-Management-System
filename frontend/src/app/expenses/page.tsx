'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, todayInputDate } from '@/utils/formatters';
import Icon from '@mdi/react';
import { mdiCashMinus } from '@mdi/js';

// ─── Constants & Types ────────────────────────────────────────────────────────

const CATEGORIES = ['TRANSPORT', 'FUEL', 'PACKAGING', 'SALARIES', 'RENT', 'UTILITIES', 'MARKET_FEES', 'COMMISSION', 'MISC'];
const CAT_EMOJI: Record<string, string> = { TRANSPORT: '🚚', FUEL: '⛽', PACKAGING: '📦', SALARIES: '💼', RENT: '🏢', UTILITIES: '🔌', MARKET_FEES: '🎪', COMMISSION: '🤝', MISC: '💸' };

interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  description?: string | null;
}

const BLANK_FORM = { category: 'MISC', amount: 0, date: '', description: '' };

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [view, setView] = useState<'list' | 'add'>('list');
  const [form, setForm] = useState({ ...BLANK_FORM });

  // Filters
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (catFilter !== 'all') params.set('category', catFilter);
    if (search.trim()) params.set('search', search.trim());
    const res = await fetch(`/api/expenses?${params}`);
    const data = await res.json();
    if (data.success) setExpenses(data.data);
    setLoading(false);
  }, [search, catFilter]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.amount <= 0) return showToast('❌ Amount must be greater than zero');
    if (!form.date) return showToast('❌ Date is required');
    setSaving(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Expense recorded');
        setView('list');
        await loadExpenses();
      } else {
        showToast('❌ ' + (data.error ?? 'Save failed'));
      }
    } finally { setSaving(false); }
  };

  const allTotal = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,.18)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="va-panel" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
              <Icon path={mdiCashMinus} size={1} color="var(--primary)" />
              <h2 style={{ margin: 0 }}>Expenses</h2>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>Business expenses, commissions, utilities, and packaging logistics</p>
          </div>
          {view === 'list' ? (
            <button className="va-btn" onClick={() => { setForm({ ...BLANK_FORM, date: todayInputDate() }); setView('add'); }}>+ Add Expense</button>
          ) : (
            <button className="va-btn secondary small" onClick={() => setView('list')}>← Back</button>
          )}
        </div>
      </div>

      {view === 'add' ? (
        <div className="va-panel" style={{ maxWidth: 600 }}>
          <div className="va-panel-head"><h3>New Expense Record</h3></div>
          <form onSubmit={handleSave}>
            <div className="va-form-row">
              <div className="va-field">
                <label>Category *</label>
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c] ?? ''} {c}</option>)}
                </select>
              </div>
              <div className="va-field">
                <label>Amount (Rs) *</label>
                <input type="number" required min="1" value={form.amount || ''} onChange={e => setForm(p => ({ ...p, amount: +e.target.value }))} />
              </div>
              <div className="va-field">
                <label>Date *</label>
                <input type="date" required value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              </div>
            </div>
            <div className="va-field" style={{ marginTop: 14 }}>
              <label>Description / Notes</label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Payment for custom packaging, fuel receipt, market tax…" rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button type="button" className="va-btn secondary" onClick={() => setView('list')}>Cancel</button>
              <button type="submit" className="va-btn" disabled={saving}>{saving ? 'Saving…' : '✓ Record Expense'}</button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="va-panel" style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search description…" style={{ flex: 2, minWidth: 200, padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontSize: 13 }} />
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}>
                <option value="all">All Categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c] ?? ''} {c}</option>)}
              </select>
            </div>
          </div>

          <div className="va-panel">
            {loading ? (
              <div className="va-loading">Loading expenses…</div>
            ) : expenses.length === 0 ? (
              <div className="va-empty"><div className="big">No expenses found</div><div>Record a new expense to get started</div></div>
            ) : (
              <>
                {/* Desktop view */}
                <div className="hide-mobile">
                  <table className="va-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map(e => (
                        <tr key={e.id}>
                          <td style={{ fontWeight: 600 }}>{CAT_EMOJI[e.category] ?? ''} {e.category}</td>
                          <td style={{ color: 'var(--muted)' }}>{e.description ?? '—'}</td>
                          <td style={{ color: 'var(--muted)' }}>{fmtDate(e.date)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--clay)' }}>{fmtMoney(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} style={{ fontWeight: 700 }}>Total</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--clay)', fontSize: 15 }}>{fmtMoney(allTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile view */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
                  {expenses.map(e => (
                    <div key={e.id} className="va-mobile-card">
                      <div className="card-header">
                        <span className="card-title" style={{ color: '#FFFFFF' }}>{CAT_EMOJI[e.category] ?? ''} {e.category}</span>
                        <span className="card-subtitle">{fmtDate(e.date)}</span>
                      </div>
                      
                      <div className="card-divider" />
                      
                      <div className="flex flex-col gap-2.5">
                        <div className="card-info-row">
                          <span className="card-label">Expense Amount</span>
                          <span className="card-value amount">{fmtMoney(e.amount)}</span>
                        </div>
                        <div className="card-info-row">
                          <span className="card-label">Description</span>
                          <span className="card-value max-w-[65%] truncate text-right">{e.description ?? '—'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{
                  marginTop: '10px',
                  padding: '16px',
                  background: 'rgba(0,0,0,0.03)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Total Expenses</span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--clay)', fontSize: '16px' }}>{fmtMoney(allTotal)}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
