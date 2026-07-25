'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, fmtDateTime, todayInputDate } from '@/utils/formatters';
import Icon from '@mdi/react';
import { mdiBriefcase } from '@mdi/js';

interface SalaryPayment {
  id: string;
  month: string;
  amount: number;
  method: string;
  paidOn: string;
  notes?: string | null;
}

interface Delivery {
  id: string;
  status: string;
  date: string;
  deliveredAt?: string | null;
  sale?: { invoiceNo: string; total: number } | null;
  client?: { name: string } | null;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  phone?: string | null;
  salary: number;
  joiningDate: string;
  isActive: boolean;
  fatherName?: string | null;
  cnic?: string | null;
  address?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  paymentStructure?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  salaryPayments?: SalaryPayment[];
  deliveries?: Delivery[];
}

const ROLES = ['ADMIN', 'DELIVERY_STAFF', 'PURCHASE_STAFF', 'BILLING_STAFF', 'STAFF', 'SUPERVISOR', 'DRIVER', 'LOADER', 'GUARD', 'ACCOUNTANT', 'OTHER'];
const ROLE_DISPLAY: Record<string, string> = {
  ADMIN: 'Admin',
  DELIVERY_STAFF: 'Delivery Staff',
  PURCHASE_STAFF: 'Purchase Staff',
  BILLING_STAFF: 'Billing Staff',
  STAFF: 'Staff',
  SUPERVISOR: 'Supervisor',
  DRIVER: 'Driver',
  LOADER: 'Loader',
  GUARD: 'Guard',
  ACCOUNTANT: 'Accountant',
  OTHER: 'Other',
};
const METHODS = ['CASH', 'BANK', 'CHEQUE', 'ONLINE'];

const BLANK_FORM = {
  name: '', role: 'DELIVERY_STAFF', phone: '', salary: 0, joiningDate: todayInputDate(),
  fatherName: '', cnic: '', address: '', whatsapp: '', email: '',
  paymentStructure: 'Monthly Fixed', notes: '', photoUrl: ''
};

