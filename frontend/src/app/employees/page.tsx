'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, todayInputDate } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import Icon from '@mdi/react';
import { mdiBriefcase, mdiAccountBadge, mdiTrashCanOutline, mdiAlertCircleOutline } from '@mdi/js';

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
  employeeId?: string | null;
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

const ROLES = ['ADMIN', 'SUPERVISOR', 'BILLING_STAFF', 'PURCHASE_STAFF', 'DELIVERY_STAFF'];
const ROLE_DISPLAY: Record<string, string> = {
  ADMIN: 'Admin',
  SUPERVISOR: 'Supervisor',
  BILLING_STAFF: 'Billing Staff',
  PURCHASE_STAFF: 'Purchase Staff',
  DELIVERY_STAFF: 'Delivery Staff',
};
const METHODS = ['CASH', 'BANK', 'CHEQUE', 'ONLINE'];

const BLANK_FORM = {
  employeeId: '', name: '', role: 'DELIVERY_STAFF', phone: '', salary: 0, joiningDate: todayInputDate(),
  fatherName: '', cnic: '', address: '', whatsapp: '', email: '',
  paymentStructure: 'Monthly Fixed', notes: '', photoUrl: '', password: ''
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
  const [computedEmployeeId, setComputedEmployeeId] = useState('');

  // Delete modal states
  const [empToDelete, setEmpToDelete] = useState<Employee | null>(null);
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  
  // Payment states
  const [payForm, setPayForm] = useState({ ...BLANK_PAYMENT });
  const [selectedMonth, setSelectedMonth] = useState(new Date().toLocaleString('default', { month: 'long', year: 'numeric' }));

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // Load employees
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/employees');
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

  // Dynamically calculate unique Employee ID based on phone/whatsapp as user types
  useEffect(() => {
    if (view === 'add' || view === 'edit') {
      const fetchEmployeeId = async () => {
        try {
          const params = new URLSearchParams();
          if (form.phone) params.append('phone', form.phone);
          if (form.whatsapp) params.append('whatsapp', form.whatsapp);
          if (view === 'edit' && activeEmp?.id) params.append('excludeId', activeEmp.id);
          
          const res = await apiFetch(`/api/employees/generate-id?${params.toString()}`);
          const data = await res.json();
          if (data.success && data.data?.employeeId) {
            setComputedEmployeeId(data.data.employeeId);
          }
        } catch {
          // fallback
        }
      };
      const timer = setTimeout(fetchEmployeeId, 300);
      return () => clearTimeout(timer);
    }
  }, [form.phone, form.whatsapp, view, activeEmp?.id]);

  // Load single employee profile details
  const loadProfile = async (id: string) => {
    try {
      const res = await apiFetch(`/api/employees/${id}`);
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
    if (view === 'add' && (!form.password || !form.password.trim())) {
      return showToast('❌ Password is required');
    }

    setSaving(true);
    try {
      const isEdit = view === 'edit';
      const url = isEdit ? `/api/employees/${activeEmp?.id}` : '/api/employees';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(isEdit ? '✅ Employee updated successfully' : `✅ Employee created! ID: ${data.data?.employeeId ?? 'Assigned'}`);
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
      const res = await apiFetch(`/api/employees/${emp.id}/toggle`, { method: 'PATCH' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ Employee ${data.data?.isActive ? 'activated' : 'deactivated'}`);
        await load();
        if (activeEmp?.id === emp.id) {
          loadProfile(emp.id);
        }
      } else {
        showToast('❌ Failed to update status');
      }
    } catch {
      showToast('❌ Network error');
    }
  };

  // Delete single employee permanently
  const confirmDeleteEmployee = async () => {
    if (!empToDelete) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/employees/${empToDelete.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ Employee "${empToDelete.name}" permanently deleted`);
        setEmpToDelete(null);
        if (view === 'profile' && activeEmp?.id === empToDelete.id) {
          setView('list');
        }
        await load();
      } else {
        showToast('❌ ' + (data.error ?? 'Failed to delete employee'));
      }
    } catch {
      showToast('❌ Network error deleting employee');
    } finally {
      setSaving(false);
    }
  };

  // Clear ALL employees permanently
  const confirmClearAllEmployees = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/employees/clear-all', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ All employee records permanently deleted');
        setShowClearAllModal(false);
        setView('list');
        await load();
      } else {
        showToast('❌ ' + (data.error ?? 'Failed to delete all employees'));
      }
    } catch {
      showToast('❌ Network error');
    } finally {
      setSaving(false);
    }
  };

  // Record salary payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEmp) return;
    if (payForm.amount <= 0) return showToast('❌ Amount must be greater than zero');

    setSaving(true);
    try {
      const res = await apiFetch(`/api/employees/${activeEmp.id}/payments`, {
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
    setComputedEmployeeId('Auto-generated (e.g. 9001)');
    setView('add');
  };

  const startEdit = (emp: Employee) => {
    setForm({
      employeeId: emp.employeeId || '',
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
      photoUrl: emp.photoUrl || '',
      password: '',
    });
    setComputedEmployeeId(emp.employeeId || 'Auto-generated');
    setView('edit');
  };

  const filtered = search
    ? employees.filter(e =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        (e.employeeId || '').includes(search) ||
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
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>Manage workforce personnel, employee login credentials, salary structures, and delivery history</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {view === 'list' ? (
              <>
                {employees.length > 0 && (
                  <button className="va-btn secondary small" style={{ color: '#C62828', borderColor: '#E9C6C6' }} onClick={() => setShowClearAllModal(true)}>
                    🗑️ Delete All Employees Data
                  </button>
                )}
                <button className="va-btn" onClick={startAdd}>+ Add Employee</button>
              </>
            ) : (
              <button className="va-btn secondary small" onClick={() => setView('list')}>← Back to List</button>
            )}
          </div>
        </div>
      </div>

      {/* VIEW: ADD / EDIT EMPLOYEE */}
      {(view === 'add' || view === 'edit') && (
        <div className="va-panel" style={{ maxWidth: 750 }}>
          <div className="va-panel-head">
            <h3>{view === 'edit' ? `✏️ Edit Employee: ${activeEmp?.name}` : '➕ New Employee Record'}</h3>
          </div>
          <form onSubmit={handleSubmit}>
            {/* Employee ID & Login Credentials Section */}
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1A3C28', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon path={mdiAccountBadge} size={0.85} color="#1A3C28" />
                <span>Employee Login Credentials (Auto-Generated)</span>
              </div>
              <div className="va-form-row">
                <div className="va-field">
                  <label>Employee ID (Read-Only) *</label>
                  <input
                    readOnly
                    disabled
                    value={computedEmployeeId || form.employeeId || 'Auto-generated (e.g. 9001)'}
                    style={{ background: '#EDF2F7', color: '#2D3748', fontWeight: 700, cursor: 'not-allowed' }}
                  />
                  <small style={{ fontSize: 11, color: '#718096', marginTop: 4 }}>Auto-computed from last 4+ digits of WhatsApp/mobile number.</small>
                </div>
                <div className="va-field">
                  <label>{view === 'edit' ? 'New Login Password (Leave blank to keep existing)' : 'Assign Login Password *'}</label>
                  <input
                    type="password"
                    required={view === 'add'}
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    placeholder={view === 'edit' ? 'Enter new password (optional)' : 'Initial login password (required)'}
                  />
                  <small style={{ fontSize: 11, color: '#718096', marginTop: 4 }}>Stored securely using bcrypt hashing.</small>
                </div>
              </div>
            </div>

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
                <input required value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="Primary phone number (e.g. 03118469001)" />
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
              placeholder="🔍 Search name, Employee ID, phone, or role..."
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
                    <th>Emp ID</th>
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
                      <td style={{ fontWeight: 700, fontFamily: 'monospace', color: '#1A3C28' }}>
                        {emp.employeeId || '—'}
                      </td>
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
                          <button className="va-btn secondary small" style={{ color: '#9B1C1C', borderColor: '#F8B4B4' }} onClick={() => setEmpToDelete(emp)}>
                            Delete
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
              <div className="va-panel-head" style={{ justifyContent: 'space-between' }}>
                <h3>Employee Profile</h3>
                <button className="va-btn secondary small" style={{ color: '#9B1C1C', borderColor: '#F8B4B4' }} onClick={() => setEmpToDelete(activeEmp)}>
                  🗑️ Delete Profile
                </button>
              </div>
              
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
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ background: '#1A3C28', color: '#FFFFFF', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
                      ID: {activeEmp.employeeId || '—'}
                    </span>
                    <span style={{ background: '#e9ecef', color: '#495057', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                      {ROLE_DISPLAY[activeEmp.role] ?? activeEmp.role}
                    </span>
                  </div>
                </div>
              </div>

              <table className="va-table" style={{ fontSize: 13 }}>
                <tbody>
                  <tr><td style={{ color: 'var(--muted)' }}>Employee ID:</td><td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{activeEmp.employeeId || '—'}</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>Phone / Contact:</td><td>{activeEmp.phone || '—'}</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>WhatsApp:</td><td>{activeEmp.whatsapp || '—'}</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>Email:</td><td>{activeEmp.email || '—'}</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>CNIC:</td><td>{activeEmp.cnic || '—'}</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>Guardian Name:</td><td>{activeEmp.fatherName || '—'}</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>Joining Date:</td><td>{fmtDate(activeEmp.joiningDate)}</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>Salary:</td><td className="mono" style={{ fontWeight: 700 }}>{fmtMoney(activeEmp.salary)} ({activeEmp.paymentStructure})</td></tr>
                  <tr><td style={{ color: 'var(--muted)' }}>Address:</td><td>{activeEmp.address || '—'}</td></tr>
                  {activeEmp.notes && <tr><td style={{ color: 'var(--muted)' }}>Notes:</td><td>{activeEmp.notes}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Column 2: Salary Payment Entry & History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Record Payment Form */}
            <div className="va-panel" style={{ marginBottom: 0 }}>
              <div className="va-panel-head"><h3>Record Salary Payment</h3></div>
              <form onSubmit={handleRecordPayment}>
                <div className="va-form-row">
                  <div className="va-field">
                    <label>Salary Month *</label>
                    <input required value={payForm.month} onChange={e => setPayForm(p => ({ ...p, month: e.target.value }))} placeholder="e.g. October 2024" />
                  </div>
                  <div className="va-field">
                    <label>Payment Amount (Rs) *</label>
                    <input type="number" required min={1} value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: Number(e.target.value) }))} />
                  </div>
                </div>

                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label>Payment Method *</label>
                    <select value={payForm.method} onChange={e => setPayForm(p => ({ ...p, method: e.target.value }))}>
                      {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="va-field">
                    <label>Payment Notes / Reference</label>
                    <input value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Cash voucher # or bank ref" />
                  </div>
                </div>

                <button type="submit" className="va-btn" style={{ marginTop: 16 }} disabled={saving}>
                  {saving ? 'Processing…' : '💳 Record Salary Payment'}
                </button>
              </form>
            </div>

            {/* Payment History */}
            <div className="va-panel" style={{ marginBottom: 0 }}>
              <div className="va-panel-head" style={{ justifyContent: 'space-between' }}>
                <h3>Payment History</h3>
                <input
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  placeholder="Filter month..."
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 4, width: 140 }}
                />
              </div>

              <div style={{ background: 'var(--paper-light)', padding: '12px', borderRadius: 8, marginBottom: 12, display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div><small style={{ color: 'var(--muted)' }}>Month Salary</small><div className="mono" style={{ fontWeight: 700 }}>{fmtMoney(activeEmp.salary)}</div></div>
                <div><small style={{ color: 'var(--muted)' }}>Paid</small><div className="mono" style={{ fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(totalPaidSelectedMonth)}</div></div>
                <div><small style={{ color: 'var(--muted)' }}>Remaining</small><div className="mono" style={{ fontWeight: 700, color: remainingPaySelectedMonth > 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmtMoney(remainingPaySelectedMonth)}</div></div>
              </div>

              {(!activeEmp.salaryPayments || activeEmp.salaryPayments.length === 0) ? (
                <div className="va-empty" style={{ padding: 20 }}>No salary payments recorded yet</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="va-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Month</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeEmp.salaryPayments.map(p => (
                        <tr key={p.id}>
                          <td>{fmtDate(p.paidOn)}</td>
                          <td style={{ fontWeight: 600 }}>{p.month}</td>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(p.amount)}</td>
                          <td><span className="va-badge neutral">{p.method}</span></td>
                          <td>{p.notes || '—'}</td>
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

      {/* CONFIRM SINGLE DELETE MODAL */}
      {empToDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#FFF', borderRadius: 12, maxWidth: 420, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FDF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon path={mdiAlertCircleOutline} size={1.2} color="#9B1C1C" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, color: '#9B1C1C' }}>Delete Employee Profile?</h3>
                <p style={{ fontSize: 13, color: '#4A5568', marginTop: 6, lineHeight: 1.5 }}>
                  Are you sure you want to permanently delete <strong>{empToDelete.name}</strong> (ID: {empToDelete.employeeId || 'N/A'})?
                  This will remove their profile, salary payments, attendance records, and login user account.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="va-btn secondary" onClick={() => setEmpToDelete(null)} disabled={saving}>Cancel</button>
              <button className="va-btn" style={{ background: '#9B1C1C', borderColor: '#9B1C1C' }} onClick={confirmDeleteEmployee} disabled={saving}>
                {saving ? 'Deleting…' : 'Yes, Delete Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM CLEAR ALL EMPLOYEES MODAL */}
      {showClearAllModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#FFF', borderRadius: 12, maxWidth: 450, width: '100%', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FDF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon path={mdiTrashCanOutline} size={1.2} color="#9B1C1C" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: '#9B1C1C' }}>Delete ALL Employees Data?</h3>
                <p style={{ fontSize: 13, color: '#4A5568', marginTop: 8, lineHeight: 1.5 }}>
                  ⚠️ <strong>Warning:</strong> You are about to permanently delete <strong>ALL ({employees.length}) employee records</strong>, including all attendance logs, salary payment histories, and employee login user accounts.
                </p>
                <p style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>This action cannot be undone.</p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
              <button className="va-btn secondary" onClick={() => setShowClearAllModal(false)} disabled={saving}>Cancel</button>
              <button className="va-btn" style={{ background: '#9B1C1C', borderColor: '#9B1C1C' }} onClick={confirmClearAllEmployees} disabled={saving}>
                {saving ? 'Deleting All…' : 'Delete ALL Employees'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
