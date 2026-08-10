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
import { mdiCashRegister } from '@mdi/js';

import { loadBrandConfigWithLogo, generateDailyPaymentHistoryHTML, generateTemplateJpgBase64, downloadImage } from '@/utils/documentTemplates';

const DueStatementModal = dynamic(() => import('@/components/modals/DueStatementModal').then(m => m.DueStatementModal), { ssr: false });
const CollectionReceiptModal = dynamic(() => import('@/components/modals/CollectionReceiptModal').then(m => m.CollectionReceiptModal), { ssr: false });
const DailyPaymentHistoryPreviewModal = dynamic(() => import('@/components/modals/DailyPaymentHistoryPreviewModal').then(m => m.DailyPaymentHistoryPreviewModal), { ssr: false });

interface Sale {
  id: string;
  invoiceNo: string;
  clientId: string;
  date: string;
  previousBalance: number;
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

interface Client { id: string; clientId?: string | null; name: string; currentBalance: number; openingBalance: number; }

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
  const [saving,      setSaving]      = useState(false);
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

  const loadDailyHistory = useCallback(async (dateVal?: string, empVal?: string, methodVal?: string, searchVal?: string) => {
    setLoadingDaily(true);
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

      const res = await apiFetch(`/api/collections/daily-history?${params.toString()}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setDailyData(json);
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

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const toggleExpand = (cid: string) => {
    setExpandedClients(prev => ({ ...prev, [cid]: !prev[cid] }));
  };

  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && collections.length === 0) setLoading(true);
    try {
      const [cd, cld, sd] = await Promise.all([
        fetchWithCache<Collection[]>('/api/collections', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<Client[]>('/api/clients?minimal=true', { ttl: TTL_MEDIUM, forceRefresh: isBackground }),
        fetchWithCache<Sale[]>('/api/sales', { ttl: TTL_SHORT, forceRefresh: isBackground }),
      ]);
      if (cd) setCollections(cd);
      if (cld) setClients(cld);
      if (sd) {
        setSales(sd);
        const initialExpanded: { [key: string]: boolean } = {};
        sd.forEach((item: Sale) => {
          initialExpanded[item.clientId] = true;
        });
        setExpandedClients(initialExpanded);
      }
    } catch (err) {
      console.error('collections load error:', err);
    } finally { setLoading(false); }
  }, [collections.length]);

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientId) return showToast('❌ Select a client');
    if (form.amount <= 0 || isNaN(form.amount)) return showToast('❌ Amount must be > 0');
    if (!form.date) return showToast('❌ Date is required');

    setSaving(true);
    try {
      const res = await apiFetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/collections');
        invalidateCache('/api/sales');
        invalidateCache('/api/clients');
        invalidateCache('/api/reports');
        showToast('✅ Payment recorded successfully');

        const clientObj = clients.find(c => c.id === form.clientId);
        setReceiptModal({
          receiptNo: data.data.reference || `PAY-${(data.data.id || '').slice(-6).toUpperCase()}`,
          date: fmtDateTime(data.data.date),
          clientName: clientObj?.name || data.data.client?.name || 'Customer',
          clientId: clientObj?.clientId || undefined,
          phone: (clientObj as any)?.phone || (clientObj as any)?.whatsapp || undefined,
          whatsapp: (clientObj as any)?.whatsapp || (clientObj as any)?.phone || undefined,
          paymentMethod: form.method,
          reference: form.reference || undefined,
          receivedBy: data.data.receivedByUser?.name || undefined,
          previousBalance: data.data.summary?.previousBalance ?? 0,
          currentBillAmount: data.data.summary?.currentBillAmount ?? 0,
          totalPayable: data.data.summary?.totalPayable ?? 0,
          amountReceived: data.data.summary?.amountReceived ?? form.amount,
          remainingBalance: data.data.summary?.remainingBalance ?? 0,
          excessPayment: data.data.summary?.excessPayment ?? 0,
          allocations: (data.data.allocations || []).map((a: any) => ({
            invoiceNo: a.invoiceNo,
            allocatedAmount: a.allocatedAmount,
            remainingBalance: a.remainingBalance,
          })),
          notes: form.notes || undefined,
        });

        setForm({ ...BLANK_FORM });
        await load(true);
        loadDailyHistory(dailyDate);
        setView('list');
      } else {
        showToast(`❌ ${data.error || 'Failed to record payment'}`);
      }
    } catch (err: any) {
      showToast(`❌ ${err.message || 'Network error'}`);
    } finally { setSaving(false); }
  };

  const clientInvoices = sales.filter(s => s.clientId === form.clientId && s.balance > 0);

  // Group sales invoices per client using official invoice fields (Memoized for high-speed rendering)
  const groupedList = useMemo(() => {
    const groupedSales = clients.reduce((acc: { [key: string]: { clientId: string; clientNo: string; clientName: string; dueBalance: number; items: any[] } }, client) => {
      const clientSales = sales.filter(s => s.clientId === client.id);
      if (clientSales.length === 0 && client.currentBalance === 0) return acc;

      const sortedSales = [...clientSales].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let runningDue = client.openingBalance ?? 0;

      const items = sortedSales.map(sale => {
        const isSalePaid          = sale.status === 'PAID' || (sale.balance !== undefined && sale.balance <= 0.99);
        const previousOutstanding = (Math.abs(runningDue) < 0.99) ? 0 : runningDue;
        const currentOrder        = sale.total;
        const totalPayable        = previousOutstanding + currentOrder;
        const collectedAmount     = isSalePaid ? Math.max(sale.paid, currentOrder) : sale.paid;
        const rawDue              = isSalePaid ? 0 : Math.max(0, totalPayable - collectedAmount);
        const dueBalance          = (Math.abs(rawDue) < 0.99) ? 0 : rawDue;
        runningDue                = dueBalance;

        return {
          id:                  sale.id,
          invoiceNo:           sale.invoiceNo,
          date:                sale.date,
          paymentMode:         sale.paymentMode,
          previousOutstanding,
          currentOrder,
          totalPayable,
          payNow:              sale.paid,   // amount paid at checkout time
          collectedAmount,
          dueBalance,
          status:              isSalePaid ? 'PAID' : sale.status,
        };
      });

      acc[client.id] = {
        clientId:   client.id,
        clientNo:   client.clientId || 'WH-0000',
        clientName: client.name,
        dueBalance: client.currentBalance,
        items
      };

      return acc;
    }, {});

    return Object.values(groupedSales).filter(g => g.items.length > 0 || g.dueBalance > 0);
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
          <form onSubmit={handleSave}>
            <div className="va-form-row">
              <div className="va-field">
                <label>Client *</label>
                <select value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value, saleId: '' }))} required>
                  <option value="">— Select Customer —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name} (Outstanding Due: {fmtMoney(c.currentBalance)})</option>)}
                </select>
              </div>
              <div className="va-field">
                <label>Amount Collected (Rs) *</label>
                <input type="number" required min="1" value={form.amount || ''} onChange={e => setForm(p => ({ ...p, amount: +e.target.value }))} placeholder="Enter payment amount" />
              </div>
            </div>

            {/* ────── REAL-TIME PAYMENT & RUNNING BALANCE CALCULATION CARD ────── */}
            {form.clientId && (() => {
              const selectedC = clients.find(c => c.id === form.clientId);
              if (!selectedC) return null;
              const targetSale = form.saleId ? sales.find(s => s.id === form.saleId) : null;
              const prevBal = selectedC.currentBalance ?? 0;
              const currBill = targetSale ? targetSale.balance : 0;
              const totalPayable = Math.max(0, prevBal);
              const amtRec = Math.max(0, Number(form.amount || 0));
              const remBal = Math.max(0, totalPayable - amtRec);
              const excessAmt = Math.max(0, amtRec - totalPayable);

              // Live client-side FIFO calculation
              let unpaidSales = sales
                .filter(s => s.clientId === form.clientId && s.balance > 0 && s.status !== 'CANCELLED')
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

              if (targetSale && targetSale.balance > 0) {
                unpaidSales = [targetSale, ...unpaidSales.filter(s => s.id !== targetSale.id)];
              }

              let remPayment = amtRec;
              const liveAllocations = unpaidSales.map(s => {
                if (remPayment <= 0) return null;
                const toApply = Math.min(remPayment, s.balance);
                const newBal = Math.max(0, s.balance - toApply);
                remPayment -= toApply;
                return {
                  saleId: s.id,
                  invoiceNo: s.invoiceNo,
                  previousBalance: s.balance,
                  allocatedAmount: toApply,
                  remainingBalance: newBal,
                };
              }).filter(Boolean) as Array<{ saleId: string; invoiceNo: string; previousBalance: number; allocatedAmount: number; remainingBalance: number }>;

              return (
                <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 16, margin: '14px 0 16px' }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: '#1E293B', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>📊 Real-Time Financial &amp; Running Balance Summary</span>
                    <span style={{ fontSize: 11, background: '#E2E8F0', padding: '2px 8px', borderRadius: 12, color: '#475569', fontWeight: 700 }}>FIFO Engine</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                    <div style={{ background: '#FFF', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>1. Previous Balance</div>
                      <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: prevBal > 0 ? '#B45309' : '#16A34A', marginTop: 4 }}>
                        {fmtMoney(prevBal)}
                      </div>
                      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>Outstanding before today</div>
                    </div>

                    <div style={{ background: '#FFF', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>2. Current Bill</div>
                      <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: currBill > 0 ? '#2563EB' : '#64748B', marginTop: 4 }}>
                        {fmtMoney(currBill)}
                      </div>
                      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>Selected invoice due</div>
                    </div>

                    <div style={{ background: '#FFF', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>3. Total Payable</div>
                      <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
                        {fmtMoney(totalPayable)}
                      </div>
                      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>Total customer dues</div>
                    </div>

                    <div style={{ background: '#F0FDF4', padding: '10px 12px', borderRadius: 8, border: '1px solid #BBF7D0' }}>
                      <div style={{ fontSize: 10, color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>4. Amount Received</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: '#15803D', marginTop: 4 }}>
                        {fmtMoney(amtRec)}
                      </div>
                      <div style={{ fontSize: 10, color: '#16A34A', marginTop: 2 }}>Payment being received</div>
                    </div>

                    <div style={{ background: remBal > 0 ? '#FFFBEB' : '#F0FDF4', padding: '10px 12px', borderRadius: 8, border: `1px solid ${remBal > 0 ? '#FDE68A' : '#BBF7D0'}` }}>
                      <div style={{ fontSize: 10, color: remBal > 0 ? '#92400E' : '#166534', fontWeight: 700, textTransform: 'uppercase' }}>
                        {excessAmt > 0 ? '5. Advance Credit' : '5. Remaining Balance'}
                      </div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: excessAmt > 0 ? '#15803D' : (remBal > 0 ? '#B45309' : '#16A34A'), marginTop: 4 }}>
                        {excessAmt > 0 ? `+${fmtMoney(excessAmt)}` : fmtMoney(remBal)}
                      </div>
                      <div style={{ fontSize: 10, color: remBal > 0 ? '#D97706' : '#16A34A', marginTop: 2 }}>
                        {excessAmt > 0 ? 'Excess stored as credit' : (remBal === 0 ? 'Fully settled (Rs 0 due)' : 'Customer dues after payment')}
                      </div>
                    </div>
                  </div>

                  {/* Live FIFO Allocation Preview */}
                  {amtRec > 0 && liveAllocations.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #CBD5E1' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6, textTransform: 'uppercase' }}>
                        📍 FIFO Invoice Settlement Preview ({liveAllocations.length} Invoice{liveAllocations.length !== 1 ? 's' : ''})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {liveAllocations.map(alloc => (
                          <div key={alloc.saleId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FFF', padding: '6px 10px', borderRadius: 6, fontSize: 12, border: '1px solid #E2E8F0' }}>
                            <div>
                              <strong style={{ color: '#1E293B' }}>Invoice #{alloc.invoiceNo}</strong>
                              <span style={{ color: '#64748B', marginLeft: 8, fontSize: 11 }}>Due before: {fmtMoney(alloc.previousBalance)}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ color: '#15803D', fontWeight: 700, marginRight: 8 }}>Paying: {fmtMoney(alloc.allocatedAmount)}</span>
                              <span style={{ color: alloc.remainingBalance > 0 ? '#B45309' : '#16A34A', fontWeight: 700, fontSize: 11 }}>
                                ({alloc.remainingBalance > 0 ? `Remaining: ${fmtMoney(alloc.remainingBalance)}` : 'PAID IN FULL'})
                              </span>
                            </div>
                          </div>
                        ))}
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
            <button type="submit" className="va-btn" disabled={saving}>{saving ? 'Saving…' : '✓ Record Payment'}</button>
          </form>
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
              {/* ────── DESKTOP VIEW (original accordion + table) ────── */}
              <div className="hide-mobile">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {groupedList.map(g => {
                    const isExpanded = !!expandedClients[g.clientId];
                    return (
                      <div key={g.clientId} style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                        {/* Accordion Header */}
                        <div
                          onClick={() => toggleExpand(g.clientId)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px',
                            padding: '12px 16px',
                            background: '#f8f9fa',
                            cursor: 'pointer',
                            userSelect: 'none',
                            borderBottom: isExpanded ? '1px solid var(--line)' : 'none',
                            transition: 'background 0.2s ease'
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f1f3f5'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '#f8f9fa'; }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--forest)', display: 'inline-block', flexShrink: 0 }}></span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.clientName}</span>
                            <span style={{ background: '#e9ecef', color: '#495057', borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                              {g.items.length}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
                            <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                              Due: <strong style={{ color: g.dueBalance > 0 ? 'var(--clay)' : 'var(--ok)' }}>{fmtMoney(g.dueBalance)}</strong>
                            </span>
                            {g.dueBalance > 0 && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                                <button className="va-btn secondary small" onClick={() => handleViewDues(g.clientId)} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 700 }}>
                                  View Dues
                                </button>
                                <button className="va-btn small" onClick={() => handleSendDueStatement(g.clientId)} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 700 }}>
                                  Send Due Statement
                                </button>
                              </div>
                            )}
                            <span style={{ fontSize: 12, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease', display: 'inline-block', color: 'var(--muted)', flexShrink: 0 }}>▼</span>
                          </div>
                        </div>

                        {/* Accordion Content — va-table */}
                        {isExpanded && (
                          <div style={{ padding: '0 20px 16px 20px', background: '#fff' }}>
                            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                              <table className="va-table" style={{ width: '100%', marginTop: 8 }}>
                                <thead>
                                  <tr>
                                    <th>Invoice ID</th>
                                    <th>Client ID</th>
                                    <th>Client Name</th>
                                    <th>Invoice Date &amp; Time</th>
                                    <th style={{ textAlign: 'right' }}>Previous Dues</th>
                                    <th style={{ textAlign: 'right' }}>Current Order</th>
                                    <th style={{ textAlign: 'right' }}>Total Payable</th>
                                    <th style={{ textAlign: 'right', color: 'var(--ok)' }}>Pay Now</th>
                                    <th style={{ textAlign: 'right', color: 'var(--ok)' }}>Collected</th>
                                    <th style={{ textAlign: 'right', color: 'var(--clay)' }}>Due Balance</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.items.map(item => {
                                    const isPaid    = item.status === 'PAID' || item.dueBalance <= 0;
                                    const isPartial = !isPaid && (item.dueBalance > 0 || item.collectedAmount > 0);
                                    const statusBadge = isPaid
                                      ? <span className="va-badge" style={{ background: '#E3F9E9', color: '#1B5E20', border: '1px solid #C8E6C9', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Paid</span>
                                      : isPartial
                                        ? <span className="va-badge" style={{ background: '#FFF3E0', color: '#E65100', border: '1px solid #FFE0B2', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Partial</span>
                                        : <span className="va-badge" style={{ background: '#FFEBEE', color: '#C62828', border: '1px solid #FFCDD2', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Unpaid</span>;
                                    return (
                                      <tr key={item.id}>
                                        <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{item.invoiceNo}</td>
                                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{g.clientNo}</td>
                                        <td style={{ fontWeight: 600 }}>{g.clientName}</td>
                                        <td style={{ color: 'var(--muted)' }}>{fmtDateTime(item.date)}</td>
                                        <td className="mono" style={{ textAlign: 'right', color: item.previousOutstanding > 0.99 ? 'var(--clay)' : 'var(--muted)' }}>{item.previousOutstanding > 0.99 ? fmtMoney(item.previousOutstanding) : 'Rs 0'}</td>
                                        <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtMoney(item.currentOrder)}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(item.totalPayable)}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: item.payNow > 0 ? 'var(--ok)' : 'var(--muted)' }}>{item.payNow > 0 ? fmtMoney(item.payNow) : '—'}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: item.collectedAmount > 0 ? 'var(--ok)' : 'var(--muted)' }}>{fmtMoney(item.collectedAmount)}</td>
                                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: (item.dueBalance > 0.99 && !isPaid) ? 'var(--clay)' : 'var(--ok)' }}>{(item.dueBalance > 0.99 && !isPaid) ? fmtMoney(item.dueBalance) : '✓ 0'}</td>
                                        <td>{statusBadge}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                               </table>
                             </div>

                             {/* ────── PAYMENT HISTORY SECTION (Today Onward By Default) ────── */}
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
                                                 <span style={{ color: '#64748B', fontWeight: 700 }}>Remaining Balance:</span>
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
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Total Outstanding Receivables</span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--clay)', fontSize: 18 }}>
                    {fmtMoney(clients.filter(c => c.currentBalance > 0).reduce((s, c) => s + c.currentBalance, 0))}
                  </span>
                </div>
              </div>

              {/* ────── MOBILE VIEW (standardized green card style) ────── */}
              <div className="show-mobile" style={{ flexDirection: 'column', gap: 12, width: '100%' }}>
                {groupedList.map(g => {
                  const isExpanded = !!expandedClients[g.clientId];
                  return (
                    <MobileCard
                      key={g.clientId}
                      title={g.clientName}
                      headerBadge={g.clientNo}
                      footer={
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                          <button
                            className="va-btn small"
                            style={{ flex: 1, fontWeight: 700 }}
                            onClick={() => toggleExpand(g.clientId)}
                          >
                            {isExpanded ? 'Hide Invoices' : 'View Invoices'}
                          </button>
                          {g.dueBalance > 0 && (
                            <>
                              <button
                                className="va-btn secondary small"
                                style={{ flex: 1, fontWeight: 700 }}
                                onClick={() => handleSendDueStatement(g.clientId)}
                              >
                                📋 Statement
                              </button>
                              <button
                                className="va-btn secondary small"
                                style={{ flex: 1, fontWeight: 700 }}
                                onClick={() => handleViewDues(g.clientId)}
                              >
                                💳 Dues
                              </button>
                            </>
                          )}
                        </div>
                      }
                    >
                      <MobileCardRow label="Total Invoices" value={`${g.items.length} invoices`} />
                      <MobileCardRow 
                        label="Total Due Balance" 
                        value={fmtMoney(g.dueBalance)} 
                        valueColor={g.dueBalance > 0 ? '#991B1B' : '#166534'} 
                        isMono 
                      />

                      {/* Expandable Invoice Cards */}
                      {isExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                          {g.items.map(item => {
                            const isPaid     = item.dueBalance <= 0;
                            const isPartial  = item.dueBalance > 0 && item.collectedAmount > 0;
                            const statusVariant = isPaid ? 'green' : isPartial ? 'yellow' : 'red';
                            const statusLabel = isPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'UNPAID';

                            return (
                              <MobileCardBox
                                key={item.id}
                                title={
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                    <span className="mono" style={{ fontWeight: 700, fontSize: '13px', color: '#0F172A' }}>
                                      {item.invoiceNo}
                                    </span>
                                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>
                                      {fmtDateTime(item.date)}
                                    </span>
                                  </div>
                                }
                                bg="#F8FAFC"
                                borderColor="#CBD5E1"
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
                                  <MobileCardRow label="Total Payable" value={fmtMoney(item.totalPayable)} isMono />
                                  <MobileCardRow label="Collected Amount" value={fmtMoney(item.collectedAmount)} valueColor="#166534" isMono />
                                  <MobileCardRow 
                                    label="Remaining Balance" 
                                    value={fmtMoney(item.dueBalance)} 
                                    valueColor={item.dueBalance > 0 ? '#991B1B' : '#166534'} 
                                    isMono 
                                  />
                                  <MobileCardRow label="Status">
                                    <MobileCardBadge variant={statusVariant}>
                                      {statusLabel}
                                    </MobileCardBadge>
                                  </MobileCardRow>
                                </div>
                              </MobileCardBox>
                            );
                          })}
                        </div>
                      )}

                      {/* Mobile Payment History Section */}
                      {isExpanded && (() => {
                        const todayBDate = getTodayBusinessDateString();
                        const allClientCols = collections
                          .filter(c => c.clientId === g.clientId)
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                        const todayOnwardCols = allClientCols.filter(c => getTodayBusinessDateString(c.date) >= todayBDate);
                        const showAll = !!showAllHistory[g.clientId];
                        const clientCols = showAll ? allClientCols : todayOnwardCols;

                        return (
                          <div style={{ marginTop: 12, borderTop: '1px dashed #CBD5E1', paddingTop: 10 }}>
                            <div style={{ fontWeight: 800, fontSize: 12, color: '#1E293B', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <span>💳 PAYMENT HISTORY ({clientCols.length} {showAll ? '— All' : '— Today Onward'})</span>
                              {allClientCols.length > todayOnwardCols.length && (
                                <button
                                  className="va-btn secondary small"
                                  style={{ padding: '2px 6px', fontSize: 10, fontWeight: 700 }}
                                  onClick={() => toggleShowAllHistory(g.clientId)}
                                >
                                  {showAll ? 'Today Only' : `Show All (${allClientCols.length})`}
                                </button>
                              )}
                            </div>

                            {clientCols.length === 0 ? (
                              <div style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic', padding: '8px 10px', background: '#F8FAFC', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>No payment receipts recorded today.</span>
                                {allClientCols.length > 0 && !showAll && (
                                  <button
                                    className="va-btn secondary small"
                                    style={{ padding: '2px 6px', fontSize: 10, fontWeight: 700 }}
                                    onClick={() => toggleShowAllHistory(g.clientId)}
                                  >
                                    View Older ({allClientCols.length})
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {clientCols.map((col, idx) => {
                                  const empName = col.receivedByUser?.name || 'Unrecorded (Historical)';
                                  const rawRemBal = col.remainingBalance ?? col.runningBalance ?? 0;
                                  const remBal = Math.abs(rawRemBal) < 0.99 ? 0 : rawRemBal;
                                  const refNo = col.reference || `PAY-${col.id.slice(-6).toUpperCase()}`;

                                  return (
                                    <MobileCardBox key={col.id} bg="#F8FAFC" borderColor="#CBD5E1">
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                        <span style={{ fontWeight: 800, fontSize: 11, color: '#0F172A' }}>Payment #{clientCols.length - idx}</span>
                                        <span className="mono" style={{ fontSize: 10, background: '#E2E8F0', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{refNo}</span>
                                      </div>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                                        <MobileCardRow label="Amount Received" value={fmtMoney(col.amount)} valueColor="#166534" isMono />
                                        <MobileCardRow label="Date & Time" value={fmtDateTime(col.date)} />
                                        <MobileCardRow label="Method" value={col.method} />
                                        <MobileCardRow label="Received By" value={`👤 ${empName}`} />
                                        <MobileCardRow label="Remaining Balance" value={fmtMoney(remBal)} valueColor={remBal > 0 ? '#991B1B' : '#166534'} isMono />
                                      </div>
                                    </MobileCardBox>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </MobileCard>
                  );
                })}

                {/* Mobile Total Summary Footer */}
                <div style={{
                  padding: '16px',
                  background: 'rgba(0,0,0,0.03)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Total Outstanding</span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--clay)', fontSize: '16px' }}>
                    {fmtMoney(clients.filter(c => c.currentBalance > 0).reduce((s, c) => s + c.currentBalance, 0))}
                  </span>
                </div>
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
              {/* Desktop Table View */}
              <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                <table className="va-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: 'center' }}>#</th>
                      <th>Time</th>
                      <th>Client Name</th>
                      <th>Client ID</th>
                      <th>Invoice / Reference</th>
                      <th style={{ textAlign: 'center' }}>Method</th>
                      <th>Received By</th>
                      <th style={{ textAlign: 'right' }}>Amount Received</th>
                      <th style={{ textAlign: 'right' }}>Balance After Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyData.transactions.map((tx: any) => {
                      const mUpper = (tx.method || 'CASH').toUpperCase();
                      const isCash = mUpper === 'CASH';
                      const rawBal = tx.remainingBalance;
                      const remBal = (rawBal !== null && rawBal !== undefined && Math.abs(rawBal) < 0.99) ? 0 : rawBal;

                      return (
                        <tr key={tx.id}>
                          <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{tx.seqNo}</td>
                          <td style={{ fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{tx.time}</td>
                          <td style={{ fontWeight: 700, color: '#0F172A' }}>{tx.clientName}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{tx.clientCode}</td>
                          <td style={{ fontWeight: 600, color: '#334155' }}>{tx.invoiceNo}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              background: isCash ? '#E6F4EA' : '#E8F0FE',
                              color: isCash ? '#137333' : '#1A73E8',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 800,
                              textTransform: 'uppercase'
                            }}>
                              {tx.method}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, color: '#1E293B' }}>👤 {tx.receivedBy}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: '#166534', fontSize: 14 }}>
                            {fmtMoney(tx.amount)}
                          </td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: (remBal ?? 0) > 0 ? '#991B1B' : '#166534' }}>
                            {remBal !== null && remBal !== undefined ? fmtMoney(remBal) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="show-mobile" style={{ flexDirection: 'column', gap: 10, width: '100%' }}>
                {dailyData.transactions.map((tx: any) => {
                  const mUpper = (tx.method || 'CASH').toUpperCase();
                  const rawBal = tx.remainingBalance;
                  const remBal = (rawBal !== null && rawBal !== undefined && Math.abs(rawBal) < 0.99) ? 0 : rawBal;

                  return (
                    <MobileCardBox key={tx.id} bg="#FFF" borderColor="#CBD5E1">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontWeight: 800, fontSize: 13, color: '#0F172A' }}>{tx.clientName}</span>
                        <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>{tx.time}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                        <MobileCardRow label="Client ID" value={tx.clientCode} />
                        <MobileCardRow label="Invoice / Ref" value={tx.invoiceNo} />
                        <MobileCardRow label="Payment Method" value={mUpper} />
                        <MobileCardRow label="Received By" value={`👤 ${tx.receivedBy}`} />
                        <MobileCardRow label="Amount Received" value={fmtMoney(tx.amount)} valueColor="#166534" isMono />
                        {remBal !== null && remBal !== undefined && (
                          <MobileCardRow
                            label="Balance After Payment"
                            value={fmtMoney(remBal)}
                            valueColor={remBal > 0 ? '#991B1B' : '#166534'}
                            isMono
                          />
                        )}
                      </div>
                    </MobileCardBox>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {dailyPreviewModal && (
        <DailyPaymentHistoryPreviewModal
          data={dailyPreviewModal}
          onClose={() => setDailyPreviewModal(null)}
          onToast={showToast}
        />
      )}

      {statementClient && (
        <DueStatementModal
          client={statementClient}
          invoices={statementInvoices}
          mode={statementMode}
          onClose={() => setStatementClient(null)}
        />
      )}
      {receiptModal && (
        <CollectionReceiptModal
          data={receiptModal}
          onClose={() => setReceiptModal(null)}
          onToast={showToast}
        />
      )}
    </DashboardLayout>
  );
}
