'use client';

import React from 'react';
import { fmtMoney, fmtDateTime } from '@/utils/formatters';

interface SaleItem {
  id: string;
  itemName: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}

interface Sale {
  id: string;
  invoiceNo: string;
  date: string;
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  paid: number;
  balance: number;
  paymentMode: string;
  status: string;
  deliveryStatus: string;
  notes?: string | null;
  client?: {
    id: string;
    name: string;
    phone?: string | null;
    whatsapp?: string | null;
    address?: string | null;
    deliveryLocation?: string | null;
    type: string;
  } | null;
  items: SaleItem[];
}

interface MobileInvoiceCardProps {
  sale: Sale;
  onView: () => void;
}

export function MobileInvoiceCard({ sale, onView }: MobileInvoiceCardProps) {
  return (
    <div className="bg-[#4A7C59] border border-[#5b8e6a] rounded-2xl p-5 shadow-[0_4px_12px_rgba(0,0,0,0.05)] flex flex-col gap-4 w-full">
      {/* First Row */}
      <div className="flex justify-between items-center gap-4">
        <div className="text-base font-bold text-white leading-tight" style={{ color: '#FFFFFF' }}>
          {sale.client?.name ?? 'Anonymous Client'}
        </div>
        <span className="text-xs text-emerald-100 shrink-0 font-medium">
          {fmtDateTime(sale.date)}
        </span>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/20 w-full" />

      {/* Information Section in clean two-column layout */}
      <div className="flex flex-col gap-2.5 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-emerald-100 font-medium">Invoice ID</span>
          <span className="font-mono font-bold text-white">{sale.invoiceNo}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-emerald-100 font-medium">Items</span>
          <span className="font-semibold text-white">{sale.items.length}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-emerald-100 font-medium">Total</span>
          <span className="font-bold text-white text-base">Rs {sale.total.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-emerald-100 font-medium">Balance</span>
          <span className={`font-bold ${sale.balance > 0 ? 'text-[#FFD1D1]' : 'text-emerald-50'}`}>
            Rs {sale.balance.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/20 w-full" />

      {/* Action Button at bottom */}
      <button
        onClick={onView}
        className="w-full py-2.5 text-center text-sm font-bold bg-transparent border border-white text-white rounded-xl hover:bg-white/10 active:scale-[0.98] transition-all cursor-pointer"
      >
        Details
      </button>
    </div>
  );
}
