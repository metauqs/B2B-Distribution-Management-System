'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDateTime, todayInputDate, todayInputDateTime, dateOffset } from '@/utils/formatters';
import { getTodayBusinessDateString } from '@/utils/businessDate';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow, MobileCardBox, MobileCardBadge } from '@/components/ui/MobileCard';
import Icon from '@mdi/react';
import {
  mdiCashRegister,
  mdiReceiptTextOutline,
  mdiCalendarClock,
  mdiCash,
  mdiBank,
  mdiAccountCheck,
  mdiMagnify,
  mdiRefresh,
  mdiEyeOutline,
  mdiDownload,
  mdiPlus,
  mdiChevronDown,
  mdiChevronUp,
  mdiCheckCircle,
  mdiAlertCircle,
  mdiPhone,
  mdiWhatsapp,
} from '@mdi/js';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';

import { loadBrandConfigWithLogo, generateDailyPaymentHistoryHTML, generateTemplateJpgBase64, downloadImage } from '@/utils/documentTemplates';

const DueStatementModal = dynamic(() => import('@/components/modals/DueStatementModal').then(m => m.DueStatementModal), { ssr: false });
const CollectionReceiptModal = dynamic(() => import('@/components/modals/CollectionReceiptModal').then(m => m.CollectionReceiptModal), { ssr: false });
const DailyPaymentHistoryPreviewModal = dynamic(() => import('@/components/modals/DailyPaymentHistoryPreviewModal').then(m => m.DailyPaymentHistoryPreviewModal), { ssr: false });

interface Sale {
  id: string;
  invoiceNo: string;
  clientId: string;
  date: string;
  total: number;
  paid: number;
  balance: number;
  paymentMode: string;
  status: string;
  client?: { id: string; name: string } | null;
}

interface Collection {
  id: string;
  amount: number;
  date: string;
  method: string;
  reference?: string | null;
  notes?: string | null;
  clientId: string;
  remainingBalance?: number | null;
  runningBalance?: number | null;
  receivedByUserId?: string | null;
  receivedByUser?: { id: string; name: string; role?: string } | null;
  allocations?: Array<{ saleId: string; allocatedAmount: number; sale?: { invoiceNo: string } }>;
}

interface Client {
  id: string;
  clientId?: string | null;
  name: string;
  currentBalance: number;
  openingBalance: number;
  phone?: string | null;
  whatsapp?: string | null;
}

const BLANK_FORM = { clientId: '', saleId: '', amount: 0, date: '', method: 'CASH', reference: '', notes: '' };

