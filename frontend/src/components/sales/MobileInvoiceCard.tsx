'use client';

import React from 'react';
import { fmtMoney, fmtDateTime } from '@/utils/formatters';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';

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
  const isPaid = sale.balance <= 0;
  const isPartial = sale.paid > 0 && sale.balance > 0;

  return (
    <MobileCard
      title={sale.client?.name ?? 'Anonymous Client'}
      headerBadge={fmtDateTime(sale.date)}
      footer={
        <button
          onClick={onView}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
            color: '#FFFFFF',
            fontWeight: 700,
            borderRadius: '10px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(22, 163, 74, 0.25)',
          }}
        >
          👁️ View Invoice Details
        </button>
      }
    >
      <MobileCardRow label="Invoice ID" value={sale.invoiceNo} isMono />
      <MobileCardRow label="Total Amount" value={fmtMoney(sale.total)} valueColor="#0F172A" isMono />
      <MobileCardRow label="Paid Amount" value={fmtMoney(sale.paid)} valueColor="#166534" isMono />
      <MobileCardRow 
        label="Balance Due" 
        value={fmtMoney(sale.balance)} 
        valueColor={sale.balance > 0 ? '#991B1B' : '#166534'} 
        isMono 
      />
      <MobileCardRow label="Payment Status">
        <MobileCardBadge variant={isPaid ? 'green' : isPartial ? 'yellow' : 'red'}>
          {isPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'UNPAID'}
        </MobileCardBadge>
      </MobileCardRow>
      <MobileCardRow label="Items Count" value={`${sale.items.length} items`} />
    </MobileCard>
  );
}
