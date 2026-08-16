'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtDate, fmtDateTime, todayInputDate, dateOffset } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow, MobileCardBox, MobileCardBadge } from '@/components/ui/MobileCard';
import { ProductVisual } from '@/components/ui/ProductVisual';
import { usePreservedState } from '@/hooks/usePreservedState';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import Icon from '@mdi/react';
import {
  mdiTruckDelivery,
  mdiAccountClock,
  mdiCheckCircle,
  mdiAlertCircle,
  mdiRefresh,
  mdiMagnify,
  mdiPhone,
  mdiWhatsapp,
  mdiMapMarker,
  mdiClockOutline,
  mdiCalendar,
  mdiCar,
  mdiPackageVariant,
  mdiEyeOutline,
  mdiClose,
  mdiFilterVariant,
} from '@mdi/js';

interface DeliveryItem {
  id: string;
  itemName: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  returnedQty?: number;
  returnReason?: string | null;
  product?: {
    id?: string;
    name?: string;
    urduName?: string | null;
    imageUrl?: string | null;
    emoji?: string | null;
  } | null;
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
  client: { id: string; name: string; address?: string | null; phone?: string | null; whatsapp?: string | null };
  vehicle?: { id: string; plateNo: string; type: string } | null;
  employee?: { id: string; name: string; phone?: string | null } | null;
  scheduledTime?: string | null;
}

interface Vehicle { id: string; plateNo: string; type: string; }
interface Employee { id: string; name: string; phone?: string | null; role: string; }

