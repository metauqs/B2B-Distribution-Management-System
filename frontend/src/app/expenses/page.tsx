'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, todayInputDate } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow } from '@/components/ui/MobileCard';
import Icon from '@mdi/react';
import {
  mdiCashMinus,
  mdiReceipt,
  mdiPlus,
  mdiTruck,
  mdiAccountTie,
  mdiBank,
  mdiCash,
  mdiDelete,
  mdiPencil,
  mdiEye,
  mdiStore,
  mdiCreditCardOutline,
  mdiRefresh,
} from '@mdi/js';

// ─── Constants & Types ────────────────────────────────────────────────────────

const CATEGORIES = [
  'TRANSPORT', 'LABOUR', 'FUEL', 'RENT', 'ELECTRICITY', 'PACKAGING', 'VEHICLE', 'SALARY', 'MISC'
];

const CAT_EMOJI: Record<string, string> = {
  TRANSPORT: '🚚',
  LABOUR: '👷',
  FUEL: '⛽',
  RENT: '🏢',
  ELECTRICITY: '⚡',
  PACKAGING: '📦',
  VEHICLE: '🔧',
  SALARY: '💼',
  MISC: '💸',
};

interface Vehicle { id: string; plateNo: string; type: string; }
interface Employee { id: string; name: string; employeeId: string; role: string; }
interface Supplier { id: string; name: string; phone?: string | null; }
interface CashAccount { id: string; name: string; balance: number; }
interface BankAccount { id: string; name: string; bankName?: string | null; accountNo?: string | null; balance: number; }

interface Expense {
  id: string;
  reference?: string | null;
  category: string;
  amount: number;
  date: string;
  description?: string | null;
  paidBy?: string | null;
  cashAccountId?: string | null;
  bankAccountId?: string | null;
  vehicleId?: string | null;
  employeeId?: string | null;
  supplierId?: string | null;
  notes?: string | null;
  vehicle?: Vehicle | null;
  employee?: Employee | null;
  supplier?: Supplier | null;
  cashAccount?: CashAccount | null;
  bankAccount?: BankAccount | null;
  createdBy?: { id: string; name: string; email: string } | null;
  branch?: { id: string; name: string } | null;
}

interface ExpenseSummary {
  today: number;
  todayCount: number;
  thisWeek: number;
  thisWeekCount: number;
  thisMonth: number;
  thisMonthCount: number;
  total: number;
  totalCount: number;
  cash: number;
  bank: number;
  online: number;
  categoryBreakdown: { category: string; total: number; count: number }[];
}