const BLANK_PAYMENT = {
  month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
  amount: 0, method: 'CASH', notes: ''
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activeEmp, setActiveEmp] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  
  // View states
  const [view, setView] = useState<'list' | 'add' | 'edit' | 'profile'>('list');
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [search, setSearch] = useState('');
  
  // Payment states
  const [payForm, setPayForm] = useState({ ...BLANK_PAYMENT });
  const [selectedMonth, setSelectedMonth] = useState(new Date().toLocaleString('default', { month: 'long', year: 'numeric' }));

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // Load employees
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employees');
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data ?? []);
      } else {
        showToast('❌ Failed to load employees');
      }
    } catch {
      showToast('❌ Network error loading employees');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load single employee profile details
  const loadProfile = async (id: string) => {
    try {
      const res = await fetch(`/api/employees/${id}`);
      const data = await res.json();
      if (data.success) {
        setActiveEmp(data.data);
        setView('profile');
      } else {
        showToast('❌ Failed to load profile details');
      }
    } catch {
      showToast('❌ Network error loading profile');
    }
  };

  // Create or Update employee
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return showToast('❌ Name is required');

    setSaving(true);
    try {
      const isEdit = view === 'edit';
      const url = isEdit ? `/api/employees/${activeEmp?.id}` : '/api/employees';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(isEdit ? '✅ Employee updated successfully' : '✅ Employee created successfully');
        setView('list');
        await load();
      } else {
        showToast('❌ ' + (data.error ?? 'Save failed'));
      }
    } catch {
      showToast('❌ Network error saving employee');
    } finally {
      setSaving(false);
    }
  };

  // Toggle active status
  const toggleActiveStatus = async (emp: Employee) => {
    try {
      const res = await fetch(`/api/employees/${emp.id}/toggle`, { method: 'PATCH' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ Employee ${data.data.isActive ? 'activated' : 'deactivated'}`);
        await load();
        if (activeEmp?.id === emp.id) {
          loadProfile(emp.id);
        }
      } else {
        showToast('❌ Failed to toggle employee status');
      }
    } catch {
      showToast('❌ Network error');
    }
  };

  // Record salary payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEmp) return;
    if (payForm.amount <= 0) return showToast('❌ Amount must be greater than zero');

    setSaving(true);
    try {
      const res = await fetch(`/api/employees/${activeEmp.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Salary payment recorded successfully');
        setPayForm({ ...BLANK_PAYMENT });
        await loadProfile(activeEmp.id);
      } else {
        showToast('❌ ' + (data.error ?? 'Failed to record payment'));
      }
    } catch {
      showToast('❌ Network error');
    } finally {
      setSaving(false);
    }
  };

  const startAdd = () => {
    setForm({ ...BLANK_FORM });
    setView('add');
  };

  const startEdit = (emp: Employee) => {
    setForm({
      name: emp.name,
      role: emp.role,
      phone: emp.phone || '',
      salary: emp.salary,
      joiningDate: emp.joiningDate ? new Date(emp.joiningDate).toISOString().slice(0, 10) : todayInputDate(),
      fatherName: emp.fatherName || '',
      cnic: emp.cnic || '',
      address: emp.address || '',
      whatsapp: emp.whatsapp || '',
      email: emp.email || '',
      paymentStructure: emp.paymentStructure || 'Monthly Fixed',
      notes: emp.notes || '',
      photoUrl: emp.photoUrl || ''
    });
    setView('edit');
  };

  const filtered = search
    ? employees.filter(e =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        (e.phone || '').includes(search) ||
        e.role.toLowerCase().includes(search.toLowerCase())
      )
    : employees;

  // Payroll math for selected profile month
  const paymentsForSelectedMonth = activeEmp?.salaryPayments?.filter(p => p.month.toLowerCase() === selectedMonth.toLowerCase()) ?? [];
  const totalPaidSelectedMonth = paymentsForSelectedMonth.reduce((sum, p) => sum + p.amount, 0);
  const remainingPaySelectedMonth = activeEmp ? Math.max(0, activeEmp.salary - totalPaidSelectedMonth) : 0;

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
              <Icon path={mdiBriefcase} size={1} color="var(--primary)" />
              <h2 style={{ margin: 0 }}>Employees</h2>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>Manage workforce personnel, salary structures, payroll records, and delivery history</p>
          </div>
          {view === 'list' ? (
            <button className="va-btn" onClick={startAdd}>+ Add Employee</button>
          ) : (
            <button className="va-btn secondary small" onClick={() => setView('list')}>← Back to List</button>
          )}
        </div>
      </div>

      {/* VIEW: ADD / EDIT EMPLOYEE */}
      {(view === 'add' || view === 'edit') && (
        <div className="va-panel" style={{ maxWidth: 750 }}>
          <div className="va-panel-head">
            <h3>{view === 'edit' ? `✏️ Edit Employee: ${activeEmp?.name}` : '➕ New Employee Record'}</h3>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="va-form-row">
              <div className="va-field">
                <label>Full Name *</label>
                <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Enter full name" />
              </div>
              <div className="va-field">
                <label>Father / Guardian Name</label>
                <input value={form.fatherName} onChange={e => setForm(p => ({ ...p, fatherName: e.target.value }))} placeholder="Guardian's name" />
              </div>
            </div>

            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Role / Designation *</label>
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_DISPLAY[r] ?? r}</option>)}
                </select>
              </div>
              <div className="va-field">
                <label>CNIC / National ID</label>
                <input value={form.cnic} onChange={e => setForm(p => ({ ...p, cnic: e.target.value }))} placeholder="XXXXX-XXXXXXX-X" />
              </div>
            </div>

            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Phone Number *</label>
                <input required value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="Primary phone number" />
              </div>
              <div className="va-field">
                <label>WhatsApp Number</label>
                <input value={form.whatsapp} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))} placeholder="Optional WhatsApp number" />
              </div>
            </div>

            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Email Address</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="Optional email address" />
              </div>
              <div className="va-field">
                <label>Joining Date *</label>
                <input type="date" required value={form.joiningDate} onChange={e => setForm(p => ({ ...p, joiningDate: e.target.value }))} />
              </div>
            </div>

            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Monthly Salary (Rs) *</label>
                <input type="number" required min={0} value={form.salary} onChange={e => setForm(p => ({ ...p, salary: Number(e.target.value) }))} />
              </div>
              <div className="va-field">
                <label>Payment Structure</label>
                <select value={form.paymentStructure} onChange={e => setForm(p => ({ ...p, paymentStructure: e.target.value }))}>
                  <option value="Monthly Fixed">Monthly Fixed</option>
                  <option value="Weekly Fixed">Weekly Fixed</option>
                  <option value="Daily Wages">Daily Wages</option>
                </select>
              </div>
            </div>

            <div className="va-field" style={{ marginTop: 12 }}>
              <label>Residential Address</label>
              <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Current home address" />
            </div>

            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Profile Picture URL</label>
                <input value={form.photoUrl} onChange={e => setForm(p => ({ ...p, photoUrl: e.target.value }))} placeholder="Link to picture (optional)" />
              </div>
            </div>

            <div className="va-field" style={{ marginTop: 12 }}>
              <label>Internal Notes</label>
              <textarea rows={3} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any special notes or contract terms..." style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontSize: 13, resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button type="button" className="va-btn secondary" onClick={() => setView('list')}>Cancel</button>
              <button type="submit" className="va-btn" disabled={saving}>{saving ? 'Saving…' : '✓ Save Record'}</button>
            </div>
          </form>
        </div>
      )}

      {/* VIEW: EMPLOYEE LIST */}
      {view === 'list' && (
        <div className="va-panel">
          <div className="va-panel-head" style={{ gap: 12, flexWrap: 'wrap' }}>
            <h3>Workforce Roster ({employees.length})</h3>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search name, phone, or role..."
              style={{ width: '100%', maxWidth: 280, padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
            />
          </div>

          {loading ? (
            <div className="va-loading">Opening ledger roster...</div>
          ) : filtered.length === 0 ? (
            <div className="va-empty"><div className="big">No employees found</div></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="va-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Phone</th>
                    <th>Salary</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr key={emp.id} style={{ opacity: emp.isActive ? 1 : 0.6 }}>
                      <td style={{ fontWeight: 700, color: 'var(--forest)' }}>
                        <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => loadProfile(emp.id)}>
                          {emp.name}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{ROLE_DISPLAY[emp.role] ?? emp.role}</td>
                      <td>{emp.phone || '—'}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{fmtMoney(emp.salary)}</td>
                      <td>{fmtDate(emp.joiningDate)}</td>
                      <td>
                        <span className={`va-badge ${emp.isActive ? 'paid' : 'due'}`}>
                          {emp.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="va-btn secondary small" onClick={() => loadProfile(emp.id)}>Profile</button>
                          <button className="va-btn secondary small" onClick={() => startEdit(emp)}>Edit</button>
                          <button className="va-btn secondary small" style={{ color: emp.isActive ? '#C62828' : '#2E7D32' }} onClick={() => toggleActiveStatus(emp)}>
                            {emp.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW: EMPLOYEE PROFILE DETAILS & PAYMENTS */}
      {view === 'profile' && activeEmp && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '20px' }}>
          
          {/* Column 1: Details & Payroll Status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="va-panel" style={{ marginBottom: 0 }}>
              <div className="va-panel-head"><h3>Employee Profile</h3></div>
              
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
                {activeEmp.photoUrl ? (
                  <img src={activeEmp.photoUrl} alt={activeEmp.name} style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--forest)' }} />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--forest)', color: '#fff', fontSize: 24, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {activeEmp.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <h3 style={{ margin: 0, fontSize: 18 }}>{activeEmp.name}</h3>
                  <span style={{ background: '#e9ecef', color: '#495057', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                    {ROLE_DISPLAY[activeEmp.role] ?? activeEmp.role}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', fontSize: 13 }}>
                <div>CNIC:</div><strong style={{ textAlign: 'right' }}>{activeEmp.cnic || '—'}</strong>
                <div>Father Name:</div><strong style={{ textAlign: 'right' }}>{activeEmp.fatherName || '—'}</strong>
                <div>Phone:</div><strong style={{ textAlign: 'right' }}>{activeEmp.phone || '—'}</strong>
                <div>WhatsApp:</div><strong style={{ textAlign: 'right' }}>{activeEmp.whatsapp || '—'}</strong>
                <div>Email:</div><strong style={{ textAlign: 'right' }}>{activeEmp.email || '—'}</strong>
                <div>Joined:</div><strong style={{ textAlign: 'right' }}>{fmtDate(activeEmp.joiningDate)}</strong>
                <div>Structure:</div><strong style={{ textAlign: 'right' }}>{activeEmp.paymentStructure || 'Monthly Fixed'}</strong>
                <div>Status:</div>
                <strong style={{ textAlign: 'right' }}>
                  <span className={`va-badge ${activeEmp.isActive ? 'paid' : 'due'}`}>{activeEmp.isActive ? 'Active' : 'Inactive'}</span>
                </strong>
              </div>

              {activeEmp.notes && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
                  <strong>Notes:</strong> {activeEmp.notes}
                </div>
              )}
            </div>

            {/* Payroll Management Section */}
            <div className="va-panel" style={{ marginBottom: 0 }}>
              <div className="va-panel-head"><h3>💰 Payroll &amp; Salary Payment</h3></div>
              
              {/* Select payroll Month */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Salary Month:</span>
                <select value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setPayForm(p => ({ ...p, month: e.target.value })); }} style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}>
                  {(() => {
                    const months = [];
                    for (let i = 0; i < 6; i++) {
                      const d = new Date();
                      d.setMonth(d.getMonth() - i);
                      months.push(d.toLocaleString('default', { month: 'long', year: 'numeric' }));
                    }
                    return months.map(m => <option key={m}>{m}</option>);
                  })()}
                </select>
              </div>

              {/* Payroll stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 20 }}>
                <div style={{ background: '#f8f9fa', padding: '10px 8px', borderRadius: 8, textAlign: 'center', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Monthly Pay</div>
                  <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{fmtMoney(activeEmp.salary)}</strong>
                </div>
                <div style={{ background: '#E3F9E9', padding: '10px 8px', borderRadius: 8, textAlign: 'center', border: '1px solid #C8E6C9' }}>
                  <div style={{ fontSize: 11, color: '#2E7D32' }}>Total Paid</div>
                  <strong style={{ fontSize: 13, color: '#2E7D32' }}>{fmtMoney(totalPaidSelectedMonth)}</strong>
                </div>
                <div style={{ background: remainingPaySelectedMonth > 0 ? '#FFF5F5' : '#E3F9E9', padding: '10px 8px', borderRadius: 8, textAlign: 'center', border: remainingPaySelectedMonth > 0 ? '1px solid #FFCDD2' : '1px solid #C8E6C9' }}>
                  <div style={{ fontSize: 11, color: remainingPaySelectedMonth > 0 ? 'var(--clay)' : '#2E7D32' }}>Remaining</div>
                  <strong style={{ fontSize: 13, color: remainingPaySelectedMonth > 0 ? 'var(--clay)' : '#2E7D32' }}>{fmtMoney(remainingPaySelectedMonth)}</strong>
                </div>
              </div>

              {/* Add Payment Form */}
              <form onSubmit={handleRecordPayment} style={{ background: '#f8f9fa', padding: '14px', borderRadius: 10, border: '1px solid var(--line)' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: 12 }}>Record Salary Payment</h4>
                <div className="va-form-row">
                  <div className="va-field">
                    <label>Amount (Rs) *</label>
                    <input type="number" required min={1} value={payForm.amount || ''} onChange={e => setPayForm(p => ({ ...p, amount: Number(e.target.value) }))} placeholder="Paid amount" style={{ padding: '6px' }} />
                  </div>
                  <div className="va-field">
                    <label>Method *</label>
                    <select value={payForm.method} onChange={e => setPayForm(p => ({ ...p, method: e.target.value }))} style={{ padding: '6px' }}>
                      {METHODS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="va-field" style={{ marginTop: 8 }}>
                  <label>Notes</label>
                  <input value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Reference details, txn id, etc." style={{ padding: '6px' }} />
                </div>
                <button type="submit" className="va-btn small" style={{ width: '100%', marginTop: 12 }} disabled={saving}>
                  {saving ? 'Recording…' : '✓ Record Salary Payment'}
                </button>
              </form>
            </div>
          </div>

          {/* Column 2: Histories (Payments & Deliveries) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Payment history list */}
            <div className="va-panel" style={{ marginBottom: 0, flex: 1 }}>
              <div className="va-panel-head"><h3>📋 Payment History</h3></div>
              {(!activeEmp.salaryPayments || activeEmp.salaryPayments.length === 0) ? (
                <div className="va-empty" style={{ padding: '24px 0' }}><div className="big">No payment history</div></div>
              ) : (
                <div style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: '300px', WebkitOverflowScrolling: 'touch' }}>
                  <table className="va-table" style={{ width: '100%' }}>
                    <thead>
                      <tr><th>Month</th><th>Date</th><th>Amount</th><th>Method</th></tr>
                    </thead>
                    <tbody>
                      {activeEmp.salaryPayments.map(pay => (
                        <tr key={pay.id}>
                          <td style={{ fontWeight: 700 }}>{pay.month}</td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(pay.paidOn)}</td>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(pay.amount)}</td>
                          <td><span className="va-badge paid">{pay.method}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Delivery assignment history list */}
            <div className="va-panel" style={{ marginBottom: 0, flex: 1 }}>
              <div className="va-panel-head"><h3>🚚 Delivery History</h3></div>
              {(!activeEmp.deliveries || activeEmp.deliveries.length === 0) ? (
                <div className="va-empty" style={{ padding: '24px 0' }}><div className="big">No deliveries assigned</div></div>
              ) : (
                <div style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: '300px', WebkitOverflowScrolling: 'touch' }}>
                  <table className="va-table" style={{ width: '100%' }}>
                    <thead>
                      <tr><th>Invoice</th><th>Client</th><th>Date</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {activeEmp.deliveries.map(del => (
                        <tr key={del.id}>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--forest)' }}>{del.sale?.invoiceNo || '—'}</td>
                          <td style={{ fontSize: 12 }}>{del.client?.name || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDate(del.date)}</td>
                          <td>
                            <span className={`va-badge ${del.status === 'DELIVERED' ? 'paid' : del.status === 'FAILED' ? 'due' : 'pending'}`}>
                              {del.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </DashboardLayout>
  );
}
