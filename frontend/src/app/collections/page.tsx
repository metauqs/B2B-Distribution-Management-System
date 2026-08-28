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
import { mdiCashRegister, mdiPhone, mdiWhatsapp } from '@mdi/js';
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
  const [dailyData,    setDailyData]    = useState<any | null>(null);
  const [loadingDaily, setLoadingDaily] = useState<boolean>(false);
  const [dailyPreviewModal, setDailyPreviewModal] = useState<any | null>(null);

  // ── Receipt Modal & Due Statement Modal state ──
  const [receiptModal, setReceiptModal] = useState<any | null>(null);
  const [statementClient, setStatementClient] = useState<any | null>(null);
  const [statementInvoices, setStatementInvoices] = useState<any[]>([]);
  const [statementMode, setStatementMode] = useState<'view' | 'share'>('view');

  const loadDailyHistory = useCallback(async (dateVal?: string, empVal?: string, methodVal?: string, searchVal?: string, isBackground = false) => {
    if (!isBackground && !dailyData) setLoadingDaily(true);
    try {
      const targetDate = dateVal !== undefined ? dateVal : dailyDate;
      const targetEmp = empVal !== undefined ? empVal : dailyEmployee;
      const targetMethod = methodVal !== undefined ? methodVal : dailyMethod;
      const targetSearch = searchVal !== undefined ? searchVal : dailySearch;

      const params = new URLSearchParams();
      if (targetDate) params.append('date', targetDate);
      if (targetEmp && targetEmp !== 'all') params.append('employeeId', targetEmp);
      if (targetMethod && targetMethod !== 'all') params.append('method', targetMethod);
      if (targetSearch) params.append('search', targetSearch);

      const cacheKey = `/api/collections/daily-history?${params.toString()}`;
      const json = await fetchWithCache<any>(cacheKey, { ttl: TTL_SHORT, forceRefresh: isBackground });
      if (json) {
        setDailyData(json);
      }
    } catch (err) {
      console.error('loadDailyHistory error:', err);
    } finally {
      setLoadingDaily(false);
    }
  }, [dailyDate, dailyEmployee, dailyMethod, dailySearch, dailyData]);

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

  const openRecordPaymentForClient = (clientId: string) => {
    setForm({ ...BLANK_FORM, clientId, date: todayInputDateTime() });
    setView('add');
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const toggleExpand = (cid: string) => {
    setExpandedClients(prev => ({ ...prev, [cid]: !prev[cid] }));
  };

  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && !getCachedData('/api/collections')) setLoading(true);
    try {
      const [cd, cld, sd] = await Promise.all([
        fetchWithCache<any>('/api/collections', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<any>('/api/clients?minimal=true', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<any>('/api/sales?limit=100', { ttl: TTL_SHORT, forceRefresh: isBackground }),
      ]);
      if (cd) setCollections(cd.data ?? (Array.isArray(cd) ? cd : []));
      if (cld) setClients(cld.data ?? (Array.isArray(cld) ? cld : []));
      if (sd) {
        const salesList = sd.data ?? (Array.isArray(sd) ? sd : []);
        setSales(salesList);
        const initialExpanded: { [key: string]: boolean } = {};
        salesList.forEach((item: Sale) => {
          initialExpanded[item.clientId] = true;
        });
        setExpandedClients(initialExpanded);
      }
    } catch (err) {
      console.error('collections load error:', err);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (activeTab === 'daily_history') {
      loadDailyHistory();
    }
  }, [activeTab, dailyDate, dailyEmployee, dailyMethod, dailySearch, loadDailyHistory]);

  useEffect(() => {
    const handleRevalidate = () => {
      load(true);
      if (activeTab === 'daily_history') loadDailyHistory();
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [load, activeTab, loadDailyHistory]);

  const { isSubmitting: saving, handleSubmit: onSubmitPayment } = useIdempotentSubmit({
    onSubmit: async (formData: typeof form, idempotencyKey: string) => {
      if (!formData.clientId) {
        showToast('❌ Select a client');
        return;
      }
      if (formData.amount <= 0 || isNaN(formData.amount) || !isFinite(formData.amount)) {
        showToast('❌ Amount must be a positive number');
        return;
      }

      const selectedC = clients.find(c => c.id === formData.clientId);
      const totalOutstanding = Math.max(0, selectedC?.currentBalance ?? 0);
      const targetSale = formData.saleId ? sales.find(s => s.id === formData.saleId) : null;
      const maxAllowed = targetSale ? Math.min(totalOutstanding, targetSale.balance) : totalOutstanding;
      const roundedMax = Math.round(maxAllowed);

      if (formData.amount > maxAllowed + 0.99 && formData.amount > roundedMax) {
        showToast(`❌ Payment (Rs ${formData.amount.toLocaleString()}) cannot exceed outstanding balance of ${fmtMoney(maxAllowed)}`);
        return;
      }

      if (!formData.date) {
        showToast('❌ Date is required');
        return;
      }

      const res = await apiFetch('/api/collections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/collections');
        invalidateCache('/api/sales');
        invalidateCache('/api/clients');
        invalidateCache('/api/reports');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast('✅ Payment recorded successfully');

        const clientObj = clients.find(c => c.id === formData.clientId);
        setReceiptModal({
          receiptNo: data.data.reference || `PAY-${(data.data.id || '').slice(-6).toUpperCase()}`,
          date: fmtDateTime(data.data.date),
          clientName: clientObj?.name || data.data.client?.name || 'Customer',
          clientId: clientObj?.clientId || undefined,
          phone: (clientObj as any)?.phone || (clientObj as any)?.whatsapp || undefined,
          whatsapp: (clientObj as any)?.whatsapp || (clientObj as any)?.phone || undefined,
          paymentMethod: formData.method,
          reference: formData.reference || undefined,
          receivedBy: data.data.receivedByUser?.name || undefined,
          previousBalance: data.data.summary?.previousBalance ?? 0,
          currentBillAmount: data.data.summary?.currentBillAmount ?? 0,
          totalPayable: data.data.summary?.totalPayable ?? 0,
          amountReceived: data.data.summary?.amountReceived ?? formData.amount,
          remainingBalance: data.data.summary?.remainingBalance ?? 0,
          excessPayment: data.data.summary?.excessPayment ?? 0,
          allocations: (data.data.allocations || []).map((a: any) => ({
            invoiceNo: a.invoiceNo,
            allocatedAmount: a.allocatedAmount,
            remainingBalance: a.remainingBalance,
          })),
          notes: formData.notes || undefined,
        });

        setForm({ ...BLANK_FORM });
        await load(true);
        loadDailyHistory(dailyDate);
        setView('list');
      } else {
        showToast(`❌ ${data.error || 'Failed to record payment'}`);
      }
    },
    onError: (err: any) => {
      showToast(`❌ ${err.message || 'Network error'}`);
    },
    getFingerprint: (d) => `${d.clientId}-${d.amount}-${d.date}-${d.method}-${d.reference}`,
  });

  const handleSave = (e: React.FormEvent) => onSubmitPayment(e, form);

  const clientInvoices = sales.filter(s => s.clientId === form.clientId && s.balance > 0 && s.status !== 'CANCELLED');

  // Group sales invoices per client using single authoritative source of truth
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
        phone: (client as any).phone || (client as any).whatsapp,
        whatsapp: (client as any).whatsapp || (client as any).phone,
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
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,.18)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="va-panel" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
              <Icon path={mdiCashRegister} size={1} color="var(--primary)" />
              <h2 style={{ margin: 0 }}>Collections</h2>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>Outstanding invoice collections, cash tracking, and payment matching</p>
          </div>
          {view === 'list' ? (
            <button className="va-btn" onClick={() => { setForm({ ...BLANK_FORM, date: todayInputDateTime() }); setView('add'); }}>+ Record Payment</button>
          ) : (
            <button className="va-btn secondary small" onClick={() => setView('list')}>← Back</button>
          )}
        </div>

        {/* Navigation Sub-Tabs */}
        {view === 'list' && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <button
              className={`va-btn ${activeTab === 'registry' ? '' : 'secondary'} small`}
              style={{ fontWeight: 700 }}
              onClick={() => setActiveTab('registry')}
            >
              📊 Invoice Registry &amp; Dues
            </button>
            <button
              className={`va-btn ${activeTab === 'daily_history' ? '' : 'secondary'} small`}
              style={{ fontWeight: 700 }}
              onClick={() => { setActiveTab('daily_history'); loadDailyHistory(); }}
            >
              📅 Daily Payment History
            </button>
          </div>
        )}
      </div>

      {view === 'add' && (
        <div className="va-panel" style={{ maxWidth: 680 }}>
          <div className="va-panel-head"><h3>New Payment Received</h3></div>
          {(() => {
            const selectedC = clients.find(c => c.id === form.clientId);
            const totalOutstanding = Math.max(0, selectedC?.currentBalance ?? 0);
            const targetSale = form.saleId ? sales.find(s => s.id === form.saleId) : null;
            const maxAllowed = targetSale ? Math.min(totalOutstanding, targetSale.balance) : totalOutstanding;
            const roundedMax = Math.round(maxAllowed);
            const amtRec = Number(form.amount || 0);
            const isOverpayment = form.clientId ? (amtRec > maxAllowed + 0.99 && amtRec > roundedMax) : false;
            const isInvalidAmount = isNaN(amtRec) || amtRec <= 0 || !isFinite(amtRec);

            return (
              <form onSubmit={handleSave}>
                <div className="va-form-row">
                  <div className="va-field">
                    <label>Client *</label>
                    <select value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value, saleId: '' }))} required>
                      <option value="">— Select Customer —</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.clientId || 'WH-0000'}) — Total Outstanding: {fmtMoney(Math.max(0, c.currentBalance ?? 0))}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="va-field">
                    <label>
                      Amount to Collect (Rs) *
                      {form.clientId && (
                        <span style={{ float: 'right', fontSize: 11, color: isOverpayment ? '#DC2626' : '#16A34A', fontWeight: 700 }}>
                          Max Allowed: {fmtMoney(maxAllowed)}
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      max={maxAllowed > 0 ? Math.max(maxAllowed, roundedMax) : undefined}
                      step="any"
                      value={form.amount || ''}
                      onChange={e => setForm(p => ({ ...p, amount: e.target.value === '' ? 0 : +e.target.value }))}
                      placeholder={maxAllowed > 0 ? `Enter amount (max ${fmtMoney(maxAllowed)})` : 'Enter payment amount'}
                      style={{
                        borderColor: isOverpayment ? '#EF4444' : undefined,
                        background: isOverpayment ? '#FEF2F2' : undefined
                      }}
                    />
                  </div>
                </div>

                {/* Overpayment Warning Alert */}
                {isOverpayment && (
                  <div style={{
                    background: '#FEF2F2',
                    border: '1.5px solid #EF4444',
                    borderRadius: 8,
                    padding: '12px 16px',
                    color: '#991B1B',
                    fontWeight: 700,
                    fontSize: 13,
                    margin: '12px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    <span style={{ fontSize: 16 }}>⚠️</span>
                    <span>Payment cannot exceed the outstanding balance of {fmtMoney(maxAllowed)}. Overpayment is not permitted.</span>
                  </div>
                )}

                {/* ────── REAL-TIME PAYMENT & RUNNING BALANCE CALCULATION CARD ────── */}
                {form.clientId && selectedC && (() => {
                  const prevBal = maxAllowed;
                  const remBal = Math.max(0, prevBal - amtRec);

                  const initialOpening = Math.max(0, selectedC.openingBalance || 0);
                  const cSales = sales.filter(s => s.clientId === selectedC.id && s.status !== 'CANCELLED');
                  const invoiceDue = cSales.reduce((sum, s) => sum + (s.balance >= 0.99 ? s.balance : 0), 0);
                  const openingDue = initialOpening > 0 
                    ? Math.min(initialOpening, Math.max(0, Math.round((prevBal - invoiceDue) * 100) / 100))
                    : 0;
                  const hasOpeningDue = openingDue >= 0.99;

                  // Waterfall Allocation Preview
                  const allocToOpening = Math.min(amtRec, openingDue);
                  const remainingOpeningAfter = Math.max(0, openingDue - allocToOpening);
                  const allocToInvoices = Math.min(Math.max(0, amtRec - allocToOpening), invoiceDue);
                  const remainingInvoicesAfter = Math.max(0, invoiceDue - allocToInvoices);

                  return (
                    <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 16, margin: '14px 0 16px' }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: '#1E293B', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <span>📊 Financial Breakdown &amp; Allocation Preview</span>
                        <span style={{ fontSize: 11, background: '#E2E8F0', padding: '2px 8px', borderRadius: 12, color: '#475569', fontWeight: 700 }}>Authoritative Engine</span>
                      </div>

                      {/* Financial Bucket Breakdown */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
                        <div style={{ background: '#FFF', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Opening Balance Due</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: hasOpeningDue ? '#B45309' : '#16A34A', marginTop: 4 }}>
                            {fmtMoney(openingDue)}
                          </div>
                          <div style={{ fontSize: 10, color: hasOpeningDue ? '#D97706' : '#16A34A', marginTop: 2, fontWeight: 700 }}>
                            {hasOpeningDue ? '⚠️ UNPAID' : '✅ CLEARED'}
                          </div>
                        </div>

                        <div style={{ background: '#FFF', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Invoice Outstanding</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: invoiceDue >= 0.99 ? '#B45309' : '#16A34A', marginTop: 4 }}>
                            {fmtMoney(invoiceDue)}
                          </div>
                          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{cSales.length} Active Invoices</div>
                        </div>

                        <div style={{ background: '#FFF', padding: '10px 12px', borderRadius: 8, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 10, color: '#1E293B', fontWeight: 700, textTransform: 'uppercase' }}>Total Outstanding</div>
                          <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: prevBal >= 0.99 ? '#B45309' : '#16A34A', marginTop: 4 }}>
                            {fmtMoney(prevBal)}
                          </div>
                          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Maximum Allowed</div>
                        </div>

                        <div style={{ background: '#F0FDF4', padding: '10px 12px', borderRadius: 8, border: '1px solid #BBF7D0' }}>
                          <div style={{ fontSize: 10, color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Amount to Collect</div>
                          <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: '#15803D', marginTop: 4 }}>
                            {fmtMoney(amtRec)}
                          </div>
                          <div style={{ fontSize: 10, color: '#16A34A', marginTop: 2 }}>Current payment</div>
                        </div>

                        <div style={{ background: remBal > 0 ? '#FFFBEB' : '#F0FDF4', padding: '10px 12px', borderRadius: 8, border: `1px solid ${remBal > 0 ? '#FDE68A' : '#BBF7D0'}` }}>
                          <div style={{ fontSize: 10, color: remBal > 0 ? '#92400E' : '#166534', fontWeight: 700, textTransform: 'uppercase' }}>
                            Remaining Due
                          </div>
                          <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: remBal > 0 ? '#B45309' : '#16A34A', marginTop: 4 }}>
                            {fmtMoney(remBal)}
                          </div>
                          <div style={{ fontSize: 10, color: remBal > 0 ? '#D97706' : '#16A34A', marginTop: 2 }}>
                            {remBal === 0 ? 'Fully settled (Rs 0)' : 'Remaining balance'}
                          </div>
                        </div>
                      </div>

                      {/* Allocation Waterfall Preview */}
                      {amtRec > 0 && !isOverpayment && (
                        <div style={{ background: '#FFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 6 }}>Priority Allocation Preview:</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569' }}>
                              <span>1. <strong>FIRST:</strong> Opening Balance Allocation:</span>
                              <span className="mono" style={{ fontWeight: 700, color: allocToOpening > 0 ? '#166534' : '#64748B' }}>
                                {fmtMoney(allocToOpening)} {allocToOpening > 0 && `(Remaining Opening: ${fmtMoney(remainingOpeningAfter)})`}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569' }}>
                              <span>2. <strong>THEN:</strong> Active Invoices FIFO Allocation:</span>
                              <span className="mono" style={{ fontWeight: 700, color: allocToInvoices > 0 ? '#166534' : '#64748B' }}>
                                {fmtMoney(allocToInvoices)} {allocToInvoices > 0 && `(Remaining Invoices: ${fmtMoney(remainingInvoicesAfter)})`}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label>Specific Invoice to Settle (Optional — FIFO Auto-Allocates Oldest Dues First)</label>
                    <select value={form.saleId} onChange={e => setForm(p => ({ ...p, saleId: e.target.value }))}>
                      <option value="">— Auto FIFO Allocation (Oldest Invoices First) —</option>
                      {clientInvoices.map(s => (
                        <option key={s.id} value={s.id}>
                          Invoice #{s.invoiceNo} (Total: {fmtMoney(s.total)}, Due: {fmtMoney(s.balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label>Payment Date &amp; Time *</label>
                    <input type="datetime-local" required value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
                  </div>
                  <div className="va-field">
                    <label>Payment Method *</label>
                    <select value={form.method} onChange={e => setForm(p => ({ ...p, method: e.target.value }))}>
                      {['CASH', 'BANK', 'CHEQUE', 'ONLINE'].map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label>Reference (Cheque No, Tx ID)</label>
                    <input value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} placeholder="Optional" />
                  </div>
                  <div className="va-field">
                    <label>Notes</label>
                    <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
                  </div>
                </div>
                <button
                  type="submit"
                  className="va-btn"
                  disabled={saving || isOverpayment || isInvalidAmount || !form.clientId}
                  style={{
                    opacity: (saving || isOverpayment || isInvalidAmount || !form.clientId) ? 0.6 : 1,
                    cursor: (saving || isOverpayment || isInvalidAmount || !form.clientId) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {saving ? 'Saving…' : '✓ Record Payment'}
                </button>
              </form>
            );
          })()}
        </div>
      )}

      {view === 'list' && activeTab === 'registry' && (
        <div className="va-panel">
          <div className="va-panel-head">
            <h3>Invoice Collections Registry</h3>
            <button className="va-btn secondary small" onClick={() => load()}>↻ Refresh</button>
          </div>
          {loading && collections.length === 0 ? <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={6} /></div> : sales.length === 0 ? (
            <div className="va-empty"><div className="big">No sales invoices yet</div></div>
          ) : (
            <>
              {/* ────── DESKTOP VIEW (Redesigned Accordion & Invoice Focus) ────── */}
              <div className="hide-mobile">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {groupedList.map(g => {
                    const isExpanded = !!expandedClients[g.clientId];
                    return (
                      <div key={g.clientId} style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                        {/* ── NEW ACCORDION HEADER (Section 9 Specification) ── */}
                        <div
                          onClick={() => toggleExpand(g.clientId)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '12px',
                            padding: '14px 18px',
                            background: '#f8f9fa',
                            cursor: 'pointer',
                            userSelect: 'none',
                            borderBottom: isExpanded ? '1px solid var(--line)' : 'none',
                            transition: 'background 0.2s ease'
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f1f3f5'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '#f8f9fa'; }}
                        >
                          {/* Client Identification */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto', minWidth: 200 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.hasAuthDebt ? 'var(--clay)' : 'var(--ok)', display: 'inline-block', flexShrink: 0 }}></span>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{g.clientName}</span>
                                <span style={{ background: '#e9ecef', color: '#495057', borderRadius: 6, padding: '2px 6px', fontSize: 11, fontWeight: 700 }}>
                                  {g.clientNo}
                                </span>
                              </div>
                              {/* Financial Breakdown Badges */}
                              <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 11, color: '#64748B', flexWrap: 'wrap' }}>
                                <span>Invoices ({g.items.length}): <strong style={{ color: g.hasInvoiceDue ? '#B45309' : '#16A34A' }}>{fmtMoney(g.invoiceDue)}</strong></span>
                                {g.hasOpeningDue ? (
                                  <span>• Opening Due: <strong style={{ color: '#B45309' }}>{fmtMoney(g.openingDue)}</strong> <span style={{ color: '#D97706', fontWeight: 700 }}>(UNPAID)</span></span>
                                ) : g.initialOpening > 0 ? (
                                  <span>• Opening Balance: <strong style={{ color: '#16A34A' }}>CLEARED (Rs 0)</strong></span>
                                ) : (
                                  <span>• Opening Balance: <strong style={{ color: '#16A34A' }}>Rs 0</strong></span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Total Outstanding & Actions */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
                            <div style={{ textAlign: 'right', paddingRight: 8, borderRight: '1px solid var(--line)' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Total Outstanding</div>
                              <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: g.hasAuthDebt ? 'var(--clay)' : 'var(--ok)' }}>
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
                            <span style={{ fontSize: 12, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease', display: 'inline-block', color: 'var(--muted)', flexShrink: 0 }}>▼</span>
                          </div>
                        </div>

                        {/* Accordion Content — Clean Invoice Table (Section 10 Specification) */}
                        {isExpanded && (
                          <div style={{ padding: '0 20px 16px 20px', background: '#fff' }}>
                            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                              <table className="va-table" style={{ width: '100%', marginTop: 8 }}>
                                <thead>
                                  <tr>
                                    <th>Invoice ID</th>
                                    <th>Date &amp; Time</th>
                                    <th style={{ textAlign: 'right' }}>Invoice Total</th>
                                    <th style={{ textAlign: 'right', color: 'var(--ok)' }}>Paid</th>
                                    <th style={{ textAlign: 'right', color: 'var(--clay)' }}>Remaining</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.items.map(item => {
                                    const isPaid = item.status === 'PAID' || item.remaining <= 0.01;
                                    const isPartial = item.status === 'PARTIALLY PAID';
                                    const statusBadge = isPaid
                                      ? <span className="va-badge" style={{ background: '#E3F9E9', color: '#1B5E20', border: '1px solid #C8E6C9', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>PAID</span>
                                      : isPartial
                                        ? <span className="va-badge" style={{ background: '#FFF3E0', color: '#E65100', border: '1px solid #FFE0B2', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>PARTIALLY PAID</span>
                                        : <span className="va-badge" style={{ background: '#FFEBEE', color: '#C62828', border: '1px solid #FFCDD2', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>UNPAID</span>;
                                    return (
                                      <tr key={item.id}>
                                        <td style={{ fontWeight: 700, color: 'var(--ink)' }}>{item.invoiceNo}</td>
                                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDateTime(item.date)}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(item.total)}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: item.paid > 0 ? 'var(--ok)' : 'var(--muted)' }}>{fmtMoney(item.paid)}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: item.remaining > 0 ? 'var(--clay)' : 'var(--ok)' }}>{fmtMoney(item.remaining)}</td>
                                        <td>{statusBadge}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* ────── PAYMENT HISTORY SECTION (Section 11 Specification) ────── */}
                            {(() => {
                              const todayBDate = getTodayBusinessDateString();
                              const allClientCols = collections
                                .filter(c => c.clientId === g.clientId)
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                              const todayOnwardCols = allClientCols.filter(c => getTodayBusinessDateString(c.date) >= todayBDate);
                              const showAll = !!showAllHistory[g.clientId];
                              const clientCols = showAll ? allClientCols : todayOnwardCols;

                              return (
                                <div style={{ marginTop: 16, borderTop: '2px dashed #CBD5E1', paddingTop: 14 }}>
                                  <div style={{ fontWeight: 800, fontSize: 13, color: '#1E293B', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                    <span>
                                      💳 PAYMENT HISTORY ({clientCols.length} receipt{clientCols.length === 1 ? '' : 's'} {showAll ? '— All History' : '— Today Onward'})
                                    </span>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      {allClientCols.length > todayOnwardCols.length && (
                                        <button
                                          className="va-btn secondary small"
                                          style={{ padding: '2px 8px', fontSize: 11, fontWeight: 700 }}
                                          onClick={() => toggleShowAllHistory(g.clientId)}
                                        >
                                          {showAll ? 'Show Today Only' : `Show All History (${allClientCols.length})`}
                                        </button>
                                      )}
                                      <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Ordered newest-first</span>
                                    </div>
                                  </div>

                                  {clientCols.length === 0 ? (
                                    <div style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', padding: '10px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span>No payment receipts recorded today for this client.</span>
                                      {allClientCols.length > 0 && !showAll && (
                                        <button
                                          className="va-btn secondary small"
                                          style={{ padding: '2px 8px', fontSize: 11, fontWeight: 700 }}
                                          onClick={() => toggleShowAllHistory(g.clientId)}
                                        >
                                          View Older History ({allClientCols.length})
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                                      {clientCols.map((col, idx) => {
                                        const empName = col.receivedByUser?.name || 'Unrecorded (Historical)';
                                        const rawRemBal = col.remainingBalance ?? col.runningBalance ?? 0;
                                        const remBal = Math.abs(rawRemBal) < 0.99 ? 0 : rawRemBal;
                                        const refNo = col.reference || `PAY-${col.id.slice(-6).toUpperCase()}`;

                                        return (
                                          <div key={col.id} style={{ background: '#F8FAFC', border: '1.5px solid #CBD5E1', borderRadius: 10, padding: '12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid #E2E8F0', paddingBottom: 6 }}>
                                              <span style={{ fontWeight: 800, fontSize: 12, color: '#0F172A' }}>
                                                Payment #{clientCols.length - idx}
                                              </span>
                                              <span className="mono" style={{ fontSize: 11, background: '#E2E8F0', color: '#334155', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                                                {refNo}
                                              </span>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: '#64748B', fontWeight: 600 }}>Amount Received:</span>
                                                <strong className="mono" style={{ color: '#166534', fontSize: 14 }}>{fmtMoney(col.amount)}</strong>
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: '#64748B', fontWeight: 600 }}>Date &amp; Time:</span>
                                                <span style={{ fontWeight: 600, color: '#1E293B' }}>{fmtDateTime(col.date)}</span>
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: '#64748B', fontWeight: 600 }}>Payment Method:</span>
                                                <span style={{ fontWeight: 800, textTransform: 'uppercase', color: '#1E40AF', background: '#DBEAFE', padding: '1px 6px', borderRadius: 4, fontSize: 10 }}>{col.method}</span>
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: '#64748B', fontWeight: 600 }}>Received By:</span>
                                                <span style={{ fontWeight: 700, color: '#0F172A' }}>👤 {empName}</span>
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #CBD5E1', paddingTop: 6, marginTop: 2 }}>
                                                <span style={{ color: '#64748B', fontWeight: 700 }}>Remaining Client Due:</span>
                                                <strong className="mono" style={{ color: remBal > 0 ? '#991B1B' : '#166534', fontSize: 13 }}>{fmtMoney(remBal)}</strong>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Total Summary Footer */}
                <div style={{ marginTop: 20, padding: '16px 20px', background: 'rgba(0,0,0,0.02)', borderRadius: 12, border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Total Authoritative Outstanding Receivables</span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--clay)', fontSize: 18 }}>
                    {fmtMoney(clients.filter(c => c.currentBalance > 0).reduce((s, c) => s + c.currentBalance, 0))}
                  </span>
                </div>
              </div>

              {/* ────── MOBILE VIEW (Dedicated Touch Cards from 1420f4713ed5b3ccf5bedf1f3572745b96519aed) ────── */}
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

      {view === 'list' && activeTab === 'daily_history' && (
        <div className="va-panel">
          <div className="va-panel-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>📅 Daily Payment History</h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                Payments received during Business Day <strong>{dailyData?.businessDate || dailyDate}</strong> (5:00 AM Cutoff)
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="va-btn secondary small"
                onClick={() => {
                  if (dailyData) {
                    setDailyPreviewModal(dailyData);
                  } else {
                    showToast('❌ No payment history loaded yet');
                  }
                }}
                disabled={!dailyData || dailyData.transactions?.length === 0}
                style={{ fontWeight: 700 }}
              >
                👁️ Preview Report
              </button>
              <button
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
                style={{ fontWeight: 800, background: '#166534', color: '#FFF' }}
              >
                ⬇️ Download Report
              </button>
            </div>
          </div>

          {/* Business Date Controls & Filter Bar */}
          <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 10, padding: 14, margin: '0 0 16px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Business Date:</label>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={e => { setDailyDate(e.target.value); loadDailyHistory(e.target.value); }}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13, fontWeight: 600 }}
                />
                <button
                  className="va-btn secondary small"
                  style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700 }}
                  onClick={() => { const t = todayInputDate(); setDailyDate(t); loadDailyHistory(t); }}
                >
                  Today
                </button>
                <button
                  className="va-btn secondary small"
                  style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700 }}
                  onClick={() => { const y = dateOffset(-1); setDailyDate(y); loadDailyHistory(y); }}
                >
                  Yesterday
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <select
                  value={dailyMethod}
                  onChange={e => { setDailyMethod(e.target.value); loadDailyHistory(dailyDate, dailyEmployee, e.target.value); }}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12, fontWeight: 600 }}
                >
                  <option value="all">All Payment Methods</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank Transfer</option>
                  <option value="ONLINE">Online</option>
                  <option value="CHEQUE">Cheque</option>
                </select>

                <input
                  placeholder="Search Client or Ref…"
                  value={dailySearch}
                  onChange={e => { setDailySearch(e.target.value); loadDailyHistory(dailyDate, dailyEmployee, dailyMethod, e.target.value); }}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12, width: 160 }}
                />

                <button
                  className="va-btn secondary small"
                  onClick={() => loadDailyHistory()}
                  style={{ padding: '6px 10px' }}
                >
                  ↻ Refresh
                </button>
              </div>
            </div>
          </div>

          {/* Daily Collection Summary Cards */}
          {dailyData && dailyData.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div style={{ background: '#F8FAFC', padding: '12px 14px', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Selected Date</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>{dailyData.businessDate}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>5:00 AM Cutoff</div>
              </div>

              <div style={{ background: '#F8FAFC', padding: '12px 14px', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Total Transactions</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#2563EB', marginTop: 2 }}>{dailyData.summary.totalTransactions}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>Recorded Payments</div>
              </div>

              <div style={{ background: '#F0FDF4', padding: '12px 14px', borderRadius: 10, border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: 11, color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Total Collected</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: '#15803D', marginTop: 2 }}>{fmtMoney(dailyData.summary.totalCollected)}</div>
                <div style={{ fontSize: 10, color: '#16A34A', marginTop: 2 }}>Gross Dues Received</div>
              </div>

              <div style={{ background: '#FFFBEB', padding: '12px 14px', borderRadius: 10, border: '1px solid #FDE68A' }}>
                <div style={{ fontSize: 11, color: '#92400E', fontWeight: 700, textTransform: 'uppercase' }}>Cash Collected</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: '#B45309', marginTop: 4 }}>{fmtMoney(dailyData.summary.cashCollected)}</div>
                <div style={{ fontSize: 10, color: '#D97706', marginTop: 2 }}>Physical Cash</div>
              </div>

              <div style={{ background: '#EFF6FF', padding: '12px 14px', borderRadius: 10, border: '1px solid #BFDBFE' }}>
                <div style={{ fontSize: 11, color: '#1E40AF', fontWeight: 700, textTransform: 'uppercase' }}>Bank / Online</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: '#1D4ED8', marginTop: 4 }}>
                  {fmtMoney((dailyData.summary.bankCollected || 0) + (dailyData.summary.onlineCollected || 0))}
                </div>
                <div style={{ fontSize: 10, color: '#2563EB', marginTop: 2 }}>Direct Transfers</div>
              </div>
            </div>
          )}

          {/* Transactions Table / List */}
          {loadingDaily ? (
            <div style={{ padding: 20 }}><SkeletonTable rows={5} cols={7} /></div>
          ) : !dailyData || dailyData.transactions?.length === 0 ? (
            <div className="va-empty" style={{ padding: 40, textAlign: 'center' }}>
              <div className="big">No payment collections found for {dailyDate}</div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                No collections were recorded during this 5:00 AM business day.
              </p>
            </div>
          ) : (
            <>
              {/* ────── DESKTOP TABLE ────── */}
              <div className="hide-mobile" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Ref / Receipt</th>
                      <th>Time</th>
                      <th>Customer</th>
                      <th>Received By</th>
                      <th>Method</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status / Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyData.transactions.map((tx: any) => (
                      <tr key={tx.id}>
                        <td><span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{tx.reference}</span></td>
                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{tx.time}</td>
                        <td>
                          <strong>{tx.clientName}</strong>
                          {tx.clientId && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>({tx.clientId})</span>}
                        </td>
                        <td style={{ fontWeight: 600 }}>👤 {tx.receivedBy}</td>
                        <td>
                          <span style={{
                            fontSize: 11, fontWeight: 800, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4,
                            background: tx.method === 'CASH' ? '#DCFCE7' : tx.method === 'BANK' ? '#DBEAFE' : '#FEF9C3',
                            color: tx.method === 'CASH' ? '#166534' : tx.method === 'BANK' ? '#1E40AF' : '#854D0E',
                          }}>
                            {tx.method}
                          </span>
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: '#166534', fontSize: 14 }}>
                          {fmtMoney(tx.amount)}
                        </td>
                        <td>
                          <span className="va-badge paid" style={{ fontSize: 10, padding: '2px 6px' }}>VERIFIED</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ────── MOBILE VIEW (Dedicated Payment Cards from 1420f4713ed5b3ccf5bedf1f3572745b96519aed) ────── */}
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