const BLANK_FORM = {
  id: '',
  reference: '',
  category: 'MISC',
  amount: 0,
  date: todayInputDate(),
  description: '',
  paidBy: 'CASH',
  cashAccountId: '',
  bankAccountId: '',
  vehicleId: '',
  employeeId: '',
  supplierId: '',
  notes: '',
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    return getCachedData<Expense[]>('/api/expenses?range=this_month') || [];
  });
  const [summary, setSummary] = useState<ExpenseSummary | null>(() => {
    return getCachedData<ExpenseSummary>('/api/expenses/summary?range=this_month') || null;
  });
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => {
    return getCachedData<Vehicle[]>('/api/vehicles') || [];
  });
  const [employees, setEmployees] = useState<Employee[]>(() => {
    return getCachedData<Employee[]>('/api/employees?activeOnly=true') || [];
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    return getCachedData<Supplier[]>('/api/suppliers') || [];
  });
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>(() => {
    return getCachedData<CashAccount[]>('/api/cash-accounts') || [];
  });
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(() => {
    return getCachedData<BankAccount[]>('/api/bank-accounts') || [];
  });

  const [loading, setLoading] = useState(() => {
    return !getCachedData<Expense[]>('/api/expenses?range=this_month');
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // UI state
  const [view, setView] = useState<'list' | 'add' | 'edit'>('list');
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  // Daily Cash Deposit Modal state
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositForm, setDepositForm] = useState({
    cashAccountId: '',
    amount: 0,
    date: todayInputDate(),
    notes: 'Daily Cash Deposit',
  });
  const [depositing, setDepositing] = useState(false);

  // Form State
  const [form, setForm] = useState({ ...BLANK_FORM });

  // Filters State
  const [dateRange, setDateRange] = useState<string>('this_month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [payMethodFilter, setPayMethodFilter] = useState('ALL');
  const [vehicleFilter, setVehicleFilter] = useState('ALL');
  const [employeeFilter, setEmployeeFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Load Reference Master Options (Vehicles, Employees, Accounts, Suppliers)
  const loadMasterData = useCallback(async () => {
    try {
      const [vd, ed, sd, cd, bd] = await Promise.all([
        fetchWithCache<Vehicle[]>('/api/vehicles', { ttl: TTL_LONG }),
        fetchWithCache<Employee[]>('/api/employees?activeOnly=true', { ttl: TTL_LONG }),
        fetchWithCache<Supplier[]>('/api/suppliers', { ttl: TTL_LONG }),
        fetchWithCache<CashAccount[]>('/api/cash-accounts', { ttl: TTL_LONG }),
        fetchWithCache<BankAccount[]>('/api/bank-accounts', { ttl: TTL_LONG }),
      ]);

      if (vd) setVehicles(vd);
      if (ed) setEmployees(ed);
      if (sd) setSuppliers(sd);
      if (cd) setCashAccounts(cd);
      if (bd) setBankAccounts(bd);
    } catch (err) {
      console.error('Error loading expense options:', err);
    }
  }, []);

  // Fetch Expenses List & Summary analytics
  const loadExpenses = useCallback(async (isBackground = false) => {
    if (!isBackground && expenses.length === 0) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange !== 'custom') {
        params.set('range', dateRange);
      } else {
        if (customFrom) params.set('from', customFrom);
        if (customTo) params.set('to', customTo);
      }

      if (catFilter !== 'ALL') params.set('category', catFilter);
      if (payMethodFilter !== 'ALL') params.set('paidBy', payMethodFilter);
      if (vehicleFilter !== 'ALL') params.set('vehicleId', vehicleFilter);
      if (employeeFilter !== 'ALL') params.set('employeeId', employeeFilter);
      if (search.trim()) params.set('search', search.trim());

      const expKey = `/api/expenses?${params.toString()}`;
      const sumKey = `/api/expenses/summary?${params.toString()}`;

      const [expData, sumData] = await Promise.all([
        fetchWithCache<Expense[]>(expKey, { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<ExpenseSummary>(sumKey, { ttl: TTL_SHORT, forceRefresh: isBackground }),
      ]);

      if (expData) setExpenses(expData);
      if (sumData) setSummary(sumData);
    } catch (err) {
      console.error('Error loading expenses:', err);
    } finally {
      setLoading(false);
    }
  }, [dateRange, customFrom, customTo, catFilter, payMethodFilter, vehicleFilter, employeeFilter, search, expenses.length]);

  useEffect(() => {
    loadMasterData();
    loadExpenses();
  }, [loadMasterData, loadExpenses]);

  useEffect(() => {
    const handleRevalidate = () => {
      loadExpenses(true);
      loadMasterData();
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [loadExpenses, loadMasterData]);

  // Set default cash/bank account when paidBy changes
  useEffect(() => {
    if (form.paidBy === 'CASH' && cashAccounts.length && !form.cashAccountId) {
      setForm(p => ({ ...p, cashAccountId: cashAccounts[0].id }));
    } else if ((form.paidBy === 'BANK' || form.paidBy === 'ONLINE') && bankAccounts.length && !form.bankAccountId) {
      setForm(p => ({ ...p, bankAccountId: bankAccounts[0].id }));
    }
  }, [form.paidBy, cashAccounts, bankAccounts, form.cashAccountId, form.bankAccountId]);

  // Open Form for Create
  const handleOpenAdd = () => {
    setForm({
      ...BLANK_FORM,
      date: todayInputDate(),
      paidBy: 'CASH',
      cashAccountId: cashAccounts[0]?.id || '',
      bankAccountId: bankAccounts[0]?.id || '',
    });
    setView('add');
  };

  // Open Form for Edit
  const handleOpenEdit = (exp: Expense) => {
    setForm({
      id: exp.id,
      reference: exp.reference || '',
      category: exp.category || 'MISC',
      amount: exp.amount || 0,
      date: exp.date ? exp.date.slice(0, 10) : todayInputDate(),
      description: exp.description || '',
      paidBy: exp.paidBy || 'CASH',
      cashAccountId: exp.cashAccountId || '',
      bankAccountId: exp.bankAccountId || '',
      vehicleId: exp.vehicleId || '',
      employeeId: exp.employeeId || '',
      supplierId: exp.supplierId || '',
      notes: exp.notes || '',
    });
    setView('edit');
  };

  // Submit Save or Update
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.amount <= 0) return showToast('❌ Amount must be greater than zero');
    if (!form.date) return showToast('❌ Date is required');

    if (form.paidBy === 'CASH' && !form.cashAccountId) {
      return showToast('❌ Please select a Cash Account');
    }
    if ((form.paidBy === 'BANK' || form.paidBy === 'ONLINE') && !form.bankAccountId) {
      return showToast('❌ Please select a Bank Account');
    }

    setSaving(true);
    try {
      const url = view === 'edit' ? `/api/expenses/${form.id}` : '/api/expenses';
      const method = view === 'edit' ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/expenses');
        invalidateCache('/api/reports');
        showToast(view === 'edit' ? '✅ Expense updated & balances synced' : '✅ Expense recorded & balance adjusted');
        setView('list');
        await loadExpenses(true);
      } else {
        showToast('❌ ' + (data.error ?? 'Save failed'));
      }
    } catch {
      showToast('❌ Network error saving expense');
    } finally {
      setSaving(false);
    }
  };

  // Confirm Delete
  const handleDeleteConfirm = async () => {
    if (!expenseToDelete) return;
    try {
      const res = await apiFetch(`/api/expenses/${expenseToDelete.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/expenses');
        invalidateCache('/api/reports');
        showToast('✅ Expense deleted & account balance refunded');
        setShowDeleteModal(false);
        setExpenseToDelete(null);
        await loadExpenses(true);
      } else {
        showToast('❌ ' + (data.error ?? 'Delete failed'));
      }
    } catch {
      showToast('❌ Network error deleting expense');
    }
  };

  // Daily Cash Deposit Handler
  const handleDepositCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (depositForm.amount <= 0) return showToast('❌ Deposit amount must be greater than zero');
    setDepositing(true);
    try {
      const res = await apiFetch('/api/cash-accounts/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(depositForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || '✅ Daily cash added successfully');
        setShowDepositModal(false);
        setDepositForm({ cashAccountId: '', amount: 0, date: todayInputDate(), notes: 'Daily Cash Deposit' });
        await loadMasterData();
        await loadExpenses();
      } else {
        showToast('❌ ' + (data.error ?? 'Deposit failed'));
      }
    } catch {
      showToast('❌ Network error adding cash');
    } finally {
      setDepositing(false);
    }
  };

  const filteredTotal = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,.18)' }}>
          {toast}
        </div>
      )}

      {/* Page Title & Navigation Header */}
      <div className="va-panel" style={{ padding: '16px 20px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
              <Icon path={mdiCashMinus} size={1.1} color="#1B4D2E" />
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0F172A' }}>Expenses Management</h2>
            </div>
            <p style={{ color: '#64748B', fontSize: 13, margin: '4px 0 0 0' }}>
              Track operational costs, fuel, salaries, vehicle maintenance, and real-time cash/bank account adjustments.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="va-btn secondary small" style={{ fontWeight: 600 }} onClick={() => loadExpenses()}>
              <Icon path={mdiRefresh} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Refresh
            </button>
            <button 
              className="va-btn secondary small" 
              style={{ fontWeight: 700, color: '#16A34A', borderColor: '#86EFAC', background: '#F0FDF4' }} 
              onClick={() => {
                setDepositForm({ cashAccountId: cashAccounts[0]?.id || '', amount: 0, date: todayInputDate(), notes: 'Daily Cash Deposit' });
                setShowDepositModal(true);
              }}
            >
              💵 Add Daily Cash
            </button>
            {view === 'list' ? (
              <button className="va-btn" style={{ fontWeight: 700, borderRadius: '8px' }} onClick={handleOpenAdd}>
                <Icon path={mdiPlus} size={0.8} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Record New Expense
              </button>
            ) : (
              <button className="va-btn secondary small" style={{ fontWeight: 700 }} onClick={() => setView('list')}>
                ← Back to List
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Dashboard Analytics Cards (Section 7) */}
      {view === 'list' && summary && (
        <div className="va-cards" style={{ marginTop: 14 }}>
          <div className="va-card accent">
            <div className="label">Expenses Today</div>
            <div className="value">{fmtMoney(summary.today)}</div>
            <div className="foot">{summary.todayCount} records recorded today</div>
          </div>
          <div className="va-card">
            <div className="label">Expenses This Week</div>
            <div className="value">{fmtMoney(summary.thisWeek)}</div>
            <div className="foot">{summary.thisWeekCount} records this week</div>
          </div>
          <div className="va-card">
            <div className="label">Expenses This Month</div>
            <div className="value" style={{ color: '#991B1B' }}>{fmtMoney(summary.thisMonth)}</div>
            <div className="foot">{summary.thisMonthCount} records this month</div>
          </div>
          <div className="va-card">
            <div className="label">Total Paid (Cash / Bank)</div>
            <div className="value">
              {fmtMoney(summary.cash + summary.bank + summary.online)}
            </div>
            <div className="foot">
              Cash: {fmtMoney(summary.cash)} · Bank: {fmtMoney(summary.bank)}
            </div>
          </div>
        </div>
      )}

      {/* Category Breakdown Pills */}
      {view === 'list' && summary?.categoryBreakdown && summary.categoryBreakdown.length > 0 && (
        <div className="va-panel" style={{ padding: '12px 18px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Category Outflow Breakdown
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {summary.categoryBreakdown.map((cb) => (
              <div 
                key={cb.category}
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span>{CAT_EMOJI[cb.category] ?? '💸'}</span>
                <span style={{ fontWeight: 700, color: '#0F172A' }}>{cb.category}:</span>
                <span className="mono" style={{ fontWeight: 700, color: '#1B4D2E' }}>{fmtMoney(cb.total)}</span>
                <span style={{ fontSize: '10px', color: '#64748B' }}>({cb.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expense Form (Create or Edit) */}
      {(view === 'add' || view === 'edit') ? (
        <div className="va-panel" style={{ maxWidth: 720, margin: '14px auto', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
          <div className="va-panel-head" style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9' }}>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0F172A' }}>
              {view === 'edit' ? `Edit Expense: ${form.reference || form.id}` : 'Record New Expense Record'}
            </h3>
          </div>

          <form onSubmit={handleSave} style={{ padding: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {/* Category */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Expense Category *</label>
                <select 
                  value={form.category} 
                  onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c] ?? ''} {c}</option>)}
                </select>
              </div>

              {/* Amount */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Amount (Rs) *</label>
                <input 
                  type="number" required min="1" step="any"
                  value={form.amount || ''} 
                  onChange={e => setForm(p => ({ ...p, amount: +e.target.value }))} 
                  placeholder="e.g. 5000"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 14, fontWeight: 700, background: '#F8FAFC' }}
                />
              </div>

              {/* Date */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Expense Date *</label>
                <input 
                  type="date" required 
                  value={form.date} 
                  onChange={e => setForm(p => ({ ...p, date: e.target.value }))} 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                />
              </div>

              {/* Payment Method */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Payment Method *</label>
                <select 
                  value={form.paidBy} 
                  onChange={e => setForm(p => ({ ...p, paidBy: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 700, background: '#F8FAFC' }}
                >
                  <option value="CASH">💵 Cash</option>
                  <option value="BANK">🏦 Bank Transfer</option>
                  <option value="ONLINE">📱 Online Payment</option>
                </select>
              </div>

              {/* Cash Account selector (if paidBy = CASH) */}
              {form.paidBy === 'CASH' && (
                <div className="va-field">
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Paid From Cash Account *</label>
                  <select 
                    value={form.cashAccountId} 
                    onChange={e => setForm(p => ({ ...p, cashAccountId: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                  >
                    <option value="">— Select Cash Account —</option>
                    {cashAccounts.map(c => (
                      <option key={c.id} value={c.id}>{c.name} (Bal: Rs {c.balance.toLocaleString()})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Bank Account selector (if paidBy = BANK or ONLINE) */}
              {(form.paidBy === 'BANK' || form.paidBy === 'ONLINE') && (
                <div className="va-field">
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Paid From Bank Account *</label>
                  <select 
                    value={form.bankAccountId} 
                    onChange={e => setForm(p => ({ ...p, bankAccountId: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                  >
                    <option value="">— Select Bank Account —</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.bankName ?? 'Bank'}) - Bal: Rs {b.balance.toLocaleString()}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Dynamic Vehicle field (if category = FUEL, VEHICLE, TRANSPORT) */}
              {(form.category === 'FUEL' || form.category === 'VEHICLE' || form.category === 'TRANSPORT') && (
                <div className="va-field">
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Select Vehicle (Optional)</label>
                  <select 
                    value={form.vehicleId} 
                    onChange={e => setForm(p => ({ ...p, vehicleId: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                  >
                    <option value="">— No Vehicle Linked —</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>🚚 {v.plateNo} ({v.type})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Dynamic Employee field (if category = SALARY) */}
              {form.category === 'SALARY' && (
                <div className="va-field">
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Select Employee (Optional)</label>
                  <select 
                    value={form.employeeId} 
                    onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                  >
                    <option value="">— No Employee Linked —</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>💼 {emp.name} ({emp.employeeId || emp.role})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Dynamic Supplier field (if category = MISC or Supplier Related) */}
              {form.category === 'MISC' && (
                <div className="va-field">
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Select Supplier (Optional)</label>
                  <select 
                    value={form.supplierId} 
                    onChange={e => setForm(p => ({ ...p, supplierId: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                  >
                    <option value="">— No Supplier Linked —</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>🏪 {s.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="va-field" style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Description / Purpose *</label>
              <input 
                value={form.description} 
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))} 
                placeholder="e.g. Fuel refill for Truck LES-4920, shop rent payment, monthly electricity bill..."
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, background: '#F8FAFC' }} 
              />
            </div>

            {/* Additional Notes */}
            <div className="va-field" style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Additional Notes (Optional)</label>
              <textarea 
                value={form.notes} 
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} 
                placeholder="Receipt voucher numbers, driver signatures, meter readings..." 
                rows={3} 
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, background: '#F8FAFC', resize: 'vertical' }} 
              />
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button type="button" className="va-btn secondary" onClick={() => setView('list')}>
                Cancel
              </button>
              <button type="submit" className="va-btn" disabled={saving} style={{ fontWeight: 700, borderRadius: '8px' }}>
                {saving ? 'Saving & Updating Balances…' : (view === 'edit' ? '✓ Save Changes' : '✓ Record Expense')}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {/* Advanced Multi-Filter Toolbar (Section 6) */}
          <div className="va-panel" style={{ padding: '14px 18px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Search Bar */}
              <div style={{ flex: 2, minWidth: 220 }}>
                <input 
                  value={search} 
                  onChange={e => setSearch(e.target.value)} 
                  placeholder="🔍 Search Reference, Description, Notes..." 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, background: '#F8FAFC' }} 
                />
              </div>

              {/* Date Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Time Range:</span>
                <select 
                  value={dateRange} 
                  onChange={e => setDateRange(e.target.value)} 
                  style={{ padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, background: '#F8FAFC', fontWeight: 600 }}
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This Week</option>
                  <option value="this_month">This Month</option>
                  <option value="custom">Custom Date Range</option>
                </select>
              </div>

              {dateRange === 'custom' && (
                <>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12 }} />
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>to</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12 }} />
                </>
              )}

              {/* Category Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Category:</span>
                <select 
                  value={catFilter} 
                  onChange={e => setCatFilter(e.target.value)} 
                  style={{ padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, background: '#F8FAFC', fontWeight: 600 }}
                >
                  <option value="ALL">All Categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c] ?? ''} {c}</option>)}
                </select>
              </div>

              {/* Payment Method Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Method:</span>
                <select 
                  value={payMethodFilter} 
                  onChange={e => setPayMethodFilter(e.target.value)} 
                  style={{ padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, background: '#F8FAFC', fontWeight: 600 }}
                >
                  <option value="ALL">All Methods</option>
                  <option value="CASH">💵 Cash</option>
                  <option value="BANK">🏦 Bank Transfer</option>
                  <option value="ONLINE">📱 Online</option>
                </select>
              </div>
            </div>
          </div>

          {/* Expense Data List (Section 5) */}
          <div className="va-panel" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', marginTop: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
            <div className="va-panel-head" style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0F172A' }}>Expense Register</h3>
              <span style={{ fontSize: 13, color: '#64748B', fontWeight: 600 }}>Showing {expenses.length} records</span>
            </div>

            {loading && expenses.length === 0 ? (
              <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={6} /></div>
            ) : expenses.length === 0 ? (
              <div className="va-empty" style={{ padding: '40px 0', textAlign: 'center' }}>
                <div className="big" style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>No expenses found</div>
                <div style={{ color: '#64748B', fontSize: '13px', marginTop: 4 }}>Record a new expense to track financial outflow.</div>
              </div>
            ) : (
              <div style={{ padding: '16px 20px' }}>
                {/* Desktop View Table */}
                <div className="hide-mobile">
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table className="va-table" style={{ width: '100%', minWidth: 950, borderCollapse: 'separate', borderSpacing: '0 6px' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        <th style={{ padding: '10px 14px', borderRadius: '6px 0 0 6px' }}>Ref / Date</th>
                        <th style={{ padding: '10px 14px' }}>Category</th>
                        <th style={{ padding: '10px 14px' }}>Description</th>
                        <th style={{ padding: '10px 14px' }}>Payment Method</th>
                        <th style={{ padding: '10px 14px' }}>Account</th>
                        <th style={{ padding: '10px 14px' }}>Linked Entity</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', borderRadius: '0 6px 6px 0' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map(e => (
                        <tr key={e.id} style={{ background: '#FFFFFF', borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '12px 14px' }}>
                            <div className="mono" style={{ fontWeight: 700, color: '#1B4D2E', fontSize: '13px' }}>
                              {e.reference || `EXP-${e.id.slice(-6).toUpperCase()}`}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>{fmtDate(e.date)}</div>
                          </td>

                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>
                              {CAT_EMOJI[e.category] ?? '💸'} {e.category}
                            </span>
                          </td>

                          <td style={{ padding: '12px 14px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <div style={{ fontSize: '13px', color: '#334155', fontWeight: 600 }}>{e.description ?? '—'}</div>
                            {e.notes && <div style={{ fontSize: '11px', color: '#64748B' }}>{e.notes}</div>}
                          </td>

                          <td style={{ padding: '12px 14px' }}>
                            <span style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: e.paidBy === 'BANK' ? '#E0F2FE' : e.paidBy === 'ONLINE' ? '#F3E8FF' : '#DCFCE7',
                              color: e.paidBy === 'BANK' ? '#0369A1' : e.paidBy === 'ONLINE' ? '#6B21A8' : '#15803D',
                              border: `1px solid ${e.paidBy === 'BANK' ? '#BAE6FD' : e.paidBy === 'ONLINE' ? '#E9D5FF' : '#86EFAC'}`
                            }}>
                              {e.paidBy === 'BANK' ? '🏦 BANK' : e.paidBy === 'ONLINE' ? '📱 ONLINE' : '💵 CASH'}
                            </span>
                          </td>

                          <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 600, color: '#0F172A' }}>
                            {e.paidBy === 'CASH' 
                              ? (e.cashAccount?.name ?? 'Main Cash') 
                              : (e.bankAccount?.name ? `${e.bankAccount.name} (${e.bankAccount.bankName ?? ''})` : 'Bank Account')}
                          </td>

                          <td style={{ padding: '12px 14px' }}>
                            {e.vehicle ? (
                              <span style={{ fontSize: '11px', background: '#FEF3C7', color: '#B45309', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, border: '1px solid #FDE68A' }}>
                                🚚 {e.vehicle.plateNo}
                              </span>
                            ) : e.employee ? (
                              <span style={{ fontSize: '11px', background: '#E0E7FF', color: '#3730A3', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, border: '1px solid #C7D2FE' }}>
                                💼 {e.employee.name}
                              </span>
                            ) : e.supplier ? (
                              <span style={{ fontSize: '11px', background: '#FCE7F3', color: '#9D174D', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, border: '1px solid #FBCFE8' }}>
                                🏪 {e.supplier.name}
                              </span>
                            ) : <span style={{ fontSize: '11px', color: '#94A3B8' }}>—</span>}
                          </td>

                          <td className="mono" style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#991B1B', fontSize: '14px' }}>
                            {fmtMoney(e.amount)}
                          </td>

                          <td style={{ textAlign: 'right', padding: '12px 14px' }}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button 
                                className="va-btn secondary small" 
                                style={{ padding: '4px 8px', borderRadius: '6px' }}
                                title="View Details"
                                onClick={() => { setSelectedExpense(e); setShowDetailModal(true); }}
                              >
                                <Icon path={mdiEye} size={0.65} />
                              </button>
                              <button 
                                className="va-btn secondary small" 
                                style={{ padding: '4px 8px', borderRadius: '6px', color: '#2563EB' }}
                                title="Edit Expense"
                                onClick={() => handleOpenEdit(e)}
                              >
                                <Icon path={mdiPencil} size={0.65} />
                              </button>
                              <button 
                                className="va-btn secondary small" 
                                style={{ padding: '4px 8px', borderRadius: '6px', color: '#DC2626' }}
                                title="Delete Expense"
                                onClick={() => { setExpenseToDelete(e); setShowDeleteModal(true); }}
                              >
                                <Icon path={mdiDelete} size={0.65} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>

                {/* Mobile View Cards */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
                  {expenses.map(e => (
                    <MobileCard
                      key={e.id}
                      title={`${CAT_EMOJI[e.category] ?? '💸'} ${e.category}`}
                      headerBadge={fmtDate(e.date)}
                      footer={
                        <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
                          <button className="va-btn secondary small" style={{ fontSize: '12px', flex: 1 }} onClick={() => { setSelectedExpense(e); setShowDetailModal(true); }}>👁️ View</button>
                          <button className="va-btn secondary small" style={{ fontSize: '12px', color: '#2563EB', flex: 1 }} onClick={() => handleOpenEdit(e)}>✏️ Edit</button>
                          <button className="va-btn secondary small" style={{ fontSize: '12px', color: '#DC2626', flex: 1 }} onClick={() => { setExpenseToDelete(e); setShowDeleteModal(true); }}>🗑️ Delete</button>
                        </div>
                      }
                    >
                      <MobileCardRow label="Reference ID" value={e.reference || `EXP-${e.id.slice(-6).toUpperCase()}`} isMono />
                      <MobileCardRow label="Expense Amount" value={fmtMoney(e.amount)} valueColor="#991B1B" isMono />
                      <MobileCardRow 
                        label="Paid Via Account" 
                        value={e.paidBy === 'CASH' ? `💵 ${e.cashAccount?.name ?? 'Main Cash'}` : `🏦 ${e.bankAccount?.name ?? 'Bank'}`} 
                      />
                      <MobileCardRow label="Description" value={e.description ?? '—'} />
                      {e.vehicle && <MobileCardRow label="Linked Vehicle" value={`🚚 ${e.vehicle.plateNo}`} valueColor="#B45309" />}
                      {e.employee && <MobileCardRow label="Linked Employee" value={`💼 ${e.employee.name}`} valueColor="#3730A3" />}
                    </MobileCard>
                  ))}
                </div>

                {/* Total Summary Footer */}
                <div style={{
                  marginTop: '16px',
                  padding: '14px 20px',
                  background: '#F8FAFC',
                  borderRadius: '10px',
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '14px', color: '#0F172A' }}>Filtered Expenses Total</span>
                  <span className="mono" style={{ fontWeight: 700, color: '#991B1B', fontSize: '18px' }}>{fmtMoney(filteredTotal)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* View Details Modal */}
      {showDetailModal && selectedExpense && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: '16px', maxWidth: 520, width: '100%', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ background: 'linear-gradient(135deg, #1B4D2E 0%, #2E7D32 100%)', color: '#FFFFFF', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>Expense Details</h3>
              <button onClick={() => setShowDetailModal(false)} style={{ background: 'transparent', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #F1F5F9', paddingBottom: '8px' }}>
                <span style={{ color: '#64748B', fontWeight: 500 }}>Reference ID</span>
                <span className="mono" style={{ fontWeight: 700, color: '#0F172A' }}>{selectedExpense.reference || `EXP-${selectedExpense.id}`}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #F1F5F9', paddingBottom: '8px' }}>
                <span style={{ color: '#64748B', fontWeight: 500 }}>Category</span>
                <span style={{ fontWeight: 700, color: '#0F172A' }}>{CAT_EMOJI[selectedExpense.category] ?? ''} {selectedExpense.category}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #F1F5F9', paddingBottom: '8px' }}>
                <span style={{ color: '#64748B', fontWeight: 500 }}>Amount Paid</span>
                <span className="mono" style={{ fontWeight: 700, color: '#991B1B', fontSize: '16px' }}>{fmtMoney(selectedExpense.amount)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #F1F5F9', paddingBottom: '8px' }}>
                <span style={{ color: '#64748B', fontWeight: 500 }}>Date</span>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>{fmtDate(selectedExpense.date)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #F1F5F9', paddingBottom: '8px' }}>
                <span style={{ color: '#64748B', fontWeight: 500 }}>Payment Account</span>
                <span style={{ fontWeight: 600, color: '#0F172A' }}>
                  {selectedExpense.paidBy === 'CASH' 
                    ? `💵 ${selectedExpense.cashAccount?.name ?? 'Main Cash'}`
                    : `🏦 ${selectedExpense.bankAccount?.name ?? 'Bank'}`}
                </span>
              </div>

              {selectedExpense.vehicle && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #F1F5F9', paddingBottom: '8px' }}>
                  <span style={{ color: '#64748B', fontWeight: 500 }}>Vehicle</span>
                  <span style={{ fontWeight: 700, color: '#B45309' }}>🚚 {selectedExpense.vehicle.plateNo} ({selectedExpense.vehicle.type})</span>
                </div>
              )}

              {selectedExpense.employee && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderBottom: '1px solid #F1F5F9', paddingBottom: '8px' }}>
                  <span style={{ color: '#64748B', fontWeight: 500 }}>Employee</span>
                  <span style={{ fontWeight: 700, color: '#3730A3' }}>💼 {selectedExpense.employee.name} ({selectedExpense.employee.employeeId || selectedExpense.employee.role})</span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: '#64748B', fontWeight: 500, fontSize: '13px' }}>Description / Purpose</span>
                <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', color: '#0F172A', fontWeight: 600 }}>
                  {selectedExpense.description || 'No description provided'}
                </div>
              </div>

              {selectedExpense.notes && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ color: '#64748B', fontWeight: 500, fontSize: '13px' }}>Additional Notes</span>
                  <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', color: '#334155' }}>
                    {selectedExpense.notes}
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '16px 24px', background: '#F8FAFC', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="va-btn secondary" onClick={() => setShowDetailModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && expenseToDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: '16px', maxWidth: 440, width: '100%', padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#991B1B' }}>Confirm Expense Deletion</h3>
            <p style={{ color: '#475569', fontSize: '14px', marginTop: 10 }}>
              Are you sure you want to delete expense <strong>{expenseToDelete.reference || `EXP-${expenseToDelete.id}`}</strong> ({fmtMoney(expenseToDelete.amount)})?
            </p>
            <p style={{ color: '#166534', fontSize: '12px', background: '#F0FDF4', padding: '8px 12px', borderRadius: '6px', fontWeight: 600 }}>
              ✓ Deleting this record will automatically refund <strong>{fmtMoney(expenseToDelete.amount)}</strong> back into the linked financial account balance ({expenseToDelete.paidBy === 'CASH' ? 'Cash Account' : 'Bank Account'}).
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="va-btn secondary" onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button className="va-btn" style={{ background: '#DC2626', color: '#FFF', fontWeight: 700, borderRadius: '8px' }} onClick={handleDeleteConfirm}>
                Yes, Reverse & Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Daily Cash Modal */}
      {showDepositModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: '16px', maxWidth: 480, width: '100%', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ background: 'linear-gradient(135deg, #166534 0%, #15803D 100%)', color: '#FFFFFF', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon path={mdiCash} size={1} color="#FFFFFF" />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>Deposit Daily Cash</h3>
              </div>
              <button onClick={() => setShowDepositModal(false)} style={{ background: 'transparent', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleDepositCash} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Target Cash Account */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Target Cash Account *</label>
                <select 
                  value={depositForm.cashAccountId} 
                  onChange={e => setDepositForm(p => ({ ...p, cashAccountId: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                >
                  {cashAccounts.map(c => (
                    <option key={c.id} value={c.id}>💵 {c.name} (Current Balance: Rs {c.balance.toLocaleString()})</option>
                  ))}
                </select>
              </div>

              {/* Amount */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Deposit Amount (Rs) *</label>
                <input 
                  type="number" required min="1" step="any"
                  value={depositForm.amount || ''} 
                  onChange={e => setDepositForm(p => ({ ...p, amount: +e.target.value }))} 
                  placeholder="e.g. 10000"
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 15, fontWeight: 700, background: '#F8FAFC', color: '#166534' }}
                />
              </div>

              {/* Date */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Deposit Date *</label>
                <input 
                  type="date" required 
                  value={depositForm.date} 
                  onChange={e => setDepositForm(p => ({ ...p, date: e.target.value }))} 
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, fontWeight: 600, background: '#F8FAFC' }}
                />
              </div>

              {/* Notes */}
              <div className="va-field">
                <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Deposit Notes / Reason</label>
                <input 
                  value={depositForm.notes} 
                  onChange={e => setDepositForm(p => ({ ...p, notes: e.target.value }))} 
                  placeholder="e.g. Daily opening cash top-up, admin cash injection..."
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: 13, background: '#F8FAFC' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="button" className="va-btn secondary" onClick={() => setShowDepositModal(false)}>Cancel</button>
                <button type="submit" className="va-btn" disabled={depositing} style={{ background: '#16A34A', color: '#FFF', fontWeight: 700, borderRadius: '8px' }}>
                  {depositing ? 'Adding Cash…' : '✓ Add Cash Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
