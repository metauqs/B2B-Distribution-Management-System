'use client';

import { useState, useEffect, useCallback } from 'react';
import { todayStr } from '@/utils/formatters';

// ─── Types — mirroring original state shape exactly ───────────────────────────
export interface SaleItem     { veg: string; qty: number; unit: string; rate: number; amount: number; }
export interface PurchaseItem { veg: string; qty: number; unit: string; rate: number; }
export interface WastageItem  { id: string; veg: string; qty: number; unit: string; date: string; }

export interface Client   { id: string; name: string; phone?: string; address?: string; openingBalance: number; }
export interface Supplier { id: string; name: string; phone?: string; }
export interface Sale     {
  id: string; clientId: string; date: string; total: number;
  items: SaleItem[]; billNo?: string;
  deliveryStatus?: 'pending' | 'out' | 'delivered';
  orderedAt?: number; deliveredAt?: number;
  notes?: string;
}
export interface Purchase { id: string; supplier: string; date: string; total: number; items: PurchaseItem[]; notes?: string; }
export interface Collection { id: string; clientId: string; date: string; amount: number; notes?: string; }
export interface Expense  { id: string; date: string; amount: number; category: string; description?: string; }
export interface PriceList { id: string; veg: string; unit: string; rate: number; date: string; }

export interface LedgerState {
  clients:     Client[];
  suppliers:   Supplier[];
  purchases:   Purchase[];
  sales:       Sale[];
  collections: Collection[];
  expenses:    Expense[];
  wastage:     WastageItem[];
  priceList:   PriceList[];
  business:    { name: string; phone: string; address: string };
  loaded:      boolean;
}

// ─── UID generator — same as original ────────────────────────────────────────
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── localStorage keys — same prefix as original ─────────────────────────────
const LS_PREFIX = 'veggie-ledger:';
const KEYS = ['clients','suppliers','purchases','sales','collections','expenses','wastage','priceList'] as const;

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function lsSet(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* noop */ }
}

// ─── Central hook ─────────────────────────────────────────────────────────────
/**
 * @deprecated This hook calculates balances from localStorage independently of the backend.
 * Use API-backed data from Redux store/services instead.
 * Scheduled for removal in the next major release.
 */
