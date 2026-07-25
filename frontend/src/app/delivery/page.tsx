'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtDate, fmtDateTime, todayInputDate } from '@/utils/formatters';

interface Delivery {
  id: string;
  status: string;
  zone?: string;
  date: string;
  deliveredAt?: string | null;
  notes?: string | null;
  saleId: string;
  sale: { id: string; invoiceNo: string; total: number; deliveryDate?: string | null; deliveryTime?: string | null };
  client: { id: string; name: string; address?: string | null; phone?: string | null };
  vehicle?: { id: string; plateNo: string; type: string } | null;
  employee?: { id: string; name: string; phone?: string | null } | null;
  scheduledTime?: string | null;
}

interface Vehicle { id: string; plateNo: string; type: string; }
interface Employee { id: string; name: string; phone?: string | null; role: string; }

const STATUS_FLOW = ['PENDING', 'OUT', 'DELIVERED', 'FAILED', 'RETURNED'];
const BADGE_MAP: Record<string, string> = {
  PENDING: 'pending',
  OUT: 'partial',
  DELIVERED: 'paid',
  FAILED: 'due',
  RETURNED: 'due'
};

export default function DeliveryPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  // Admin Filters
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterEmployee, setFilterEmployee] = useState<string>('ALL');
  const [filterDate, setFilterDate] = useState<string>(() => todayInputDate());
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Mode state
  const [isEmployeeMode, setIsEmployeeMode] = useState<boolean>(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dParams = new URLSearchParams();
      if (filterDate) dParams.set('date', filterDate);

      const [dRes, vRes, eRes] = await Promise.all([
        fetch(`/api/delivery?${dParams.toString()}`),
        fetch('/api/vehicles'),
        fetch('/api/employees?activeOnly=true'),
      ]);
      
      const getJson = async (res: Response) => {
        try {
          const text = await res.text();
          return text ? JSON.parse(text) : { success: false, data: [] };
        } catch {
          return { success: false, data: [] };
        }
      };

      const [dd, vd, ed] = await Promise.all([getJson(dRes), getJson(vRes), getJson(eRes)]);
      if (dd.success) setDeliveries(dd.data ?? []);
      if (vd.success) setVehicles(vd.data ?? []);
      if (ed.success) setEmployees(ed.data ?? []);
    } catch (err) {
      console.error('Error loading delivery data:', err);
    }
    setLoading(false);
  }, [filterDate]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ Delivery marked ${status}`);
        await load();
      } else {
        showToast('❌ Update failed');
      }
    } catch {
      showToast('❌ Network error updating status');
    }
  };

  const assignVehicle = async (id: string, vehicleId: string) => {
    try {
      const res = await fetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, vehicleId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Vehicle assigned');
        await load();
      }
    } catch {
      showToast('❌ Error assigning vehicle');
    }
  };

  const assignEmployee = async (id: string, employeeId: string) => {
    try {
      const res = await fetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, employeeId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Delivery employee updated');
        await load();
      }
    } catch {
      showToast('❌ Error assigning employee');
    }
  };

  const assignDate = async (id: string, date: string) => {
    try {
      const res = await fetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, date }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Delivery date updated');
        await load();
      }
    } catch {
      showToast('❌ Error updating date');
    }
  };

  const assignTime = async (id: string, scheduledTime: string) => {
    try {
      const res = await fetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, scheduledTime }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Scheduled time updated');
        await load();
      }
    } catch {
      showToast('❌ Error updating time');
    }
  };

  // Base list of deliveries filtered for Employee Mode vs Admin Mode
  const baseDeliveries = isEmployeeMode
    ? deliveries.filter(d => d.employee?.id === selectedEmpId)
    : deliveries;

  // Search & Filter Processing
  const filtered = baseDeliveries.filter(d => {
    const matchesStatus = filterStatus === 'ALL' || d.status === filterStatus;
    const matchesEmployee = filterEmployee === 'ALL' || d.employee?.id === filterEmployee;
    const matchesDate = !filterDate || d.date.slice(0, 10) === filterDate;
    
    const matchesSearch = !searchQuery || 
      d.sale?.invoiceNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.client?.name.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesStatus && matchesEmployee && matchesDate && matchesSearch;
  });

  const counts = STATUS_FLOW.reduce((acc, s) => {
    acc[s] = baseDeliveries.filter(d => d.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,.18)' }}>
          {toast}
        </div>
      )}

      {/* Mode Selector Panel */}
      <div className="va-panel" style={{ padding: '12px 20px', background: '#f8f9fa' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Toggle Mode:</span>
            <button 
              className={`va-btn small ${!isEmployeeMode ? '' : 'secondary'}`} 
              onClick={() => setIsEmployeeMode(false)}
            >
              🏢 Admin Management
            </button>
            <button 
              className={`va-btn small ${isEmployeeMode ? '' : 'secondary'}`} 
              onClick={() => { setIsEmployeeMode(true); if (employees.length && !selectedEmpId) setSelectedEmpId(employees[0].id); }}
            >
              🚚 Employee Delivery View
            </button>
          </div>

          {isEmployeeMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Select Employee:</span>
              <select 
                value={selectedEmpId} 
                onChange={e => setSelectedEmpId(e.target.value)}
                style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, fontWeight: 700 }}
              >
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.role})</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Admin Filters Row */}
      {!isEmployeeMode && (
        <div className="va-panel" style={{ padding: '12px 20px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Search Invoice No or Client..."
              style={{ flex: 2, minWidth: 200, padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}
            />
            <select 
              value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, background: 'var(--paper)' }}
            >
              <option value="ALL">All Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
            <input 
              type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }} 
            />
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="va-tabs-inline">
        <button className={filterStatus === 'ALL' ? 'active' : ''} onClick={() => setFilterStatus('ALL')}>
          All ({baseDeliveries.length})
        </button>
        {STATUS_FLOW.map(s => (
          <button key={s} className={filterStatus === s ? 'active' : ''} onClick={() => setFilterStatus(s)}>
            {s === 'OUT' ? 'DISPATCHED' : s.replace(/_/g, ' ')} {counts[s] > 0 && `(${counts[s]})`}
          </button>
        ))}
      </div>

      {/* Deliveries Display */}
      <div className="va-panel">
        <div className="va-panel-head">
          <h3>
            {isEmployeeMode 
              ? `Assigned Delivery Tasks for: ${employees.find(e => e.id === selectedEmpId)?.name || 'Employee'}`
              : 'Delivery Dispatch Register'}
          </h3>
          <button className="va-btn secondary small" onClick={load}>↻ Refresh</button>
        </div>

        {loading ? (
          <div className="va-loading">Loading deliveries…</div>
        ) : filtered.length === 0 ? (
          <div className="va-empty">
            <div className="big">No deliveries found</div>
            <div>{isEmployeeMode ? 'All clear! No pending tasks assigned.' : 'Create sales with delivery dates to see items here.'}</div>
          </div>
        ) : (
          <>
            {/* Desktop Table View (Admin Mode only) */}
            {!isEmployeeMode && (
              <div className="hide-mobile">
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Address</th>
                      <th>Staff Assigned</th>
                      <th>Vehicle</th>
                      <th>Delivery Date</th>
                      <th>Time Slot</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(d => (
                      <tr key={d.id}>
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--forest)' }}>{d.sale?.invoiceNo}</td>
                        <td style={{ fontWeight: 600 }}>
                          {d.client?.name}
                          {d.client?.phone && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>📞 {d.client.phone}</div>}
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 11 }}>{d.client?.address ?? '—'}</td>
                        <td>
                          <select value={d.employee?.id ?? ''} onChange={e => assignEmployee(d.id, e.target.value)}
                            style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--paper)', fontWeight: 600 }}>
                            <option value="">— Assign Staff —</option>
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={d.vehicle?.id ?? ''} onChange={e => assignVehicle(d.id, e.target.value)}
                            style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--paper)', fontWeight: 600 }}>
                            <option value="">— Assign Vehicle —</option>
                            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNo}</option>)}
                          </select>
                        </td>
                        <td>
                          <input type="date" value={d.date.slice(0, 10)} onChange={e => assignDate(d.id, e.target.value)}
                            style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--line)', borderRadius: 4 }} />
                        </td>
                        <td>
                          <select value={d.scheduledTime || 'PHASE 1 (11:00 AM - 02:00 PM)'} onChange={e => assignTime(d.id, e.target.value)}
                            style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--paper)' }}>
                            <option value="PHASE 1 (11:00 AM - 02:00 PM)">PHASE 1 (11:00 AM - 02:00 PM)</option>
                            <option value="PHASE 2 (05:00 PM - 09:00 PM)">PHASE 2 (05:00 PM - 09:00 PM)</option>
                          </select>
                        </td>
                        <td><span className={`va-badge ${BADGE_MAP[d.status] ?? 'pending'}`}>{d.status === 'OUT' ? 'DISPATCHED' : d.status.replace(/_/g, ' ')}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            {d.status === 'PENDING' && (
                              <>
                                <button className="va-btn small" onClick={() => updateStatus(d.id, 'OUT')}>Dispatch</button>
                                <button className="va-btn small" onClick={() => updateStatus(d.id, 'DELIVERED')}>Delivered ✓</button>
                              </>
                            )}
                            {d.status === 'OUT' && (
                              <>
                                <button className="va-btn small" onClick={() => updateStatus(d.id, 'DELIVERED')}>Delivered ✓</button>
                                <button className="va-btn secondary small" style={{ color: 'var(--danger)' }} onClick={() => updateStatus(d.id, 'FAILED')}>Failed</button>
                              </>
                            )}
                            {d.status === 'FAILED' && (
                              <button className="va-btn secondary small" onClick={() => updateStatus(d.id, 'RETURNED')}>Returned</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                </table>
                </div>
              </div>
            )}

            {/* Mobile Card List View & Employee Portal View */}
            {/* Employee mode: always show cards. Admin mode: show-mobile only (desktop has the table above) */}
            <div className={isEmployeeMode ? '' : 'show-mobile'} style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
              {filtered.map(d => (
                <div key={d.id} className="va-mobile-card">
                  <div className="card-header">
                    <span className="card-title" style={{ color: '#FFFFFF', fontWeight: 700 }}>
                      {d.client?.name}
                    </span>
                    <span className="card-subtitle" style={{ opacity: 0.85 }}>
                      {fmtDate(d.date)}
                    </span>
                  </div>
                  
                  <div className="card-divider" />
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="card-info-row">
                      <span className="card-label">Invoice ID</span>
                      <span className="card-value">{d.sale?.invoiceNo}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Phone</span>
                      <span className="card-value">
                        {d.client?.phone ? (
                          <a href={`tel:${d.client.phone}`} style={{ color: '#fff', textDecoration: 'underline' }}>{d.client.phone}</a>
                        ) : '—'}
                      </span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Address</span>
                      <span className="card-value" style={{ maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {d.client?.address ?? '—'}
                      </span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Driver</span>
                      <span className="card-value">{d.employee?.name || '—'}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Vehicle</span>
                      <span className="card-value">{d.vehicle?.plateNo || '—'}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Time</span>
                      <span className="card-value">{d.scheduledTime || 'PHASE 1 (11:00 AM - 02:00 PM)'}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Status</span>
                      <span className={`va-badge ${BADGE_MAP[d.status] ?? 'pending'}`} style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.1)' }}>
                        {d.status === 'OUT' ? 'DISPATCHED' : d.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {d.deliveredAt && (
                      <div className="card-info-row">
                        <span className="card-label">Delivered At</span>
                        <span className="card-value" style={{ color: '#A8D5B5' }}>{fmtDateTime(d.deliveredAt)}</span>
                      </div>
                    )}
                  </div>

                  <div className="card-divider" />

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
                    {d.status === 'PENDING' && (
                      <>
                        <button className="card-btn" style={{ flex: 1 }} onClick={() => updateStatus(d.id, 'OUT')}>Dispatch</button>
                        <button className="card-btn primary" style={{ flex: 1 }} onClick={() => updateStatus(d.id, 'DELIVERED')}>Deliver ✓</button>
                      </>
                    )}
                    {d.status === 'OUT' && (
                      <>
                        <button className="card-btn primary" style={{ flex: 1 }} onClick={() => updateStatus(d.id, 'DELIVERED')}>Deliver ✓</button>
                        <button className="card-btn danger" style={{ flex: 1 }} onClick={() => updateStatus(d.id, 'FAILED')}>Fail ✕</button>
                      </>
                    )}
                    {d.status === 'FAILED' && (
                      <button className="card-btn" style={{ flex: 1 }} onClick={() => updateStatus(d.id, 'RETURNED')}>Return</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
