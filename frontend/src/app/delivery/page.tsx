'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtDate, fmtDateTime, todayInputDate } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow, MobileCardBox, MobileCardBadge } from '@/components/ui/MobileCard';
import { usePreservedState } from '@/hooks/usePreservedState';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';

interface DeliveryItem {
  id: string;
  itemName: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  returnedQty?: number;
  returnReason?: string | null;
}

interface Delivery {
  id: string;
  status: string;
  zone?: string;
  date: string;
  deliveredAt?: string | null;
  notes?: string | null;
  saleId: string;
  sale: {
    id: string;
    invoiceNo: string;
    total: number;
    deliveryDate?: string | null;
    deliveryTime?: string | null;
    items?: DeliveryItem[];
  };
  client: { id: string; name: string; address?: string | null; phone?: string | null };
  vehicle?: { id: string; plateNo: string; type: string } | null;
  employee?: { id: string; name: string; phone?: string | null } | null;
  scheduledTime?: string | null;
}

interface Vehicle { id: string; plateNo: string; type: string; }
interface Employee { id: string; name: string; phone?: string | null; role: string; }

const STATUS_FLOW = ['PENDING', 'OUT', 'DELIVERED', 'FAILED', 'RETURNED'];

export default function DeliveryPage() {
  const [dState, setDState] = usePreservedState('delivery', {
    view: 'table' as 'table' | 'grid',
    filterStatus: 'ALL',
    filterEmployee: 'ALL',
    filterDate: todayInputDate(),
    searchQuery: '',
  });

  const filterStatus = dState.filterStatus;
  const setFilterStatus = (st: string) => setDState({ filterStatus: st });

  const filterEmployee = dState.filterEmployee;
  const setFilterEmployee = (emp: string) => setDState({ filterEmployee: emp });

  const filterDate = dState.filterDate;
  const setFilterDate = (dt: string) => setDState({ filterDate: dt });

  const searchQuery = dState.searchQuery;
  const setSearchQuery = (sq: string) => setDState({ searchQuery: sq });

  const adminViewMode = dState.view;
  const setAdminViewMode = (vm: any) => setDState({ view: vm });

  const [deliveries, setDeliveries] = useState<Delivery[]>(() => {
    const d = filterDate || todayInputDate();
    return getCachedData<Delivery[]>(`/api/delivery?date=${d}`) || [];
  });
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => {
    return getCachedData<Vehicle[]>('/api/vehicles') || [];
  });
  const [employees, setEmployees] = useState<Employee[]>(() => {
    return getCachedData<Employee[]>('/api/employees?activeOnly=true') || [];
  });
  const [loading, setLoading] = useState(() => {
    const d = filterDate || todayInputDate();
    return !getCachedData<Delivery[]>(`/api/delivery?date=${d}`);
  });
  const [toast, setToast] = useState('');

  // Mode state
  const [isEmployeeMode, setIsEmployeeMode] = useState<boolean>(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');
  const [loggedInUser, setLoggedInUser] = useState<any>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // Failed & Return Modals State
  const [failedModalDelivery, setFailedModalDelivery] = useState<Delivery | null>(null);
  const [failureReasonInput, setFailureReasonInput] = useState<string>('Customer Refused');

  const [returnModalDelivery, setReturnModalDelivery] = useState<Delivery | null>(null);
  const [returnInputs, setReturnInputs] = useState<Record<string, { returnedQty: number; reason: string }>>({});

  const openReturnModal = (d: Delivery) => {
    setReturnModalDelivery(d);
    const initial: Record<string, { returnedQty: number; reason: string }> = {};
    d.sale?.items?.forEach(item => {
      initial[item.id] = { returnedQty: item.returnedQty || 0, reason: item.returnReason || '' };
    });
    setReturnInputs(initial);
  };

  const submitFailedDelivery = async () => {
    if (!failedModalDelivery) return;
    const id = failedModalDelivery.id;
    const reason = failureReasonInput || 'Delivery Failed';

    setFailedModalDelivery(null);
    showToast('⏳ Marking delivery as Failed...');

    try {
      const res = await apiFetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'FAILED', failureReason: reason }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/delivery');
        invalidateCache('/api/clients');
        invalidateCache('/api/collections');
        invalidateCache('/api/sales');
        invalidateCache('/api/reports');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast('❌ Delivery marked as Failed & Stock Restored');
        await load(true);
      } else {
        showToast(`❌ Failed: ${data.error || 'Update failed'}`);
      }
    } catch {
      showToast('❌ Network error marking delivery failed');
    }
  };

  const { isSubmitting: isSubmittingReturn, submit: executeSubmitReturn } = useIdempotentSubmit({
    onSubmit: async (_: any, idempotencyKey: string) => {
      if (!returnModalDelivery) return;
      const deliveryId = returnModalDelivery.id;
      const returnsPayload = Object.entries(returnInputs)
        .filter(([_, val]) => val.returnedQty > 0)
        .map(([itemId, val]) => ({
          itemId,
          returnedQty: val.returnedQty,
          reason: val.reason || 'Customer Return',
        }));

      if (returnsPayload.length === 0) {
        showToast('⚠️ No returned quantities entered');
        return;
      }

      setReturnModalDelivery(null);
      showToast('⏳ Processing returned products...');

      const res = await apiFetch('/api/delivery/return', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ deliveryId, returns: returnsPayload }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache();
        window.dispatchEvent(new Event('app-revalidate'));
        showToast('✅ Returns processed, invoice recalculated & stock restored');
        await load(true);
      } else {
        showToast(`❌ Error: ${data.error || 'Failed to process returns'}`);
      }
    },
    onError: () => {
      showToast('❌ Network error processing returns');
    },
  });

  const submitReturnDelivery = () => executeSubmitReturn();

  // Detect logged-in user role & auto-select delivery staff
  useEffect(() => {
    try {
      const rawUser = localStorage.getItem('sabzi_user') || localStorage.getItem('user');
      if (rawUser) {
        const u = JSON.parse(rawUser);
        setLoggedInUser(u);
        const r = (u.role || '').toUpperCase();
        const isDelivery = r === 'DELIVERY_STAFF' || r === 'DELIVERY' || r === 'DELIVERY_BOY' || (Boolean(u.employeeId) && !['OWNER', 'MANAGER', 'ADMIN', 'ACCOUNTANT', 'PURCHASE_STAFF'].includes(r));
        if (isDelivery) {
          setIsEmployeeMode(true);
          if (u.employeeId) setSelectedEmpId(u.employeeId);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && deliveries.length === 0) setLoading(true);
    try {
      const dParams = new URLSearchParams();
      if (filterDate) dParams.set('date', filterDate);
      if (selectedEmpId) dParams.set('employeeId', selectedEmpId);

      const dKey = `/api/delivery?${dParams.toString()}`;
      const [dd, vd, ed] = await Promise.all([
        fetchWithCache<Delivery[]>(dKey, { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<any[]>('/api/vehicles', { ttl: TTL_MEDIUM, forceRefresh: isBackground }),
        fetchWithCache<any[]>('/api/employees?activeOnly=true', { ttl: TTL_MEDIUM, forceRefresh: isBackground }),
      ]);
      
      if (dd) setDeliveries(dd);
      if (vd) setVehicles(vd);
      if (ed) setEmployees(ed);
    } catch (err) {
      console.error('Error loading delivery data:', err);
    } finally {
      setLoading(false);
    }
  }, [filterDate, selectedEmpId, deliveries.length]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleRevalidate = () => {
      load(true);
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [load]);

  const updateStatus = async (id: string, status: string) => {
    const backup = [...deliveries];

    // Optimistic UI update
    setDeliveries(prev => prev.map(d => {
      if (d.id === id) {
        return { ...d, status: status as any };
      }
      return d;
    }));

    showToast(status === 'DELIVERED' ? '⏳ Updating delivery status...' : `⏳ Marking delivery as ${status}...`);

    try {
      const res = await apiFetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/delivery');
        showToast(status === 'DELIVERED' ? '✅ Delivery marked as Delivered' : `✅ Delivery marked ${status}`);
        await load(true);
      } else {
        setDeliveries(backup);
        showToast('❌ Update failed');
      }
    } catch {
      setDeliveries(backup);
      showToast('❌ Network error updating status');
    }
  };

  const assignVehicle = async (id: string, vehicleId: string) => {
    try {
      const res = await apiFetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, vehicleId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/delivery');
        showToast('✅ Vehicle assigned');
        await load(true);
      }
    } catch {
      showToast('❌ Error assigning vehicle');
    }
  };

  const assignEmployee = async (id: string, employeeId: string) => {
    try {
      const res = await apiFetch('/api/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, employeeId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/delivery');
        showToast('✅ Delivery employee updated');
        await load(true);
      }
    } catch {
      showToast('❌ Error assigning employee');
    }
  };

  const assignDate = async (id: string, date: string) => {
    try {
      const res = await apiFetch('/api/delivery', {
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
      const res = await apiFetch('/api/delivery', {
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

  // Delivery staff list
  const deliveryStaffList = employees.filter(e => e.role === 'DELIVERY_STAFF' || e.role === 'Delivery Staff');
  const availableStaff = deliveryStaffList.length > 0 ? deliveryStaffList : employees;

  // Base list of deliveries filtered for Employee Mode vs Admin Mode
  const baseDeliveries = isEmployeeMode
    ? (selectedEmpId ? deliveries.filter(d => d.employee?.id === selectedEmpId) : deliveries)
    : deliveries;

  // Search & Filter Processing
  const filtered = baseDeliveries.filter(d => {
    const matchesStatus = filterStatus === 'ALL' || d.status === filterStatus;
    const matchesEmployee = filterEmployee === 'ALL' || d.employee?.id === filterEmployee;
    const matchesDate = !filterDate || d.date.slice(0, 10) === filterDate;
    
    const matchesSearch = !searchQuery || 
      d.sale?.invoiceNo?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.client?.name?.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesStatus && matchesEmployee && matchesDate && matchesSearch;
  });

  const counts = STATUS_FLOW.reduce((acc, s) => {
    acc[s] = baseDeliveries.filter(d => d.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  const activeEmpName = availableStaff.find(e => e.id === selectedEmpId)?.name || loggedInUser?.name || 'Delivery Employee';

  const userRole = (loggedInUser?.role || '').toUpperCase();
  const isDeliveryStaff = 
    userRole === 'DELIVERY_STAFF' || 
    userRole === 'DELIVERY' || 
    userRole === 'DELIVERY_BOY' || 
    (Boolean(loggedInUser?.employeeId) && !['OWNER', 'MANAGER', 'ADMIN', 'ACCOUNTANT', 'PURCHASE_STAFF', 'PURCHASE'].includes(userRole));

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,.18)' }}>
          {toast}
        </div>
      )}

      {/* Mode Selector Panel */}
      <div className="va-panel" style={{ padding: '14px 20px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>View Mode:</span>
            {!isDeliveryStaff && (
              <button 
                className={`va-btn small ${!isEmployeeMode ? '' : 'secondary'}`} 
                style={{ fontWeight: 700, borderRadius: '6px' }}
                onClick={() => setIsEmployeeMode(false)}
              >
                🏢 Admin Management
              </button>
            )}
            <button 
              className={`va-btn small ${isEmployeeMode ? '' : 'secondary'}`} 
              style={{ fontWeight: 700, borderRadius: '6px' }}
              onClick={() => {
                setIsEmployeeMode(true);
                if (availableStaff.length && !selectedEmpId) {
                  setSelectedEmpId(availableStaff[0].id);
                }
              }}
            >
              🚚 Employee Delivery View
            </button>
          </div>

          {isEmployeeMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Delivery Staff:</span>
              <select 
                value={selectedEmpId} 
                onChange={e => setSelectedEmpId(e.target.value)}
                style={{ padding: '6px 12px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', fontWeight: 700, background: '#F8FAFC', color: '#0F172A' }}
              >
                {availableStaff.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} {emp.phone ? `(${emp.phone})` : ''}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Admin Filters Row */}
      {!isEmployeeMode && (
        <div className="va-panel" style={{ padding: '14px 20px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 2, minWidth: 220 }}>
              <input
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="🔍 Search Invoice No or Client Name..."
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '13px', background: '#F8FAFC' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Filter Staff:</span>
              <select 
                value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}
                style={{ padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '13px', background: '#F8FAFC', fontWeight: 600 }}
              >
                <option value="ALL">All Delivery Staff</option>
                {availableStaff.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Delivery Date:</span>
              <input 
                type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                style={{ padding: '7px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '13px', background: '#F8FAFC', fontWeight: 600 }} 
              />
            </div>
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="va-tabs-inline" style={{ marginTop: 12 }}>
        <button className={filterStatus === 'ALL' ? 'active' : ''} onClick={() => setFilterStatus('ALL')}>
          All ({baseDeliveries.length})
        </button>
        {STATUS_FLOW.map(s => (
          <button key={s} className={filterStatus === s ? 'active' : ''} onClick={() => setFilterStatus(s)}>
            {s === 'OUT' ? 'DISPATCHED' : s.replace(/_/g, ' ')} {counts[s] > 0 && `(${counts[s]})`}
          </button>
        ))}
      </div>

      {/* Deliveries Display Panel */}
      <div className="va-panel" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)', marginTop: 12 }}>
        <div className="va-panel-head" style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9' }}>
          <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#0F172A', margin: 0 }}>
            {isEmployeeMode 
              ? `Assigned Deliveries for: ${activeEmpName}`
              : 'Delivery Dispatch & Tracking Register'}
          </h3>
          <button className="va-btn secondary small" style={{ fontWeight: 600 }} onClick={() => load()}>↻ Refresh</button>
        </div>

        {loading && deliveries.length === 0 ? (
          <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={6} /></div>
        ) : filtered.length === 0 ? (
          <div className="va-empty" style={{ padding: '40px 0', textAlign: 'center' }}>
            <div className="big" style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>No deliveries found</div>
            <div style={{ color: '#64748B', fontSize: '13px', marginTop: 4 }}>
              {isEmployeeMode ? `No delivery tasks assigned for ${activeEmpName}.` : 'Create sales with assigned delivery staff to see items here.'}
            </div>
          </div>
        ) : (
          <div style={{ padding: '16px 20px' }}>
            {/* Desktop Table View (Admin Mode only) - Automatically visible on desktop screens */}
            {!isEmployeeMode && (
              <div className="hide-mobile">
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table" style={{ minWidth: 950, width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      <th style={{ padding: '10px 14px', borderRadius: '6px 0 0 6px' }}>Invoice</th>
                      <th style={{ padding: '10px 14px' }}>Client & Contact</th>
                      <th style={{ padding: '10px 14px' }}>Delivery Address</th>
                      <th style={{ padding: '10px 14px' }}>Staff Assigned</th>
                      <th style={{ padding: '10px 14px' }}>Vehicle</th>
                      <th style={{ padding: '10px 14px' }}>Schedule</th>
                      <th style={{ padding: '10px 14px' }}>Order Items</th>
                      <th style={{ padding: '10px 14px' }}>Status</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', borderRadius: '0 6px 6px 0' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(d => (
                      <tr key={d.id} style={{ background: '#FFFFFF', borderBottom: '1px solid #F1F5F9' }}>
                        <td className="mono" style={{ fontWeight: 700, color: '#1B4D2E', padding: '12px 14px' }}>
                          {d.sale?.invoiceNo}
                          <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>{fmtDate(d.date)}</div>
                        </td>

                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 700, color: '#0F172A', fontSize: '14px' }}>{d.client?.name}</div>
                          {d.client?.phone ? (
                            <a href={`tel:${d.client.phone}`} style={{ fontSize: '12px', color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}>
                              📞 {d.client.phone}
                            </a>
                          ) : <span style={{ fontSize: '11px', color: '#94A3B8' }}>No phone</span>}
                        </td>

                        <td style={{ padding: '12px 14px', color: '#334155', fontSize: '12px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.client?.address ?? '—'}
                        </td>

                        <td style={{ padding: '12px 14px' }}>
                          <select 
                            value={d.employee?.id ?? ''} 
                            onChange={e => assignEmployee(d.id, e.target.value)}
                            style={{ fontSize: '12px', padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#F8FAFC', fontWeight: 600, color: '#0F172A' }}
                          >
                            <option value="">— Assign Staff —</option>
                            {availableStaff.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </td>

                        <td style={{ padding: '12px 14px' }}>
                          <select 
                            value={d.vehicle?.id ?? ''} 
                            onChange={e => assignVehicle(d.id, e.target.value)}
                            style={{ fontSize: '12px', padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#F8FAFC', fontWeight: 600 }}
                          >
                            <option value="">— Vehicle —</option>
                            {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNo}</option>)}
                          </select>
                        </td>

                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#0F172A' }}>
                            {d.scheduledTime ? d.scheduledTime.split('(')[0] : 'PHASE 1'}
                          </div>
                          <input 
                            type="date" 
                            value={d.date.slice(0, 10)} 
                            onChange={e => assignDate(d.id, e.target.value)}
                            style={{ fontSize: '11px', padding: '2px 4px', border: '1px solid #CBD5E1', borderRadius: '4px', marginTop: '2px' }} 
                          />
                        </td>

                        {/* Order Items Preview */}
                        <td style={{ padding: '12px 14px' }}>
                          {d.sale?.items && d.sale.items.length > 0 ? (
                            <div style={{ background: '#F0FDF4', border: '1px solid #DCFCE7', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', color: '#166534', fontWeight: 600, maxWidth: 160 }}>
                              📦 {d.sale.items.length} {d.sale.items.length === 1 ? 'item' : 'items'}
                              <div style={{ fontSize: '10px', color: '#15803D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {d.sale.items.map(i => i.itemName).join(', ')}
                              </div>
                            </div>
                          ) : <span style={{ fontSize: '11px', color: '#94A3B8' }}>—</span>}
                        </td>

                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '4px 10px',
                            borderRadius: '12px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                            background: d.status === 'DELIVERED' ? '#DCFCE7' : d.status === 'OUT' ? '#E0F2FE' : d.status === 'FAILED' ? '#FEE2E2' : '#FEF3C7',
                            color: d.status === 'DELIVERED' ? '#15803D' : d.status === 'OUT' ? '#0369A1' : d.status === 'FAILED' ? '#991B1B' : '#B45309',
                            border: `1px solid ${d.status === 'DELIVERED' ? '#86EFAC' : d.status === 'OUT' ? '#BAE6FD' : d.status === 'FAILED' ? '#FCA5A5' : '#FDE68A'}`
                          }}>
                            {d.status === 'OUT' ? 'DISPATCHED' : d.status.replace(/_/g, ' ')}
                          </span>
                        </td>

                        <td style={{ textAlign: 'right', padding: '12px 14px' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            {d.status === 'PENDING' && (
                              <>
                                <button className="va-btn small" style={{ background: '#0284C7', color: '#FFF', fontWeight: 700, padding: '4px 10px', borderRadius: '6px' }} onClick={() => updateStatus(d.id, 'OUT')}>
                                  Dispatch
                                </button>
                                <button className="va-btn small" style={{ background: '#16A34A', color: '#FFF', fontWeight: 700, padding: '4px 10px', borderRadius: '6px' }} onClick={() => updateStatus(d.id, 'DELIVERED')}>
                                  Delivered ✓
                                </button>
                              </>
                            )}
                            {d.status === 'OUT' && (
                              <>
                                <button className="va-btn small" style={{ background: '#16A34A', color: '#FFF', fontWeight: 700, padding: '4px 10px', borderRadius: '6px' }} onClick={() => updateStatus(d.id, 'DELIVERED')}>
                                  Delivered ✓
                                </button>
                                <button className="va-btn secondary small" style={{ color: '#DC2626', borderColor: '#FCA5A5', fontWeight: 600, padding: '4px 8px', borderRadius: '6px' }} onClick={() => setFailedModalDelivery(d)}>
                                  Failed
                                </button>
                                {d.sale?.items && d.sale.items.length > 0 && (
                                  <button className="va-btn secondary small" style={{ color: '#D97706', borderColor: '#FDE68A', fontWeight: 600, padding: '4px 8px', borderRadius: '6px' }} onClick={() => openReturnModal(d)}>
                                    ↩️ Return
                                  </button>
                                )}
                              </>
                            )}
                            {d.status === 'FAILED' && (
                              <button className="va-btn secondary small" style={{ color: '#D97706', fontWeight: 600 }} onClick={() => updateStatus(d.id, 'RETURNED')}>
                                Returned
                              </button>
                            )}
                            {d.status === 'DELIVERED' && (
                              <span style={{ fontSize: '11px', color: '#166534', fontWeight: 700 }}>✓ Done</span>
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

            {/* Responsive Card List View */}
            <div 
              className={isEmployeeMode ? '' : 'show-mobile'}
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '14px', 
                width: '100%'
              }}
            >
                {filtered.map(d => (
                  <MobileCard
                    key={d.id}
                    title={d.client?.name ?? 'Customer'}
                    headerBadge={fmtDate(d.date)}
                    footer={
                      isEmployeeMode ? (
                        d.status !== 'DELIVERED' ? (
                          <button 
                            style={{
                              width: '100%',
                              padding: '12px 18px',
                              background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
                              color: '#FFFFFF',
                              fontWeight: 700,
                              borderRadius: '10px',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              fontSize: '14px',
                              boxShadow: '0 4px 12px rgba(22, 163, 74, 0.35)',
                            }} 
                            onClick={() => updateStatus(d.id, 'DELIVERED')}
                          >
                            ✅ Mark as Delivered
                          </button>
                        ) : (
                          <div style={{
                            width: '100%',
                            padding: '10px 14px',
                            background: '#DCFCE7',
                            color: '#15803D',
                            textAlign: 'center',
                            fontWeight: 700,
                            borderRadius: '8px',
                            fontSize: '13px',
                            border: '1px solid #86EFAC'
                          }}>
                            ✓ Completed & Delivered ({fmtDateTime(d.deliveredAt || d.date)})
                          </div>
                        )
                      ) : (
                        <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {d.status === 'PENDING' && (
                            <>
                              <button className="va-btn small" style={{ background: '#0284C7', color: '#FFF', fontWeight: 700, flex: 1 }} onClick={() => updateStatus(d.id, 'OUT')}>
                                🚚 Dispatch
                              </button>
                              <button className="va-btn small" style={{ background: '#16A34A', color: '#FFF', fontWeight: 700, flex: 1 }} onClick={() => updateStatus(d.id, 'DELIVERED')}>
                                ✅ Delivered
                              </button>
                            </>
                          )}
                          {d.status === 'OUT' && (
                            <>
                              <button className="va-btn small" style={{ background: '#16A34A', color: '#FFF', fontWeight: 700, flex: 1 }} onClick={() => updateStatus(d.id, 'DELIVERED')}>
                                ✅ Delivered
                              </button>
                              <button className="va-btn secondary small" style={{ color: '#DC2626', borderColor: '#FCA5A5', fontWeight: 700, flex: 1 }} onClick={() => setFailedModalDelivery(d)}>
                                ❌ Failed
                              </button>
                              {d.sale?.items && d.sale.items.length > 0 && (
                                <button className="va-btn secondary small" style={{ color: '#D97706', borderColor: '#FDE68A', fontWeight: 700, flex: 1 }} onClick={() => openReturnModal(d)}>
                                  ↩️ Return Items
                                </button>
                              )}
                            </>
                          )}
                          {d.status === 'FAILED' && (
                            <button className="va-btn secondary small" style={{ color: '#D97706', fontWeight: 700, flex: 1 }} onClick={() => updateStatus(d.id, 'RETURNED')}>
                              ↩️ Mark Returned
                            </button>
                          )}
                          {d.status === 'DELIVERED' && (
                            <span style={{ fontSize: '13px', color: '#166534', fontWeight: 700, width: '100%', textAlign: 'center', padding: '6px 0' }}>
                              ✓ Delivered ({fmtDateTime(d.deliveredAt || d.date)})
                            </span>
                          )}
                        </div>
                      )
                    }
                  >
                    <MobileCardRow label="Invoice ID" value={d.sale?.invoiceNo} isMono />
                    
                    <MobileCardRow label="Phone">
                      {d.client?.phone ? (
                        <a href={`tel:${d.client.phone}`} style={{ color: '#2563EB', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          📞 {d.client.phone}
                        </a>
                      ) : '—'}
                    </MobileCardRow>

                    <MobileCardRow label="Address" value={d.client?.address ?? '—'} />

                    <MobileCardRow label="Staff Assigned">
                      {!isEmployeeMode ? (
                        <select 
                          value={d.employee?.id ?? ''} 
                          onChange={e => assignEmployee(d.id, e.target.value)}
                          style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#F8FAFC', fontWeight: 600, color: '#0F172A' }}
                        >
                          <option value="">— Assign Staff —</option>
                          {availableStaff.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                      ) : (
                        d.employee?.name || activeEmpName
                      )}
                    </MobileCardRow>

                    <MobileCardRow label="Vehicle">
                      {!isEmployeeMode ? (
                        <select 
                          value={d.vehicle?.id ?? ''} 
                          onChange={e => assignVehicle(d.id, e.target.value)}
                          style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#F8FAFC', fontWeight: 600 }}
                        >
                          <option value="">— Vehicle —</option>
                          {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNo}</option>)}
                        </select>
                      ) : (
                        d.vehicle?.plateNo || '—'
                      )}
                    </MobileCardRow>

                    <MobileCardRow label="Time Slot" value={d.scheduledTime || 'PHASE 1 (11:00 AM - 02:00 PM)'} />

                    <MobileCardRow label="Status">
                      <MobileCardBadge
                        variant={d.status === 'DELIVERED' ? 'green' : d.status === 'OUT' ? 'blue' : d.status === 'FAILED' ? 'red' : 'yellow'}
                      >
                        {d.status === 'OUT' ? 'DISPATCHED' : d.status.replace(/_/g, ' ')}
                      </MobileCardBadge>
                    </MobileCardRow>

                    {/* Order Items Sub-Box */}
                    {d.sale?.items && d.sale.items.length > 0 && (
                      <MobileCardBox title={`Order Items (${d.sale.items.length})`}>
                        {d.sale.items.map(item => (
                          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#15803D', fontWeight: 600, margin: '4px 0' }}>
                            <span>• {item.itemName}</span>
                            <span style={{ color: '#166534', fontWeight: 700 }}>{item.qty} {item.unit}</span>
                          </div>
                        ))}
                      </MobileCardBox>
                    )}

                    {d.deliveredAt && (
                      <MobileCardRow label="Delivered At" value={fmtDateTime(d.deliveredAt)} valueColor="#166534" />
                    )}
                  </MobileCard>
                ))}
              </div>
          </div>
        )}
      </div>

      {/* ── Failed Delivery Reason Modal ── */}
      {failedModalDelivery && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: 0, fontSize: 18, color: '#991B1B', fontWeight: 800 }}>❌ Mark Delivery as Failed</h3>
            <p style={{ fontSize: 13, color: '#4B5563', margin: '8px 0 16px' }}>
              Invoice <strong>{failedModalDelivery.sale?.invoiceNo}</strong> ({failedModalDelivery.client?.name}). Marking as failed will cancel the invoice, zero customer dues, and restore stock.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Failure Reason:</label>
              <select
                value={failureReasonInput}
                onChange={e => setFailureReasonInput(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, background: '#F9FAFB' }}
              >
                <option value="Customer Refused">Customer Refused Delivery</option>
                <option value="Customer Unavailable">Customer Unavailable / Closed</option>
                <option value="Wrong Items or Quality Issue">Wrong Items / Quality Issue</option>
                <option value="Address Not Found">Address / Contact Not Found</option>
                <option value="Other">Other Reason</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="va-btn secondary"
                onClick={() => setFailedModalDelivery(null)}
                style={{ borderRadius: 8 }}
              >
                Cancel
              </button>
              <button
                className="va-btn"
                onClick={submitFailedDelivery}
                style={{ background: '#DC2626', color: '#FFF', borderRadius: 8, fontWeight: 700 }}
              >
                Confirm Failed Delivery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record Partial Returns Modal ── */}
      {returnModalDelivery && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: '#D97706', fontWeight: 800 }}>↩️ Record Returned Products</h3>
                <span style={{ fontSize: 12, color: '#6B7280' }}>Invoice #{returnModalDelivery.sale?.invoiceNo} · {returnModalDelivery.client?.name}</span>
              </div>
              <button onClick={() => setReturnModalDelivery(null)} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: '#9CA3AF' }}>✕</button>
            </div>

            <p style={{ fontSize: 12, color: '#4B5563', marginBottom: 16 }}>
              Enter the quantity returned by the customer for each product. Inventory will automatically increase and invoice dues will recalculate.
            </p>

            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F3F4F6', textTransform: 'uppercase', fontSize: 11, color: '#4B5563' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Product</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Ordered</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Rate</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: 100 }}>Returned Qty</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {returnModalDelivery.sale?.items?.map(item => {
                    const currentInput = returnInputs[item.id] || { returnedQty: item.returnedQty || 0, reason: '' };
                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                        <td style={{ padding: '10px 10px', fontWeight: 600, color: '#1F2937' }}>
                          {item.itemName}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', color: '#6B7280' }}>
                          {item.qty} {item.unit}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600 }}>
                          Rs {item.rate}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                          <input
                            type="number"
                            min={0}
                            max={item.qty}
                            step="0.1"
                            value={currentInput.returnedQty || ''}
                            onChange={e => {
                              const val = Math.min(item.qty, Math.max(0, parseFloat(e.target.value) || 0));
                              setReturnInputs(prev => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], returnedQty: val }
                              }));
                            }}
                            style={{ width: 80, padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', borderRadius: 6, fontWeight: 700, color: '#D97706' }}
                          />
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          <input
                            type="text"
                            placeholder="Reason (optional)"
                            value={currentInput.reason}
                            onChange={e => {
                              const r = e.target.value;
                              setReturnInputs(prev => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], reason: r }
                              }));
                            }}
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12 }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ background: '#FEF3C7', padding: '12px 16px', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#92400E', fontWeight: 600 }}>Return Impact:</span>
              <span style={{ fontSize: 14, color: '#B45309', fontWeight: 800 }}>
                Return Total: Rs {Object.entries(returnInputs).reduce((sum, [itemId, val]) => {
                  const item = returnModalDelivery.sale?.items?.find(i => i.id === itemId);
                  return sum + ((val.returnedQty || 0) * (item?.rate || 0));
                }, 0).toLocaleString()}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                className="va-btn secondary"
                onClick={() => setReturnModalDelivery(null)}
                style={{ borderRadius: 8 }}
              >
                Cancel
              </button>
              <button
                className="va-btn"
                onClick={submitReturnDelivery}
                style={{ background: '#D97706', color: '#FFF', borderRadius: 8, fontWeight: 700 }}
              >
                Save & Recalculate Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
