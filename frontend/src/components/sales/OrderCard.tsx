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

interface OrderCardProps {
  sale: Sale;
  onView: () => void;
  onPrint: () => void;
  onWhatsApp: () => void;
}

export function OrderCard({ sale, onView, onPrint, onWhatsApp }: OrderCardProps) {
  // Status color helpers conforming to user instructions:
  // Green for Paid, Yellow for Pending, Purple for Partial, Red for Cancelled/Credit, Neutral Gray otherwise.
  const getPaymentStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'PAID') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50">
          ● Paid
        </span>
      );
    }
    if (s === 'PARTIAL') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-900/50">
          ● Partial
        </span>
      );
    }
    if (s === 'CANCELLED' || s === 'CREDIT') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50">
          ● Cancelled
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50">
        ● Pending
      </span>
    );
  };

  const getPaymentModeBadge = (mode: string) => {
    const m = mode.toUpperCase();
    if (m === 'CASH') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30">
          💵 Cash
        </span>
      );
    }
    if (m === 'CREDIT') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
          📒 Credit
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
        {mode}
      </span>
    );
  };

  const getDeliveryStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'DELIVERED') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30">
          Delivered
        </span>
      );
    }
    if (s === 'OUT_FOR_DELIVERY' || s === 'DISPATCHED') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border border-purple-100 dark:border-purple-900/30">
          Dispatched
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
        Pending
      </span>
    );
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-all duration-200 flex flex-col gap-4 w-full">
      {/* Header Row */}
      <div className="flex justify-between items-start pb-3 border-b border-dashed border-gray-100 dark:border-zinc-800">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">
            Order ID / Invoice
          </span>
          <span className="text-sm font-bold text-gray-800 dark:text-zinc-200 font-mono tracking-tight">
            {sale.invoiceNo}
          </span>
        </div>
        <div>
          {getPaymentStatusBadge(sale.status)}
        </div>
      </div>

      {/* Main Section */}
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-bold text-gray-950 dark:text-white leading-tight">
          {sale.client?.name ?? 'Anonymous Client'}
        </h3>
        <div className="flex flex-col gap-1 mt-1.5 text-xs text-gray-500 dark:text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400 dark:text-zinc-500">📍</span>
            <span className="truncate">
              {sale.client?.deliveryLocation || sale.client?.address || 'No location set'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400 dark:text-zinc-500">📅</span>
            <span>
              {fmtDateTime(sale.date)}
            </span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-gray-50 dark:bg-zinc-800/80 w-full" />

      {/* Information Grid */}
      <div className="grid grid-cols-2 gap-y-3 gap-x-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 dark:text-zinc-500 uppercase font-semibold">Items Count</span>
          <span className="text-xs font-bold text-gray-700 dark:text-zinc-300">
            {sale.items.length} items
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 dark:text-zinc-500 uppercase font-semibold">Payment Mode</span>
          <div>
            {getPaymentModeBadge(sale.paymentMode)}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 dark:text-zinc-500 uppercase font-semibold">Order Status</span>
          <div>
            {getDeliveryStatusBadge(sale.deliveryStatus)}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 dark:text-zinc-500 uppercase font-semibold">Balance Due</span>
          <span className={`text-xs font-bold ${sale.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500'}`}>
            {sale.balance > 0 ? fmtMoney(sale.balance) : 'Rs 0'}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-gray-50 dark:bg-zinc-800/80 w-full" />

      {/* Prominent Amount & Actions Footer */}
      <div className="flex justify-between items-center mt-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 dark:text-zinc-500 uppercase font-bold tracking-wider">
            Total Amount
          </span>
          <span className="text-xl font-black text-emerald-800 dark:text-emerald-400 tracking-tight">
            Rs {sale.total.toLocaleString()}
          </span>
        </div>

        {/* Action Button Row */}
        <div className="flex gap-2">
          {/* View Details (Primary) */}
          <button
            onClick={onView}
            className="px-3.5 py-2 text-xs font-bold bg-emerald-50 hover:bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/50 rounded-xl transition-all active:scale-95 cursor-pointer"
          >
            View Details
          </button>
          
          {/* Print Invoice (Secondary) */}
          <button
            onClick={onPrint}
            title="Print Invoice"
            className="p-2 text-xs font-semibold bg-gray-50 hover:bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300 border border-gray-200 dark:border-zinc-700 rounded-xl transition-all active:scale-95 cursor-pointer"
          >
            🖨️
          </button>

          {/* WhatsApp Action */}
          <button
            onClick={onWhatsApp}
            title="Share via WhatsApp"
            className="p-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all active:scale-95 cursor-pointer"
          >
            📲
          </button>
        </div>
      </div>
    </div>
  );
}