export default function CollectionsPage() {
  const [sales,       setSales]       = useState<Sale[]>(() => {
    return getCachedData<Sale[]>('/api/sales') || [];
  });
  const [collections, setCollections] = useState<Collection[]>(() => {
    return getCachedData<Collection[]>('/api/collections') || [];
  });
  const [clients,     setClients]     = useState<Client[]>(() => {
    return getCachedData<Client[]>('/api/clients?minimal=true') || [];
  });
  const [loading,     setLoading]     = useState(() => {
    return !getCachedData<Collection[]>('/api/collections');
  });
  const [toast,       setToast]       = useState('');
  const [view,        setView]        = useState<'list' | 'add'>('list');
  const [form,        setForm]        = useState({ ...BLANK_FORM });
  const [expandedClients, setExpandedClients] = useState<{ [key: string]: boolean }>({});
  const [showAllHistory, setExpandedShowAllHistory] = useState<{ [key: string]: boolean }>({});
  const toggleShowAllHistory = (cid: string) => {
    setExpandedShowAllHistory(prev => ({ ...prev, [cid]: !prev[cid] }));
  };

  const [activeTab,    setActiveTab]   = useState<'registry' | 'daily_history'>('registry');
  const [dailyDate,    setDailyDate]    = useState<string>(() => todayInputDate());
  const [dailyEmployee, setDailyEmployee] = useState<string>('all');
  const [dailyMethod,  setDailyMethod]  = useState<string>('all');
  const [dailySearch,  setDailySearch]  = useState<string>('');
  const [dailyData,    setDailyData]    = useState<any | null>(() => {
    return getCachedData<any>(`/api/collections/daily-history?date=${todayInputDate()}`) || null;
  });
  const [loadingDaily, setLoadingDaily] = useState<boolean>(() => {
    return !getCachedData<any>(`/api/collections/daily-history?date=${todayInputDate()}`);
  });
  const [dailyPreviewModal, setDailyPreviewModal] = useState<any | null>(null);

  // ── Receipt Modal & Due Statement Modal state ──
  const [receiptModal, setReceiptModal] = useState<any | null>(null);
  const [statementClient, setStatementClient] = useState<any | null>(null);
  const [statementInvoices, setStatementInvoices] = useState<any[]>([]);
  const [statementMode, setStatementMode] = useState<'view' | 'share'>('view');

  const loadDailyHistory = useCallback(async (dateVal?: string, empVal?: string, methodVal?: string, searchVal?: string, isBackground = false) => {
    const targetDate = dateVal !== undefined ? dateVal : dailyDate;
    const targetEmp = empVal !== undefined ? empVal : dailyEmployee;
    const targetMethod = methodVal !== undefined ? methodVal : dailyMethod;
    const targetSearch = searchVal !== undefined ? searchVal : dailySearch;

    const params = new URLSearchParams();
    if (targetDate) params.append('date', targetDate);
    if (targetEmp && targetEmp !== 'all') params.append('employeeId', targetEmp);
    if (targetMethod && targetMethod !== 'all') params.append('method', targetMethod);
    if (targetSearch) params.append('search', targetSearch);

    const key = `/api/collections/daily-history?${params.toString()}`;
    if (!isBackground && !getCachedData(key)) setLoadingDaily(true);
    try {
      const data = await fetchWithCache<any>(key, { ttl: TTL_SHORT, forceRefresh: isBackground });
      if (data) {
        setDailyData(data);
      }
    } catch (err) {
      console.error('loadDailyHistory error:', err);
    } finally {
      setLoadingDaily(false);
    }
  }, [dailyDate, dailyEmployee, dailyMethod, dailySearch]);

  const handleViewDues = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    const clientSales = sales.filter(s => s.clientId === clientId && s.balance > 0 && s.status !== 'CANCELLED');
    setStatementClient(client);
    setStatementInvoices(clientSales.map(s => ({
      invoiceNo: s.invoiceNo,
      date: s.date,
      total: s.total,
      paid: s.paid,
      balance: s.balance,
      status: s.status
    })));
    setStatementMode('view');
  };

  const handleSendDueStatement = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    const clientSales = sales.filter(s => s.clientId === clientId && s.balance > 0 && s.status !== 'CANCELLED');
    setStatementClient(client);
    setStatementInvoices(clientSales.map(s => ({
      invoiceNo: s.invoiceNo,
      date: s.date,
      total: s.total,
      paid: s.paid,
      balance: s.balance,
      status: s.status
    })));
    setStatementMode('share');
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && collections.length === 0) setLoading(true);
    try {
      const [sData, cData, clData] = await Promise.all([
        fetchWithCache<Sale[]>('/api/sales', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<Collection[]>('/api/collections', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<Client[]>('/api/clients?minimal=true', { ttl: TTL_MEDIUM, forceRefresh: isBackground }),
      ]);
      if (sData) setSales(sData);
      if (cData) setCollections(cData);
      if (clData) setClients(clData);
    } catch {
      showToast('❌ Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, [collections.length]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (activeTab === 'daily_history') {
      loadDailyHistory();
    }
  }, [activeTab, loadDailyHistory]);

  useEffect(() => {
    const handleRevalidate = () => {
      load(true);
      if (activeTab === 'daily_history') loadDailyHistory();
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [load, activeTab, loadDailyHistory]);

  const { isSubmitting: saving, submit: executeSave } = useIdempotentSubmit({
    onSubmit: async (e: React.FormEvent, idempotencyKey: string) => {
      e.preventDefault();
      const selectedClient = clients.find(c => c.id === form.clientId);
      const totalOutstanding = Math.max(0, selectedClient?.currentBalance ?? 0);
      const targetSale = form.saleId ? sales.find(s => s.id === form.saleId) : null;
      const maxAllowed = targetSale ? Math.min(totalOutstanding, targetSale.balance) : totalOutstanding;
      const amt = Number(form.amount);

      if (isNaN(amt) || amt <= 0) {
        showToast('❌ Amount must be greater than 0');
        return;
      }
      if (amt > maxAllowed + 0.001) {
        showToast(`❌ Cannot collect ${fmtMoney(amt)}. Max allowed: ${fmtMoney(maxAllowed)}`);
        return;
      }

      showToast('⏳ Recording payment...');

      const payload: any = {
        amount: amt,
        date: form.date || todayInputDateTime(),
        method: form.method,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
      };

      if (form.saleId) {
        payload.saleId = form.saleId;
      } else if (form.clientId) {
        payload.clientId = form.clientId;
      }

      try {
        const res = await apiFetch('/api/collections', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          invalidateCache('/api/collections');
          invalidateCache('/api/sales');
          invalidateCache('/api/clients');
          invalidateCache('/api/reports');
          window.dispatchEvent(new Event('app-revalidate'));
          showToast('✅ Payment recorded successfully');
          setForm({ ...BLANK_FORM });
          setView('list');
          await load(true);
          if (activeTab === 'daily_history') await loadDailyHistory();

          if (data.collection) {
            setReceiptModal({
              receiptNo: data.collection.reference || `PAY-${data.collection.id.slice(-6).toUpperCase()}`,
              collectionId: data.collection.id,
              date: data.collection.date,
              amount: data.collection.amount,
              method: data.collection.method,
              reference: data.collection.reference,
              notes: data.collection.notes,
              clientName: selectedClient?.name || 'Customer',
              clientNo: selectedClient?.clientId || 'WH-0000',
              previousBalance: totalOutstanding,
              collectedAmount: data.collection.amount,
              remainingBalance: Math.max(0, totalOutstanding - data.collection.amount),
              allocations: data.collection.allocations || [],
              receivedBy: data.collection.receivedByUser?.name || 'System Admin',
            });
          }
        } else {
          showToast(`❌ Error: ${data.error || 'Failed to record payment'}`);
        }
      } catch {
        showToast('❌ Network error recording payment');
      }
    },
    onError: () => {
      showToast('❌ Network error recording payment');
    }
  });

  const handleSave = (e: React.FormEvent) => executeSave(e);

  const toggleExpand = (clientId: string) => {
    setExpandedClients(p => ({ ...p, [clientId]: !p[clientId] }));
  };

  const openRecordPaymentForClient = (clientId: string) => {
    setForm({
      ...BLANK_FORM,
      clientId,
      saleId: '',
      date: todayInputDateTime(),
    });
    setView('add');
  };

  const clientInvoices = form.clientId
    ? sales.filter(s => s.clientId === form.clientId && s.balance > 0 && s.status !== 'CANCELLED')
    : [];

  // Group sales by client for Registry view
  const groupedList = useMemo(() => {
    const groupedSales = clients.reduce((acc: { [key: string]: {
      clientId: string;
      clientNo: string;
      clientName: string;
      phone?: string | null;
      whatsapp?: string | null;
      authoritativeOutstanding: number;
      initialOpening: number;
      openingDue: number;
      hasOpeningDue: boolean;
      hasAuthDebt: boolean;
      hasInvoiceDue: boolean;
      invoiceDue: number;
      items: any[];
    } }, client) => {
      const clientSales = sales.filter(s => s.clientId === client.id && s.status !== 'CANCELLED');
      const authTotal = Math.max(0, client.currentBalance ?? 0);
      if (clientSales.length === 0 && authTotal < 0.99) return acc;

      const sortedSales = [...clientSales].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const items = sortedSales.map(sale => {
        const isCancelled = sale.status === 'CANCELLED';
        const isPaid = !isCancelled && (sale.status === 'PAID' || (sale.balance !== undefined && sale.balance < 0.99));
        const isPartial = !isCancelled && !isPaid && sale.paid > 0;
        const status = isCancelled ? 'CANCELLED' : isPaid ? 'PAID' : isPartial ? 'PARTIALLY PAID' : 'UNPAID';
        const remaining = isPaid || isCancelled ? 0 : Math.max(0, sale.balance);

        return {
          id: sale.id,
          invoiceNo: sale.invoiceNo,
          date: sale.date,
          paymentMode: sale.paymentMode,
          total: sale.total,
          paid: sale.paid,
          remaining,
          status,
        };
      });

      const initialOpening = Math.max(0, client.openingBalance ?? 0);
      const invoiceDue = items.filter(i => i.status !== 'PAID').reduce((sum, i) => sum + i.remaining, 0);
      const openingDue = initialOpening > 0 
        ? Math.min(initialOpening, Math.max(0, Math.round((authTotal - invoiceDue) * 100) / 100))
        : 0;
      const hasOpeningDue = openingDue >= 0.99;
      const hasAuthDebt = authTotal >= 0.99;
      const hasInvoiceDue = invoiceDue >= 0.99;

      acc[client.id] = {
        clientId: client.id,
        clientNo: client.clientId || 'WH-0000',
        clientName: client.name,
        phone: client.phone,
        whatsapp: client.whatsapp,
        authoritativeOutstanding: authTotal,
        initialOpening,
        openingDue,
        hasOpeningDue,
        hasAuthDebt,
        hasInvoiceDue,
        invoiceDue,
        items
      };

      return acc;
    }, {});

    return Object.values(groupedSales).filter(g => g.items.length > 0 || g.hasAuthDebt);
  }, [clients, sales]);

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 18px', background: toast.startsWith('❌') ? '#991B1B' : '#14532D', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* ─── HEADER PANEL & SUB-TABS ────────────────────────────────────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '16px 20px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#166534' }}>
              <Icon path={mdiCashRegister} size={1.2} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
                Collections &amp; Receivables
              </h2>
              <p style={{ color: '#64748B', fontSize: 12, margin: '2px 0 0 0' }}>
                Outstanding invoice collections, cash tracking, and payment matching
              </p>
            </div>
          </div>

          {view === 'list' ? (
            <button
              type="button"
              className="va-btn"
              onClick={() => { setForm({ ...BLANK_FORM, date: todayInputDateTime() }); setView('add'); }}
              style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: '8px' }}
            >
              <Icon path={mdiPlus} size={0.75} />
              <span>Record Payment</span>
            </button>
          ) : (
            <button
              type="button"
              className="va-btn secondary small"
              onClick={() => setView('list')}
              style={{ fontWeight: 700 }}
            >
              ← Back to List
            </button>
          )}
        </div>

        {/* Navigation Sub-Tabs */}
        {view === 'list' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, borderTop: '1px solid #F1F5F9', paddingTop: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <button
              type="button"
              className={`va-btn ${activeTab === 'registry' ? '' : 'secondary'} small`}
              style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: '8px', whiteSpace: 'nowrap', padding: '8px 14px' }}
              onClick={() => setActiveTab('registry')}
            >
              <Icon path={mdiReceiptTextOutline} size={0.65} />
              <span>Invoice Registry &amp; Dues</span>
            </button>
            <button
              type="button"
              className={`va-btn ${activeTab === 'daily_history' ? '' : 'secondary'} small`}
              style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: '8px', whiteSpace: 'nowrap', padding: '8px 14px' }}
              onClick={() => { setActiveTab('daily_history'); loadDailyHistory(); }}
            >
              <Icon path={mdiCalendarClock} size={0.65} />
              <span>Daily Payment History</span>
            </button>
          </div>
        )}
      </div>

      {/* ─── ADD PAYMENT VIEW ────────────────────────────────────────────────── */}
      {view === 'add' && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', maxWidth: 680, margin: '0 auto', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
          <div style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>💵 New Payment Received</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
              Allocate client payment across opening balances and unpaid invoices via FIFO.
            </p>
          </div>

          {(() => {
            const selectedC = clients.find(c => c.id === form.clientId);
            const totalOutstanding = Math.max(0, selectedC?.currentBalance ?? 0);
            const targetSale = form.saleId ? sales.find(s => s.id === form.saleId) : null;
            const maxAllowed = targetSale ? Math.min(totalOutstanding, targetSale.balance) : totalOutstanding;
            const amtRec = Number(form.amount || 0);
            const isOverpayment = form.clientId ? (amtRec > maxAllowed + 0.001) : false;
            const isInvalidAmount = isNaN(amtRec) || amtRec <= 0 || !isFinite(amtRec);

            return (
              <form onSubmit={handleSave}>
                <div className="va-form-row">
                  <div className="va-field">
                    <label style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>Client *</label>
                    <select
                      value={form.clientId}
                      onChange={e => setForm(p => ({ ...p, clientId: e.target.value, saleId: '' }))}
                      required
                      style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13, background: '#F8FAFC', fontWeight: 600 }}
                    >
                      <option value="">— Select Customer —</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.clientId || 'WH-0000'}) — Total Outstanding: {fmtMoney(Math.max(0, c.currentBalance ?? 0))}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="va-field">
                    <label style={{ fontWeight: 700, fontSize: 12, color: '#334155', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Amount to Collect (Rs) *</span>
                      {form.clientId && (
                        <span style={{ fontSize: 11, color: isOverpayment ? '#DC2626' : '#166534', fontWeight: 700 }}>
                          Max: {fmtMoney(maxAllowed)}
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      max={maxAllowed > 0 ? maxAllowed : undefined}
                      step="any"
                      value={form.amount || ''}
                      onChange={e => setForm(p => ({ ...p, amount: +e.target.value }))}
                      placeholder={maxAllowed > 0 ? `Max ${fmtMoney(maxAllowed)}` : 'Enter amount'}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${isOverpayment ? '#EF4444' : '#CBD5E1'}`,
                        fontSize: 14,
                        fontWeight: 700,
                        background: '#FFFFFF',
                        color: isOverpayment ? '#DC2626' : '#0F172A',
                      }}
                    />
                  </div>
                </div>

                {/* Real-time Calculation Box */}
                {form.clientId && (() => {
                  const cSales = sales.filter(s => s.clientId === form.clientId && s.balance > 0 && s.status !== 'CANCELLED');
                  const prevBal = totalOutstanding;
                  const initialOpening = Math.max(0, selectedC?.openingBalance ?? 0);
                  const invoiceDue = cSales.reduce((sum, s) => sum + s.balance, 0);
                  const openingDue = initialOpening > 0 
                    ? Math.min(initialOpening, Math.max(0, Math.round((prevBal - invoiceDue) * 100) / 100))
                    : 0;
                  const hasOpeningDue = openingDue >= 0.99;
                  const remBal = Math.max(0, prevBal - amtRec);

                  return (
                    <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 10, padding: '14px', margin: '14px 0' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                        <div style={{ background: '#FFF', padding: '8px 10px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Opening Due</div>
                          <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: hasOpeningDue ? '#B45309' : '#166534', marginTop: 2 }}>
                            {fmtMoney(openingDue)}
                          </div>
                        </div>
                        <div style={{ background: '#FFF', padding: '8px 10px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Invoices Due</div>
                          <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: invoiceDue >= 0.99 ? '#B45309' : '#166534', marginTop: 2 }}>
                            {fmtMoney(invoiceDue)}
                          </div>
                        </div>
                        <div style={{ background: '#FFF', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 10, color: '#1E293B', fontWeight: 700, textTransform: 'uppercase' }}>Total Outstanding</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: prevBal >= 0.99 ? '#B45309' : '#166534', marginTop: 2 }}>
                            {fmtMoney(prevBal)}
                          </div>
                        </div>
                        <div style={{ background: remBal > 0 ? '#FFFBEB' : '#F0FDF4', padding: '8px 10px', borderRadius: 8, border: `1px solid ${remBal > 0 ? '#FDE68A' : '#BBF7D0'}` }}>
                          <div style={{ fontSize: 10, color: remBal > 0 ? '#92400E' : '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Remaining Due</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: remBal > 0 ? '#B45309' : '#166534', marginTop: 2 }}>
                            {fmtMoney(remBal)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>Payment Date &amp; Time *</label>
                    <input
                      type="datetime-local"
                      required
                      value={form.date}
                      onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                      style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13, background: '#FFFFFF' }}
                    />
                  </div>
                  <div className="va-field">
                    <label style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>Payment Method *</label>
                    <select
                      value={form.method}
                      onChange={e => setForm(p => ({ ...p, method: e.target.value }))}
                      style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13, background: '#FFFFFF', fontWeight: 700 }}
                    >
                      {['CASH', 'BANK', 'CHEQUE', 'ONLINE'].map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>Reference (Cheque No, Tx ID)</label>
                    <input
                      value={form.reference}
                      onChange={e => setForm(p => ({ ...p, reference: e.target.value }))}
                      placeholder="Optional"
                      style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                    />
                  </div>
                  <div className="va-field">
                    <label style={{ fontWeight: 700, fontSize: 12, color: '#334155' }}>Notes</label>
                    <input
                      value={form.notes}
                      onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      placeholder="Optional"
                      style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="va-btn"
                  disabled={saving || isOverpayment || isInvalidAmount || !form.clientId}
                  style={{
                    marginTop: 16,
                    width: '100%',
                    padding: '12px',
                    borderRadius: 10,
                    fontWeight: 800,
                    fontSize: 14,
                    background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
                    opacity: (saving || isOverpayment || isInvalidAmount || !form.clientId) ? 0.6 : 1,
                    cursor: (saving || isOverpayment || isInvalidAmount || !form.clientId) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {saving ? 'Saving…' : '✓ Record Payment & Generate Receipt'}
                </button>
              </form>
            );
          })()}
        </div>
      )}

      {/* ─── TAB 1: INVOICE REGISTRY & DUES ─────────────────────────────────── */}
      {view === 'list' && activeTab === 'registry' && (
        <div>
          {loading && collections.length === 0 ? (
            <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={6} /></div>
          ) : sales.length === 0 ? (
            <div className="va-empty" style={{ padding: 40, textAlign: 'center' }}><div className="big">No sales invoices yet</div></div>
          ) : (
            <>
              {/* ────── DESKTOP VIEW ────── */}
              <div className="hide-mobile">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {groupedList.map(g => {
                    const isExpanded = !!expandedClients[g.clientId];
                    return (
                      <div key={g.clientId} style={{ border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                        <div
                          onClick={() => toggleExpand(g.clientId)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '12px',
                            padding: '14px 18px',
                            background: '#F8FAFC',
                            cursor: 'pointer',
                            userSelect: 'none',
                            borderBottom: isExpanded ? '1px solid #E2E8F0' : 'none',
                            transition: 'background 0.2s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto', minWidth: 200 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.hasAuthDebt ? '#DC2626' : '#16A34A', display: 'inline-block', flexShrink: 0 }}></span>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>{g.clientName}</span>
                                <span style={{ background: '#E2E8F0', color: '#475569', borderRadius: 6, padding: '2px 6px', fontSize: 11, fontWeight: 700 }}>
                                  {g.clientNo}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 11, color: '#64748B', flexWrap: 'wrap' }}>
                                <span>Invoices ({g.items.length}): <strong style={{ color: g.hasInvoiceDue ? '#B45309' : '#16A34A' }}>{fmtMoney(g.invoiceDue)}</strong></span>
                                {g.hasOpeningDue ? (
                                  <span>• Opening Due: <strong style={{ color: '#B45309' }}>{fmtMoney(g.openingDue)}</strong> <span style={{ color: '#D97706', fontWeight: 700 }}>(UNPAID)</span></span>
                                ) : (
                                  <span>• Opening Balance: <strong style={{ color: '#16A34A' }}>CLEARED (Rs 0)</strong></span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
                            <div style={{ textAlign: 'right', paddingRight: 8, borderRight: '1px solid #E2E8F0' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Total Outstanding</div>
                              <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: g.hasAuthDebt ? '#DC2626' : '#16A34A' }}>
                                {fmtMoney(g.authoritativeOutstanding)}
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                              <button className="va-btn secondary small" onClick={() => handleViewDues(g.clientId)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700 }}>
                                💳 View Dues
                              </button>
                              <button className="va-btn secondary small" onClick={() => handleSendDueStatement(g.clientId)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700 }}>
                                📋 Statement
                              </button>
                              <button className="va-btn small" onClick={() => openRecordPaymentForClient(g.clientId)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700 }}>
                                ➕ Record Payment
                              </button>
                            </div>
                            <span style={{ fontSize: 12, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease', display: 'inline-block', color: '#94A3B8', flexShrink: 0 }}>▼</span>
                          </div>
                        </div>

                        {/* Accordion Table */}
                        {isExpanded && (
                          <div style={{ padding: '0 20px 16px 20px', background: '#fff' }}>
                            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                              <table className="va-table" style={{ width: '100%', marginTop: 8 }}>
                                <thead>
                                  <tr>
                                    <th>Invoice ID</th>
                                    <th>Date &amp; Time</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                    <th style={{ textAlign: 'right', color: '#166534' }}>Paid</th>
                                    <th style={{ textAlign: 'right', color: '#DC2626' }}>Remaining</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.items.map(item => (
                                    <tr key={item.id}>
                                      <td style={{ fontWeight: 700, color: '#0F172A' }}>{item.invoiceNo}</td>
                                      <td style={{ color: '#64748B', fontSize: 12 }}>{fmtDateTime(item.date)}</td>
                                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(item.total)}</td>
                                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: item.paid > 0 ? '#166534' : '#64748B' }}>{fmtMoney(item.paid)}</td>
                                      <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: item.remaining > 0 ? '#DC2626' : '#166534' }}>{fmtMoney(item.remaining)}</td>
                                      <td>
                                        <span style={{
                                          fontSize: 10,
                                          fontWeight: 800,
                                          padding: '2px 8px',
                                          borderRadius: 12,
                                          background: item.status === 'PAID' ? '#DCFCE7' : item.status === 'PARTIALLY PAID' ? '#FEF3C7' : '#FEE2E2',
                                          color: item.status === 'PAID' ? '#15803D' : item.status === 'PARTIALLY PAID' ? '#B45309' : '#991B1B',
                                        }}>
                                          {item.status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ────── MOBILE VIEW (Dedicated Touch Cards) ────── */}
              <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                {groupedList.map(g => {
                  const isExpanded = !!expandedClients[g.clientId];
                  const phone = g.phone || g.whatsapp || '';

                  return (
                    <MobileCard
                      key={g.clientId}
                      title={g.clientName}
                      headerBadge={g.clientNo}
                      footer={
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                          <button
                            type="button"
                            className="va-btn small"
                            style={{ flex: 1, fontWeight: 800, padding: '9px 12px' }}
                            onClick={() => openRecordPaymentForClient(g.clientId)}
                          >
                            ➕ Pay
                          </button>
                          <button
                            type="button"
                            className="va-btn secondary small"
                            style={{ flex: 1, fontWeight: 700, padding: '9px 12px' }}
                            onClick={() => handleSendDueStatement(g.clientId)}
                          >
                            📋 Statement
                          </button>
                          <button
                            type="button"
                            className="va-btn secondary small"
                            style={{ flex: 1, fontWeight: 700, padding: '9px 12px' }}
                            onClick={() => toggleExpand(g.clientId)}
                          >
                            {isExpanded ? 'Hide' : `Invoices (${g.items.length})`}
                          </button>
                        </div>
                      }
                    >
                      {phone && (
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                          <a
                            href={`tel:${phone}`}
                            style={{ flex: 1, padding: '6px 8px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, color: '#1D4ED8', textDecoration: 'none', fontWeight: 700, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                          >
                            <Icon path={mdiPhone} size={0.55} />
                            <span>Call</span>
                          </a>
                          <a
                            href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ flex: 1, padding: '6px 8px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6, color: '#15803D', textDecoration: 'none', fontWeight: 700, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                          >
                            <Icon path={mdiWhatsapp} size={0.55} />
                            <span>WhatsApp</span>
                          </a>
                        </div>
                      )}

                      <MobileCardRow 
                        label="Total Outstanding Due" 
                        value={fmtMoney(g.authoritativeOutstanding)} 
                        valueColor={g.hasAuthDebt ? '#DC2626' : '#166534'} 
                        isMono 
                      />
                      <MobileCardRow label="Invoices Due" value={`${fmtMoney(g.invoiceDue)} (${g.items.length} total)`} isMono />
                      
                      {g.hasOpeningDue ? (
                        <MobileCardRow label="Opening Due" value={`${fmtMoney(g.openingDue)} (UNPAID)`} valueColor="#B45309" isMono />
                      ) : (
                        <MobileCardRow label="Opening Balance" value="CLEARED (Rs 0)" valueColor="#166534" />
                      )}

                      {/* Expandable Invoice Cards */}
                      {isExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                          {g.items.map(item => {
                            const isPaid = item.status === 'PAID' || item.remaining <= 0.01;
                            const isPartial = item.status === 'PARTIALLY PAID';
                            const statusVariant = isPaid ? 'green' : isPartial ? 'yellow' : 'red';

                            return (
                              <MobileCardBox
                                key={item.id}
                                title={
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                    <span className="mono" style={{ fontWeight: 800, fontSize: '12px', color: '#0F172A' }}>
                                      #{item.invoiceNo}
                                    </span>
                                    <span style={{ fontSize: '11px', color: '#64748B' }}>
                                      {fmtDateTime(item.date)}
                                    </span>
                                  </div>
                                }
                                bg="#F8FAFC"
                                borderColor="#CBD5E1"
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '2px' }}>
                                  <MobileCardRow label="Total" value={fmtMoney(item.total)} isMono />
                                  <MobileCardRow label="Paid" value={fmtMoney(item.paid)} valueColor="#166534" isMono />
                                  <MobileCardRow 
                                    label="Remaining" 
                                    value={fmtMoney(item.remaining)} 
                                    valueColor={item.remaining > 0 ? '#DC2626' : '#166534'} 
                                    isMono 
                                  />
                                  <MobileCardRow label="Status">
                                    <MobileCardBadge variant={statusVariant}>
                                      {item.status}
                                    </MobileCardBadge>
                                  </MobileCardRow>
                                </div>
                              </MobileCardBox>
                            );
                          })}
                        </div>
                      )}
                    </MobileCard>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── TAB 2: DAILY PAYMENT HISTORY (DESKTOP & MOBILE REDESIGN) ───────── */}
      {view === 'list' && activeTab === 'daily_history' && (
        <div>
          {/* Header Controls & Filters */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '14px 18px', marginBottom: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0F172A' }}>
                  📅 Daily Payment History
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748B' }}>
                  Business Day <strong>{dailyData?.businessDate || dailyDate}</strong> (5:00 AM Cutoff)
                </p>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="va-btn secondary small"
                  onClick={() => {
                    if (dailyData) setDailyPreviewModal(dailyData);
                    else showToast('❌ No payment history loaded yet');
                  }}
                  disabled={!dailyData || dailyData.transactions?.length === 0}
                  style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Icon path={mdiEyeOutline} size={0.65} />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  className="va-btn small"
                  onClick={async () => {
                    if (dailyData && dailyData.transactions?.length > 0) {
                      const brand = await loadBrandConfigWithLogo();
                      const html = generateDailyPaymentHistoryHTML(dailyData, brand, typeof window !== 'undefined' ? window.location.origin : '');
                      showToast('⏳ Generating report image...');
                      const url = await generateTemplateJpgBase64(html);
                      if (url) {
                        const dateSlug = (dailyData.businessDate || dailyDate).replace(/\s+/g, '_');
                        downloadImage(url, `daily_payment_history_${dateSlug}.jpg`);
                        showToast('✅ Report downloaded');
                      } else {
                        showToast('❌ Failed to download report');
                      }
                    } else {
                      showToast('❌ No payments recorded on this business day');
                    }
                  }}
                  disabled={!dailyData || dailyData.transactions?.length === 0}
                  style={{ fontWeight: 800, background: '#166534', color: '#FFF', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Icon path={mdiDownload} size={0.65} />
                  <span>Download Report</span>
                </button>
              </div>
            </div>

            {/* Date & Filter Row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F1F5F9', paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Date:</span>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={e => { setDailyDate(e.target.value); loadDailyHistory(e.target.value); }}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, fontWeight: 700, background: '#F8FAFC' }}
                />
                <button
                  type="button"
                  className="va-btn secondary small"
                  style={{ padding: '5px 8px', fontSize: 11, fontWeight: 700 }}
                  onClick={() => { const t = todayInputDate(); setDailyDate(t); loadDailyHistory(t); }}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="va-btn secondary small"
                  style={{ padding: '5px 8px', fontSize: 11, fontWeight: 700 }}
                  onClick={() => { const y = dateOffset(-1); setDailyDate(y); loadDailyHistory(y); }}
                >
                  Yesterday
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end', minWidth: 240 }}>
                <select
                  value={dailyMethod}
                  onChange={e => { setDailyMethod(e.target.value); loadDailyHistory(dailyDate, dailyEmployee, e.target.value); }}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, fontWeight: 600, background: '#F8FAFC' }}
                >
                  <option value="all">All Methods</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank Transfer</option>
                  <option value="ONLINE">Online</option>
                  <option value="CHEQUE">Cheque</option>
                </select>

                <div style={{ position: 'relative', flex: 1, maxWidth: 200 }}>
                  <input
                    placeholder="Search Client…"
                    value={dailySearch}
                    onChange={e => { setDailySearch(e.target.value); loadDailyHistory(dailyDate, dailyEmployee, dailyMethod, e.target.value); }}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#F8FAFC' }}
                  />
                </div>

                <button
                  type="button"
                  className="va-btn secondary small"
                  onClick={() => loadDailyHistory()}
                  style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 3 }}
                  title="Refresh"
                >
                  <Icon path={mdiRefresh} size={0.65} />
                </button>
              </div>
            </div>
          </div>

          {/* KPI Summary Cards */}
          {dailyData && dailyData.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div style={{ background: '#F0FDF4', padding: '10px 14px', borderRadius: 10, border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: 11, color: '#166534', fontWeight: 800, textTransform: 'uppercase' }}>💰 Total Collected</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: '#15803D', marginTop: 2 }}>
                  {fmtMoney(dailyData.summary.totalCollected)}
                </div>
                <div style={{ fontSize: 10, color: '#16A34A', marginTop: 2 }}>{dailyData.summary.totalTransactions} Payments</div>
              </div>

              <div style={{ background: '#FFFBEB', padding: '10px 14px', borderRadius: 10, border: '1px solid #FDE68A' }}>
                <div style={{ fontSize: 11, color: '#92400E', fontWeight: 800, textTransform: 'uppercase' }}>💵 Cash</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: '#B45309', marginTop: 2 }}>
                  {fmtMoney(dailyData.summary.cashCollected)}
                </div>
                <div style={{ fontSize: 10, color: '#D97706', marginTop: 2 }}>Physical Cash</div>
              </div>

              <div style={{ background: '#EFF6FF', padding: '10px 14px', borderRadius: 10, border: '1px solid #BFDBFE' }}>
                <div style={{ fontSize: 11, color: '#1E40AF', fontWeight: 800, textTransform: 'uppercase' }}>💳 Bank / Online</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: '#1D4ED8', marginTop: 2 }}>
                  {fmtMoney((dailyData.summary.bankCollected || 0) + (dailyData.summary.onlineCollected || 0))}
                </div>
                <div style={{ fontSize: 10, color: '#2563EB', marginTop: 2 }}>Direct Transfers</div>
              </div>

              <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800, textTransform: 'uppercase' }}>📅 Cutoff Date</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{dailyData.businessDate}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>5:00 AM Cycle</div>
              </div>
            </div>
          )}

          {/* Transactions Output */}
          {loadingDaily ? (
            <div style={{ padding: 20 }}><SkeletonTable rows={5} cols={7} /></div>
          ) : !dailyData || dailyData.transactions?.length === 0 ? (
            <div className="va-empty" style={{ padding: '40px 20px', textAlign: 'center', background: '#FFFFFF', borderRadius: '14px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '32px', marginBottom: 6 }}>💳</div>
              <div className="big" style={{ fontSize: '17px', fontWeight: 800, color: '#0F172A' }}>No collections found for {dailyDate}</div>
              <p style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>
                No payment receipts were recorded during this 5:00 AM business day.
              </p>
            </div>
          ) : (
            <>
              {/* ────── DESKTOP TABLE ────── */}
              <div className="hide-mobile" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800 }}>
                        <th style={{ padding: '12px 16px' }}>Ref / Receipt</th>
                        <th style={{ padding: '12px 16px' }}>Time</th>
                        <th style={{ padding: '12px 16px' }}>Customer</th>
                        <th style={{ padding: '12px 16px' }}>Received By</th>
                        <th style={{ padding: '12px 16px' }}>Method</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.transactions.map((tx: any) => (
                        <tr key={tx.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <span className="mono" style={{ fontWeight: 800, color: '#1E293B', background: '#F1F5F9', padding: '3px 6px', borderRadius: 4, fontSize: 12 }}>
                              {tx.reference}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#64748B', fontSize: 12 }}>{tx.time}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <strong style={{ color: '#0F172A' }}>{tx.clientName}</strong>
                            {tx.clientId && <span style={{ fontSize: 11, color: '#64748B', marginLeft: 6 }}>({tx.clientId})</span>}
                          </td>
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>👤 {tx.receivedBy}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 800, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4,
                              background: tx.method === 'CASH' ? '#DCFCE7' : tx.method === 'BANK' ? '#DBEAFE' : '#FEF9C3',
                              color: tx.method === 'CASH' ? '#166534' : tx.method === 'BANK' ? '#1E40AF' : '#854D0E',
                            }}>
                              {tx.method}
                            </span>
                          </td>
                          <td className="mono" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, color: '#166534', fontSize: 14 }}>
                            {fmtMoney(tx.amount)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: '#DCFCE7', color: '#166534' }}>
                              VERIFIED
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ────── MOBILE VIEW (Dedicated Payment Cards) ────── */}
              <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                {dailyData.transactions.map((tx: any) => (
                  <div
                    key={tx.id}
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '14px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                    }}
                  >
                    {/* Top Row: Ref & Time */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span className="mono" style={{ fontWeight: 800, fontSize: '12px', color: '#0F172A', background: '#F1F5F9', padding: '3px 8px', borderRadius: '6px' }}>
                        {tx.reference}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>
                        ⏰ {tx.time}
                      </span>
                    </div>

                    {/* Customer & Amount */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '6px 0 10px' }}>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 800, color: '#0F172A' }}>
                          {tx.clientName}
                        </div>
                        {tx.clientId && (
                          <div style={{ fontSize: '11px', color: '#64748B' }}>
                            ID: {tx.clientId}
                          </div>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: '17px', fontWeight: 800, color: '#166534' }}>
                        {fmtMoney(tx.amount)}
                      </div>
                    </div>

                    {/* Details Pill Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #F1F5F9', paddingTop: 8, fontSize: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: tx.method === 'CASH' ? '#DCFCE7' : tx.method === 'BANK' ? '#DBEAFE' : '#FEF9C3',
                          color: tx.method === 'CASH' ? '#166534' : tx.method === 'BANK' ? '#1E40AF' : '#854D0E',
                        }}>
                          {tx.method}
                        </span>
                        <span style={{ color: '#64748B', fontSize: 11 }}>
                          👤 {tx.receivedBy}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 8, background: '#DCFCE7', color: '#15803D' }}>
                        ✓ VERIFIED
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Statement Modal ── */}
      {statementClient && (
        <DueStatementModal
          onClose={() => setStatementClient(null)}
          client={statementClient}
          invoices={statementInvoices}
          mode={statementMode}
        />
      )}

      {/* ── Receipt Modal ── */}
      {receiptModal && (
        <CollectionReceiptModal
          onClose={() => setReceiptModal(null)}
          data={receiptModal}
        />
      )}

      {/* ── Daily Payment History Preview Modal ── */}
      {dailyPreviewModal && (
        <DailyPaymentHistoryPreviewModal
          onClose={() => setDailyPreviewModal(null)}
          data={dailyPreviewModal}
        />
      )}
    </DashboardLayout>
  );
}