const STATUS_FLOW = ['PENDING', 'OUT', 'DELIVERED', 'FAILED', 'RETURNED'];

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string; icon: string }> = {
  PENDING: { label: 'Pending', bg: '#FEF3C7', color: '#92400E', border: '#FDE68A', icon: '⏳' },
  OUT: { label: 'Dispatched', bg: '#E0F2FE', color: '#0369A1', border: '#BAE6FD', icon: '🚚' },
  DELIVERED: { label: 'Delivered', bg: '#DCFCE7', color: '#15803D', border: '#86EFAC', icon: '✅' },
  FAILED: { label: 'Failed', bg: '#FEE2E2', color: '#991B1B', border: '#FCA5A5', icon: '❌' },
  RETURNED: { label: 'Returned', bg: '#FFEDD5', color: '#9A3412', border: '#FDBA74', icon: '↩️' },
};

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

  // Modals state
  const [itemsModalDelivery, setItemsModalDelivery] = useState<Delivery | null>(null);
  const [failedModalDelivery, setFailedModalDelivery] = useState<Delivery | null>(null);
  const [failureReasonInput, setFailureReasonInput] = useState<string>('Customer Refused');

  const [returnModalDelivery, setReturnModalDelivery] = useState<Delivery | null>(null);
  const [returnInputs, setReturnInputs] = useState<Record<string, { returnedQty: number; reason: string }>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2800); };

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

  // Delivery staff list
  const deliveryStaffList = employees.filter(e => e.role === 'DELIVERY_STAFF' || e.role === 'Delivery Staff');
  const availableStaff = deliveryStaffList.length > 0 ? deliveryStaffList : employees;

  // Base list of deliveries filtered for Employee Mode vs Admin Mode
  const baseDeliveries = isEmployeeMode
    ? (selectedEmpId ? deliveries.filter(d => d.employee?.id === selectedEmpId) : deliveries)
    : deliveries;

  // Search & Filter Processing
  const filtered = useMemo(() => {
    return baseDeliveries.filter(d => {
      const matchesStatus = filterStatus === 'ALL' || d.status === filterStatus;
      const matchesEmployee = filterEmployee === 'ALL' || d.employee?.id === filterEmployee;
      const matchesDate = !filterDate || d.date.slice(0, 10) === filterDate;
      
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        d.sale?.invoiceNo?.toLowerCase().includes(q) ||
        d.client?.name?.toLowerCase().includes(q) ||
        (d.client?.phone && d.client.phone.includes(q)) ||
        (d.client?.address && d.client.address.toLowerCase().includes(q)) ||
        (d.employee?.name && d.employee.name.toLowerCase().includes(q));

      return matchesStatus && matchesEmployee && matchesDate && matchesSearch;
    });
  }, [baseDeliveries, filterStatus, filterEmployee, filterDate, searchQuery]);

  const counts = useMemo(() => {
    const acc: Record<string, number> = { ALL: baseDeliveries.length };
    STATUS_FLOW.forEach(s => {
      acc[s] = baseDeliveries.filter(d => d.status === s).length;
    });
    return acc;
  }, [baseDeliveries]);

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
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 18px', background: toast.startsWith('❌') ? '#991B1B' : '#14532D', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* ─── PAGE HEADER & MODE CONTROLS ────────────────────────────────────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '16px 20px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#166534' }}>
              <Icon path={mdiTruckDelivery} size={1.2} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
                Delivery Dispatch &amp; Tracking Register
              </h2>
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Real-time dispatch status, assigned staff, and route fulfillment</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Mode Switcher */}
            <div style={{ display: 'inline-flex', background: '#F1F5F9', padding: '3px', borderRadius: '9px', border: '1px solid #E2E8F0' }}>
              {!isDeliveryStaff && (
                <button
                  type="button"
                  onClick={() => setIsEmployeeMode(false)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '7px',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    background: !isEmployeeMode ? '#FFFFFF' : 'transparent',
                    color: !isEmployeeMode ? '#0F172A' : '#64748B',
                    boxShadow: !isEmployeeMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  🏢 Dispatch View
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsEmployeeMode(true);
                  if (availableStaff.length && !selectedEmpId) {
                    setSelectedEmpId(availableStaff[0].id);
                  }
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background: isEmployeeMode ? '#FFFFFF' : 'transparent',
                  color: isEmployeeMode ? '#0F172A' : '#64748B',
                  boxShadow: isEmployeeMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                🚚 Driver Run Card
              </button>
            </div>

            {isEmployeeMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select
                  value={selectedEmpId}
                  onChange={e => setSelectedEmpId(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '12px', fontWeight: 700, background: '#FFFFFF', color: '#0F172A' }}
                >
                  {availableStaff.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} {emp.phone ? `(${emp.phone})` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={() => load()}
              className="va-btn secondary small"
              style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              title="Refresh Delivery List"
            >
              <Icon path={mdiRefresh} size={0.7} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* ─── INTERACTIVE KPI SUMMARY CARDS ────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 16 }}>
          {[
            { key: 'ALL', label: 'All Orders', count: counts.ALL || 0, color: '#1E293B', bg: '#F8FAFC', border: '#E2E8F0', icon: '📋' },
            { key: 'PENDING', label: 'Pending', count: counts.PENDING || 0, color: '#92400E', bg: '#FEF3C7', border: '#FDE68A', icon: '⏳' },
            { key: 'OUT', label: 'Dispatched', count: counts.OUT || 0, color: '#0369A1', bg: '#E0F2FE', border: '#BAE6FD', icon: '🚚' },
            { key: 'DELIVERED', label: 'Delivered', count: counts.DELIVERED || 0, color: '#15803D', bg: '#DCFCE7', border: '#86EFAC', icon: '✅' },
            { key: 'FAILED', label: 'Failed', count: counts.FAILED || 0, color: '#991B1B', bg: '#FEE2E2', border: '#FCA5A5', icon: '❌' },
          ].map(kpi => {
            const isSelected = filterStatus === kpi.key;
            return (
              <div
                key={kpi.key}
                onClick={() => setFilterStatus(kpi.key)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  background: isSelected ? kpi.bg : '#FFFFFF',
                  border: `1.5px solid ${isSelected ? kpi.color : '#E2E8F0'}`,
                  boxShadow: isSelected ? '0 3px 8px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: isSelected ? kpi.color : '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {kpi.icon} {kpi.label}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: kpi.color, marginTop: 2, fontFamily: 'monospace' }}>
                    {kpi.count}
                  </div>
                </div>
                {isSelected && (
                  <span style={{ fontSize: 10, fontWeight: 800, background: kpi.color, color: '#FFF', padding: '2px 6px', borderRadius: 10 }}>
                    ACTIVE
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── FILTERS & SEARCH ROW ─────────────────────────────────────────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '12px 16px', marginBottom: 16, boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Search Box */}
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <Icon path={mdiMagnify} size={0.8} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search invoice, customer name, phone, or address…"
              style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '13px', background: '#F8FAFC' }}
            />
          </div>

          {/* Delivery Staff Filter */}
          {!isEmployeeMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748B' }}>Staff:</span>
              <select 
                value={filterEmployee}
                onChange={e => setFilterEmployee(e.target.value)}
                style={{ padding: '7px 12px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '12px', background: '#F8FAFC', fontWeight: 700, color: '#0F172A' }}
              >
                <option value="ALL">All Delivery Staff</option>
                {availableStaff.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date Picker & Quick Shortcuts */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748B' }}>Date:</span>
            <input 
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: '8px', fontSize: '12px', background: '#F8FAFC', fontWeight: 700, color: '#0F172A' }} 
            />
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                className="va-btn secondary small"
                style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700 }}
                onClick={() => setFilterDate(todayInputDate())}
              >
                Today
              </button>
              <button
                type="button"
                className="va-btn secondary small"
                style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700 }}
                onClick={() => setFilterDate(dateOffset(-1))}
              >
                Yesterday
              </button>
              <button
                type="button"
                className="va-btn secondary small"
                style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700 }}
                onClick={() => setFilterDate(dateOffset(1))}
              >
                Tomorrow
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── DELIVERIES CONTENT PANEL ─────────────────────────────────────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
        {loading && deliveries.length === 0 ? (
          <div style={{ padding: 24 }}><SkeletonTable rows={6} cols={7} /></div>
        ) : filtered.length === 0 ? (
          <div className="va-empty" style={{ padding: '50px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: 8 }}>📦</div>
            <div className="big" style={{ fontSize: '17px', fontWeight: 800, color: '#0F172A' }}>No deliveries found</div>
            <div style={{ color: '#64748B', fontSize: '13px', marginTop: 4 }}>
              {isEmployeeMode ? `No delivery tasks assigned for ${activeEmpName}.` : 'No delivery dispatches match the selected filters or date.'}
            </div>
            <button
              onClick={() => { setFilterStatus('ALL'); setFilterEmployee('ALL'); setSearchQuery(''); setFilterDate(todayInputDate()); }}
              className="va-btn secondary small"
              style={{ marginTop: 14, fontWeight: 700 }}
            >
              Clear Filters
            </button>
          </div>
        ) : (
          <div>
            {/* ══════════════════════════════════════════════════════════════════════ */}
            {/* DESKTOP TABLE VIEW (Admin Dispatch Mode)                                */}
            {/* ══════════════════════════════════════════════════════════════════════ */}
            {!isEmployeeMode && (
              <div className="hide-mobile">
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', minWidth: 1080, borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800 }}>
                        <th style={{ padding: '12px 16px', minWidth: 130 }}>Invoice</th>
                        <th style={{ padding: '12px 16px', minWidth: 170 }}>Client &amp; Contact</th>
                        <th style={{ padding: '12px 16px', minWidth: 160 }}>Delivery Address</th>
                        <th style={{ padding: '12px 16px', minWidth: 150 }}>Staff Assigned</th>
                        <th style={{ padding: '12px 16px', minWidth: 120 }}>Vehicle</th>
                        <th style={{ padding: '12px 16px', minWidth: 140 }}>Schedule</th>
                        <th style={{ padding: '12px 16px', minWidth: 150 }}>Order Items</th>
                        <th style={{ padding: '12px 16px', minWidth: 110, textAlign: 'center' }}>Status</th>
                        <th style={{ padding: '12px 16px', minWidth: 170, textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(d => {
                        const st = STATUS_CONFIG[d.status] || STATUS_CONFIG.PENDING;
                        const itemsCount = d.sale?.items?.length || 0;
                        const phone = d.client?.phone || d.client?.whatsapp || '';

                        return (
                          <tr key={d.id} style={{ borderBottom: '1px solid #F1F5F9', transition: 'background 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'} onMouseLeave={e => e.currentTarget.style.background = '#FFFFFF'}>
                            {/* Invoice No & Date */}
                            <td style={{ padding: '12px 16px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'inline-block', background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0', padding: '3px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '12px', fontFamily: 'monospace' }}>
                                #{d.sale?.invoiceNo}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Icon path={mdiCalendar} size={0.55} color="#94A3B8" />
                                <span>{fmtDate(d.date)}</span>
                              </div>
                            </td>

                            {/* Client & Phone with Call / WhatsApp */}
                            <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                              <div style={{ fontWeight: 800, color: '#0F172A', fontSize: '13px' }}>
                                {d.client?.name}
                              </div>
                              {phone ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                                  <a
                                    href={`tel:${phone}`}
                                    style={{ fontSize: '11px', color: '#2563EB', textDecoration: 'none', fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                    title="Call client"
                                  >
                                    <Icon path={mdiPhone} size={0.55} />
                                    <span>{phone}</span>
                                  </a>
                                  <a
                                    href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#16A34A', display: 'inline-flex', alignItems: 'center' }}
                                    title="Chat on WhatsApp"
                                  >
                                    <Icon path={mdiWhatsapp} size={0.65} />
                                  </a>
                                </div>
                              ) : (
                                <span style={{ fontSize: '11px', color: '#94A3B8' }}>No contact</span>
                              )}
                            </td>

                            {/* Address */}
                            <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, maxWidth: 170, color: '#334155', fontSize: '12px' }}>
                                <Icon path={mdiMapMarker} size={0.65} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', lineHeight: '1.3' }}>
                                  {d.client?.address || '—'}
                                </span>
                              </div>
                            </td>

                            {/* Staff Assigned */}
                            <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                              <select 
                                value={d.employee?.id ?? ''} 
                                onChange={e => assignEmployee(d.id, e.target.value)}
                                style={{
                                  fontSize: '12px',
                                  padding: '5px 8px',
                                  border: `1px solid ${d.employee?.id ? '#CBD5E1' : '#FCD34D'}`,
                                  borderRadius: '6px',
                                  background: d.employee?.id ? '#FFFFFF' : '#FFFBEB',
                                  fontWeight: 700,
                                  color: d.employee?.id ? '#0F172A' : '#B45309',
                                  cursor: 'pointer',
                                  width: '100%',
                                }}
                              >
                                <option value="">— Unassigned —</option>
                                {availableStaff.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                              </select>
                            </td>

                            {/* Vehicle */}
                            <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                              <select 
                                value={d.vehicle?.id ?? ''} 
                                onChange={e => assignVehicle(d.id, e.target.value)}
                                style={{
                                  fontSize: '12px',
                                  padding: '5px 8px',
                                  border: '1px solid #CBD5E1',
                                  borderRadius: '6px',
                                  background: '#FFFFFF',
                                  fontWeight: 600,
                                  color: '#0F172A',
                                  cursor: 'pointer',
                                  width: '100%',
                                }}
                              >
                                <option value="">— Vehicle —</option>
                                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNo}</option>)}
                              </select>
                            </td>

                            {/* Schedule & Slot */}
                            <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#EFF6FF', color: '#1E40AF', padding: '2px 6px', borderRadius: 4, fontSize: '11px', fontWeight: 700, border: '1px solid #DBEAFE' }}>
                                <Icon path={mdiClockOutline} size={0.5} />
                                <span>{d.scheduledTime ? d.scheduledTime.split('(')[0].trim() : 'Phase 1'}</span>
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <input 
                                  type="date" 
                                  value={d.date.slice(0, 10)} 
                                  onChange={e => assignDate(d.id, e.target.value)}
                                  style={{ fontSize: '11px', padding: '2px 4px', border: '1px solid #CBD5E1', borderRadius: '4px', background: '#FFFFFF' }} 
                                />
                              </div>
                            </td>

                            {/* Order Items Preview Badge */}
                            <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                              {itemsCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setItemsModalDelivery(d)}
                                  style={{
                                    background: '#F0FDF4',
                                    border: '1px solid #BBF7D0',
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    width: '100%',
                                    maxWidth: 155,
                                    transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = '#DCFCE7'}
                                  onMouseLeave={e => e.currentTarget.style.background = '#F0FDF4'}
                                  title="Click to view item details"
                                >
                                  <div style={{ fontSize: '11px', color: '#166534', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>📦 {itemsCount} {itemsCount === 1 ? 'item' : 'items'}</span>
                                    <Icon path={mdiEyeOutline} size={0.55} />
                                  </div>
                                  <div style={{ fontSize: '10px', color: '#15803D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                                    {d.sale.items?.map(i => i.itemName).slice(0, 3).join(', ')}
                                  </div>
                                </button>
                              ) : (
                                <span style={{ fontSize: '11px', color: '#94A3B8' }}>—</span>
                              )}
                            </td>

                            {/* Status Badge */}
                            <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: '11px',
                                fontWeight: 800,
                                padding: '4px 10px',
                                borderRadius: '12px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.02em',
                                background: st.bg,
                                color: st.color,
                                border: `1px solid ${st.border}`,
                                whiteSpace: 'nowrap',
                              }}>
                                <span>{st.icon}</span>
                                <span>{st.label}</span>
                              </span>
                            </td>

                            {/* Actions Buttons */}
                            <td style={{ textAlign: 'right', padding: '12px 16px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                {d.status === 'PENDING' && (
                                  <>
                                    <button
                                      type="button"
                                      className="va-btn small"
                                      style={{ background: '#0284C7', color: '#FFF', fontWeight: 700, padding: '5px 10px', borderRadius: '6px', fontSize: '12px' }}
                                      onClick={() => updateStatus(d.id, 'OUT')}
                                    >
                                      🚚 Dispatch
                                    </button>
                                    <button
                                      type="button"
                                      className="va-btn small"
                                      style={{ background: '#16A34A', color: '#FFF', fontWeight: 700, padding: '5px 10px', borderRadius: '6px', fontSize: '12px' }}
                                      onClick={() => updateStatus(d.id, 'DELIVERED')}
                                    >
                                      ✅ Delivered
                                    </button>
                                  </>
                                )}

                                {d.status === 'OUT' && (
                                  <>
                                    <button
                                      type="button"
                                      className="va-btn small"
                                      style={{ background: '#16A34A', color: '#FFF', fontWeight: 700, padding: '5px 10px', borderRadius: '6px', fontSize: '12px' }}
                                      onClick={() => updateStatus(d.id, 'DELIVERED')}
                                    >
                                      ✅ Delivered
                                    </button>
                                    <button
                                      type="button"
                                      className="va-btn secondary small"
                                      style={{ color: '#DC2626', borderColor: '#FCA5A5', fontWeight: 700, padding: '5px 8px', borderRadius: '6px', fontSize: '12px' }}
                                      onClick={() => setFailedModalDelivery(d)}
                                    >
                                      ❌ Failed
                                    </button>
                                    {itemsCount > 0 && (
                                      <button
                                        type="button"
                                        className="va-btn secondary small"
                                        style={{ color: '#D97706', borderColor: '#FDE68A', fontWeight: 700, padding: '5px 8px', borderRadius: '6px', fontSize: '12px' }}
                                        onClick={() => openReturnModal(d)}
                                      >
                                        ↩️ Return
                                      </button>
                                    )}
                                  </>
                                )}

                                {d.status === 'FAILED' && (
                                  <button
                                    type="button"
                                    className="va-btn secondary small"
                                    style={{ color: '#D97706', borderColor: '#FDE68A', fontWeight: 700, fontSize: '12px' }}
                                    onClick={() => updateStatus(d.id, 'RETURNED')}
                                  >
                                    ↩️ Restock
                                  </button>
                                )}

                                {d.status === 'DELIVERED' && (
                                  <span style={{ fontSize: '12px', color: '#166534', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <Icon path={mdiCheckCircle} size={0.65} />
                                    <span>Completed</span>
                                  </span>
                                )}

                                {d.status === 'RETURNED' && (
                                  <span style={{ fontSize: '11px', color: '#9A3412', fontWeight: 700 }}>
                                    ✓ Returned
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '12px 18px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748B' }}>
                  <span>Showing <strong>{filtered.length}</strong> of {baseDeliveries.length} total deliveries</span>
                  <span>Click <strong>Order Items</strong> to inspect full product list</span>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════════════ */}
            {/* RESPONSIVE MOBILE & DRIVER RUN CARD VIEW                               */}
            {/* ══════════════════════════════════════════════════════════════════════ */}
            <div 
              className={isEmployeeMode ? '' : 'show-mobile'}
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '14px', 
                width: '100%',
                padding: '14px',
              }}
            >
              {filtered.map(d => {
                const st = STATUS_CONFIG[d.status] || STATUS_CONFIG.PENDING;
                const phone = d.client?.phone || d.client?.whatsapp || '';

                return (
                  <MobileCard
                    key={d.id}
                    title={d.client?.name ?? 'Customer'}
                    headerBadge={`#${d.sale?.invoiceNo}`}
                    footer={
                      isEmployeeMode ? (
                        d.status !== 'DELIVERED' ? (
                          <button 
                            type="button"
                            style={{
                              width: '100%',
                              padding: '12px 18px',
                              background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
                              color: '#FFFFFF',
                              fontWeight: 800,
                              borderRadius: '10px',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              fontSize: '14px',
                              boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
                            }} 
                            onClick={() => updateStatus(d.id, 'DELIVERED')}
                          >
                            <Icon path={mdiCheckCircle} size={0.8} />
                            <span>Mark as Delivered ✓</span>
                          </button>
                        ) : (
                          <div style={{
                            width: '100%',
                            padding: '10px 14px',
                            background: '#DCFCE7',
                            color: '#15803D',
                            textAlign: 'center',
                            fontWeight: 800,
                            borderRadius: '8px',
                            fontSize: '13px',
                            border: '1px solid #86EFAC',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                          }}>
                            <Icon path={mdiCheckCircle} size={0.7} />
                            <span>Completed &amp; Delivered ({fmtDateTime(d.deliveredAt || d.date)})</span>
                          </div>
                        )
                      ) : (
                        <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {d.status === 'PENDING' && (
                            <>
                              <button
                                type="button"
                                className="va-btn small"
                                style={{ background: '#0284C7', color: '#FFF', fontWeight: 800, flex: 1, padding: '10px' }}
                                onClick={() => updateStatus(d.id, 'OUT')}
                              >
                                🚚 Dispatch
                              </button>
                              <button
                                type="button"
                                className="va-btn small"
                                style={{ background: '#16A34A', color: '#FFF', fontWeight: 800, flex: 1, padding: '10px' }}
                                onClick={() => updateStatus(d.id, 'DELIVERED')}
                              >
                                ✅ Delivered
                              </button>
                            </>
                          )}
                          {d.status === 'OUT' && (
                            <>
                              <button
                                type="button"
                                className="va-btn small"
                                style={{ background: '#16A34A', color: '#FFF', fontWeight: 800, flex: 1, padding: '10px' }}
                                onClick={() => updateStatus(d.id, 'DELIVERED')}
                              >
                                ✅ Delivered
                              </button>
                              <button
                                type="button"
                                className="va-btn secondary small"
                                style={{ color: '#DC2626', borderColor: '#FCA5A5', fontWeight: 800, flex: 1, padding: '10px' }}
                                onClick={() => setFailedModalDelivery(d)}
                              >
                                ❌ Failed
                              </button>
                              {d.sale?.items && d.sale.items.length > 0 && (
                                <button
                                  type="button"
                                  className="va-btn secondary small"
                                  style={{ color: '#D97706', borderColor: '#FDE68A', fontWeight: 800, flex: 1, padding: '10px' }}
                                  onClick={() => openReturnModal(d)}
                                >
                                  ↩️ Return
                                </button>
                              )}
                            </>
                          )}
                          {d.status === 'FAILED' && (
                            <button
                              type="button"
                              className="va-btn secondary small"
                              style={{ color: '#D97706', fontWeight: 800, flex: 1, padding: '10px' }}
                              onClick={() => updateStatus(d.id, 'RETURNED')}
                            >
                              ↩️ Mark Returned
                            </button>
                          )}
                          {d.status === 'DELIVERED' && (
                            <span style={{ fontSize: '13px', color: '#166534', fontWeight: 800, width: '100%', textAlign: 'center', padding: '8px 0', background: '#F0FDF4', borderRadius: '8px' }}>
                              ✓ Delivered ({fmtDateTime(d.deliveredAt || d.date)})
                            </span>
                          )}
                        </div>
                      )
                    }
                  >
                    {/* Quick Call & WhatsApp Buttons */}
                    {phone && (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <a
                          href={`tel:${phone}`}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: '#EFF6FF',
                            border: '1px solid #BFDBFE',
                            borderRadius: '8px',
                            color: '#1D4ED8',
                            textDecoration: 'none',
                            fontWeight: 700,
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                          }}
                        >
                          <Icon path={mdiPhone} size={0.65} />
                          <span>Call ({phone})</span>
                        </a>
                        <a
                          href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: '#F0FDF4',
                            border: '1px solid #BBF7D0',
                            borderRadius: '8px',
                            color: '#15803D',
                            textDecoration: 'none',
                            fontWeight: 700,
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                          }}
                        >
                          <Icon path={mdiWhatsapp} size={0.65} />
                          <span>WhatsApp</span>
                        </a>
                      </div>
                    )}

                    <MobileCardRow label="Address" value={d.client?.address ?? '—'} />

                    <MobileCardRow label="Staff Assigned">
                      {!isEmployeeMode ? (
                        <select 
                          value={d.employee?.id ?? ''} 
                          onChange={e => assignEmployee(d.id, e.target.value)}
                          style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid #CBD5E1', borderRadius: '6px', background: '#F8FAFC', fontWeight: 700, color: '#0F172A' }}
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

                    <MobileCardRow label="Time Slot" value={d.scheduledTime ? d.scheduledTime.split('(')[0] : 'PHASE 1 (11:00 AM - 02:00 PM)'} />

                    <MobileCardRow label="Status">
                      <MobileCardBadge
                        variant={d.status === 'DELIVERED' ? 'green' : d.status === 'OUT' ? 'blue' : d.status === 'FAILED' ? 'red' : 'yellow'}
                      >
                        {st.icon} {st.label}
                      </MobileCardBadge>
                    </MobileCardRow>

                    {/* Order Items Sub-Box */}
                    {d.sale?.items && d.sale.items.length > 0 && (
                      <MobileCardBox title={`Order Items (${d.sale.items.length})`}>
                        {d.sale.items.map(item => (
                          <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: '#15803D', fontWeight: 600, margin: '6px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <ProductVisual
                                name={item.itemName}
                                emoji={(item as any).product?.emoji}
                                imageUrl={(item as any).product?.imageUrl}
                                size={20}
                              />
                              <span style={{ color: '#0F172A' }}>{item.itemName}</span>
                            </div>
                            <span style={{ color: '#166534', fontWeight: 800, fontFamily: 'monospace' }}>{item.qty} {item.unit}</span>
                          </div>
                        ))}
                      </MobileCardBox>
                    )}

                    {d.deliveredAt && (
                      <MobileCardRow label="Delivered At" value={fmtDateTime(d.deliveredAt)} valueColor="#166534" />
                    )}
                  </MobileCard>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: ORDER ITEMS DETAIL POPUP                                          */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {itemsModalDelivery && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 540, maxHeight: '85vh', overflowY: 'auto', padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2E8F0', paddingBottom: 12, marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, color: '#0F172A', fontWeight: 800 }}>
                  📦 Invoice #{itemsModalDelivery.sale?.invoiceNo} Items
                </h3>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                  Customer: <strong>{itemsModalDelivery.client?.name}</strong> · Total: <strong>Rs {itemsModalDelivery.sale?.total?.toLocaleString()}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setItemsModalDelivery(null)}
                style={{ border: 'none', background: '#F1F5F9', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}
              >
                <Icon path={mdiClose} size={0.7} />
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', color: '#64748B', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Item</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Rate</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {itemsModalDelivery.sale?.items?.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '10px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ProductVisual
                          name={item.itemName}
                          emoji={(item as any).product?.emoji}
                          imageUrl={(item as any).product?.imageUrl}
                          size={22}
                        />
                        <div>
                          <div style={{ fontWeight: 700, color: '#0F172A' }}>{item.itemName}</div>
                          {(item as any).product?.urduName && (
                            <div style={{ fontSize: '11px', color: '#64748B', fontFamily: 'serif' }}>
                              {(item as any).product.urduName}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="mono" style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700 }}>
                      {item.qty} {item.unit}
                    </td>
                    <td className="mono" style={{ padding: '10px 10px', textAlign: 'right', color: '#64748B' }}>
                      Rs {item.rate}
                    </td>
                    <td className="mono" style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, color: '#15803D' }}>
                      Rs {item.amount?.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="va-btn secondary"
                onClick={() => setItemsModalDelivery(null)}
                style={{ borderRadius: 8, fontWeight: 700 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: FAILED DELIVERY REASON                                            */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {failedModalDelivery && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#991B1B', marginBottom: 12 }}>
              <Icon path={mdiAlertCircle} size={1} />
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Mark Delivery as Failed</h3>
            </div>
            <p style={{ fontSize: 13, color: '#4B5563', margin: '0 0 16px', lineHeight: '1.4' }}>
              Invoice <strong>#{failedModalDelivery.sale?.invoiceNo}</strong> ({failedModalDelivery.client?.name}). Marking as failed will cancel the invoice, reverse client dues, and return all products to inventory.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Failure Reason:</label>
              <select
                value={failureReasonInput}
                onChange={e => setFailureReasonInput(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, background: '#F9FAFB', fontWeight: 600 }}
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
                type="button"
                className="va-btn secondary"
                onClick={() => setFailedModalDelivery(null)}
                style={{ borderRadius: 8 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="va-btn"
                onClick={submitFailedDelivery}
                style={{ background: '#DC2626', color: '#FFF', borderRadius: 8, fontWeight: 800 }}
              >
                Confirm Failed Delivery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: RECORD RETURNED PRODUCTS                                          */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {returnModalDelivery && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: '#D97706', fontWeight: 800 }}>↩️ Record Returned Products</h3>
                <span style={{ fontSize: 12, color: '#6B7280' }}>Invoice #{returnModalDelivery.sale?.invoiceNo} · {returnModalDelivery.client?.name}</span>
              </div>
              <button type="button" onClick={() => setReturnModalDelivery(null)} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: '#9CA3AF' }}>✕</button>
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
                        <td style={{ padding: '10px 10px', fontWeight: 700, color: '#1F2937' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ProductVisual
                              name={item.itemName}
                              emoji={(item as any).product?.emoji}
                              imageUrl={(item as any).product?.imageUrl}
                              size={20}
                            />
                            <span>{item.itemName}</span>
                          </div>
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
                            step="any"
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
              <span style={{ fontSize: 13, color: '#92400E', fontWeight: 700 }}>Return Impact:</span>
              <span style={{ fontSize: 14, color: '#B45309', fontWeight: 800 }}>
                Return Total: Rs {Object.entries(returnInputs).reduce((sum, [itemId, val]) => {
                  const item = returnModalDelivery.sale?.items?.find(i => i.id === itemId);
                  return sum + ((val.returnedQty || 0) * (item?.rate || 0));
                }, 0).toLocaleString()}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="va-btn secondary"
                onClick={() => setReturnModalDelivery(null)}
                style={{ borderRadius: 8 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="va-btn"
                onClick={submitReturnDelivery}
                disabled={isSubmittingReturn}
                style={{ background: '#D97706', color: '#FFF', borderRadius: 8, fontWeight: 800 }}
              >
                {isSubmittingReturn ? 'Processing…' : 'Save & Recalculate Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