export function useLedger() {
  if (typeof window !== 'undefined') {
    console.warn(
      '[DEPRECATED] useLedger hook is deprecated. All balance, stock, and profit calculations ' +
      'should use the backend API as the single source of truth. This hook will be removed in a future release.'
    );
  }

  const [state, setState] = useState<LedgerState>({
    clients: [], suppliers: [], purchases: [], sales: [],
    collections: [], expenses: [], wastage: [], priceList: [],
    business: { name: 'Sabzi Ledger', phone: '', address: '' },
    loaded: false,
  });

  // Load from localStorage on mount
  useEffect(() => {
    setState({
      clients:     lsGet('clients', []),
      suppliers:   lsGet('suppliers', []),
      purchases:   lsGet('purchases', []),
      sales:       lsGet('sales', []),
      collections: lsGet('collections', []),
      expenses:    lsGet('expenses', []),
      wastage:     lsGet('wastage', []),
      priceList:   lsGet('priceList', []),
      business:    lsGet('business', { name: 'Sabzi Ledger', phone: '', address: '' }),
      loaded: true,
    });
  }, []);

  // Save a specific key and update state
  const save = useCallback(<K extends keyof LedgerState>(key: K, value: LedgerState[K]) => {
    lsSet(key as string, value);
    setState(prev => ({ ...prev, [key]: value }));
  }, []);

  // ─── Derived: client balance ──────────────────────────────────
  const clientBalance = useCallback((clientId: string) => {
    const c = state.clients.find(x => x.id === clientId);
    const opening = (c && +c.openingBalance) || 0;
    const billed  = state.sales.filter(s => s.clientId === clientId).reduce((a, s) => a + s.total, 0);
    const paid    = state.collections.filter(col => col.clientId === clientId).reduce((a, c) => a + c.amount, 0);
    return opening + billed - paid;
  }, [state.clients, state.sales, state.collections]);

  // ─── Derived: stock levels ────────────────────────────────────
  const stockLevels = useCallback(() => {
    const map: Record<string, { veg: string; unit: string; purchased: number; sold: number; wasted: number }> = {};
    state.purchases.forEach(p => p.items.forEach(it => {
      if (!map[it.veg]) map[it.veg] = { veg: it.veg, unit: it.unit, purchased: 0, sold: 0, wasted: 0 };
      map[it.veg].purchased += it.qty;
    }));
    state.sales.forEach(s => s.items.forEach(it => {
      if (!map[it.veg]) map[it.veg] = { veg: it.veg, unit: it.unit, purchased: 0, sold: 0, wasted: 0 };
      map[it.veg].sold += it.qty;
    }));
    state.wastage.forEach(w => {
      if (!map[w.veg]) map[w.veg] = { veg: w.veg, unit: w.unit, purchased: 0, sold: 0, wasted: 0 };
      map[w.veg].wasted += w.qty;
    });
    return Object.values(map).map(v => ({
      ...v,
      closing: +(v.purchased - v.sold - v.wasted).toFixed(2),
    }));
  }, [state.purchases, state.sales, state.wastage]);

  // ─── Derived: today totals ────────────────────────────────────
  const todayTotals = useCallback((date: string = todayStr()) => {
    const purchases   = state.purchases.filter(p => p.date === date).reduce((a, p) => a + p.total, 0);
    const sales       = state.sales.filter(s => s.date === date).reduce((a, s) => a + s.total, 0);
    const expenses    = state.expenses.filter(e => e.date === date).reduce((a, e) => a + e.amount, 0);
    const collections = state.collections.filter(c => c.date === date).reduce((a, c) => a + c.amount, 0);
    return { purchases, sales, expenses, collections, profit: sales - purchases - expenses };
  }, [state.purchases, state.sales, state.expenses, state.collections]);

  // ─── Derived: total receivables ───────────────────────────────
  const totalReceivables = useCallback(() => {
    return state.clients.reduce((a, c) => a + Math.max(0, clientBalance(c.id)), 0);
  }, [state.clients, clientBalance]);

  // ─── CRUD helpers ─────────────────────────────────────────────
  const addRecord = useCallback(<K extends keyof LedgerState>(
    key: K,
    record: LedgerState[K] extends Array<infer R> ? R : never
  ) => {
    const arr = [...(state[key] as unknown[]), record] as LedgerState[K];
    save(key, arr);
  }, [state, save]);

  const deleteRecord = useCallback(<K extends keyof LedgerState>(key: K, id: string) => {
    const arr = (state[key] as Array<{ id: string }>).filter(x => x.id !== id) as LedgerState[K];
    save(key, arr);
  }, [state, save]);

  const updateRecord = useCallback(<K extends keyof LedgerState>(
    key: K,
    id: string,
    patch: Partial<LedgerState[K] extends Array<infer R> ? R : never>
  ) => {
    const arr = (state[key] as Array<{ id: string }>).map(x =>
      x.id === id ? { ...x, ...patch } : x
    ) as LedgerState[K];
    save(key, arr);
  }, [state, save]);

  // ─── Unique veg names from priceList (for chips) ──────────────
  const vegNames = useCallback(() => {
    const names = new Set<string>();
    state.priceList.forEach(p => names.add(p.veg));
    return Array.from(names).sort();
  }, [state.priceList]);

  // ─── Next bill number ─────────────────────────────────────────
  const nextBillNo = useCallback(() => {
    return `#${String(state.sales.length + 1).padStart(4, '0')}`;
  }, [state.sales.length]);

  return {
    state,
    save,
    clientBalance,
    stockLevels,
    todayTotals,
    totalReceivables,
    addRecord,
    deleteRecord,
    updateRecord,
    vegNames,
    nextBillNo,
  };
}
