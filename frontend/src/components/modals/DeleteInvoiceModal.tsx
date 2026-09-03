'use client';

import React, { useState } from 'react';
import Icon from '@mdi/react';
import {
  mdiAlertCircleOutline,
  mdiDelete,
  mdiClose,
  mdiLoading,
  mdiCashCheck,
  mdiPackageVariantClosed,
  mdiBookOpenOutline,
  mdiCancel,
} from '@mdi/js';
import { fmtMoney, fmtDate } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';

export interface DeleteInvoiceModalProps {
  invoice: {
    id: string;
    invoiceNo: string;
    client?: {
      id?: string;
      name?: string;
      clientId?: string | null;
    } | null;
    date: string | Date;
    total: number;
    paid: number;
    balance: number;
    items?: Array<any>;
  };
  onClose: () => void;
  onSuccess: (data: any) => void;
}

export function DeleteInvoiceModal({
  invoice,
  onClose,
  onSuccess,
}: DeleteInvoiceModalProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Stable idempotency key per modal instance to prevent double-click duplicates
  const [idempotencyKey] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `cancel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const hasPayments = (invoice.paid || 0) > 0;
  const itemCount = invoice.items?.length || 0;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const res = await apiFetch(`/api/sales/${invoice.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          reason: reason.trim() || 'Admin cancellation',
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to cancel invoice');
      }

      onSuccess(json);
      onClose();
    } catch (err: any) {
      console.error('[DeleteInvoiceModal] Error:', err);
      setError(err.message || 'Failed to delete/cancel invoice. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        padding: 16,
      }}
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 16,
          width: '100%',
          maxWidth: 520,
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #7F1D1D 0%, #991B1B 100%)',
            color: '#FFFFFF',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon path={mdiDelete} size={1} color="#FECACA" />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Delete / Cancel Invoice</div>
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                Invoice #{invoice.invoiceNo}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              borderRadius: '50%',
              width: 30,
              height: 30,
              color: '#FFFFFF',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon path={mdiClose} size={0.8} />
          </button>
        </div>

        <form onSubmit={handleConfirm} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Metadata Card */}
          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 12,
              padding: '14px 16px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              fontSize: 13,
            }}
          >
            <div>
              <span style={{ color: '#64748B', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Client</span>
              <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                {invoice.client?.name || '—'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                {invoice.client?.clientId || 'WH-0000'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ color: '#64748B', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Invoice Total</span>
              <div style={{ fontWeight: 800, color: '#991B1B', fontSize: 16, marginTop: 2, fontFamily: 'monospace' }}>
                Rs. {fmtMoney(invoice.total)}
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                Date: {fmtDate(invoice.date)}
              </div>
            </div>
          </div>

          {/* Payment Warning Banner */}
          {hasPayments && (
            <div
              style={{
                background: '#FEF3C7',
                border: '1px solid #F59E0B',
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                color: '#92400E',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <Icon path={mdiAlertCircleOutline} size={1} color="#D97706" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Payment Reallocation Notice:</strong> This invoice has{' '}
                <strong>Rs. {fmtMoney(invoice.paid)}</strong> in recorded payments. Cancelling will
                safely release these funds and reallocate them FIFO across remaining unpaid invoices
                or client credit. No payment records will be erased.
              </div>
            </div>
          )}

          {/* Itemized Reversal Summary */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              What will happen:
            </div>
            <div
              style={{
                background: '#FFF5F5',
                border: '1px solid #FECACA',
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 12,
                color: '#991B1B',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon path={mdiPackageVariantClosed} size={0.75} color="#DC2626" />
                <span>Reverse inventory stock deducted by this invoice ({itemCount > 0 ? `${itemCount} products` : 'all products'})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon path={mdiCashCheck} size={0.75} color="#DC2626" />
                <span>Remove <strong>Rs. {fmtMoney(invoice.total)}</strong> from customer's outstanding balance</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon path={mdiBookOpenOutline} size={0.75} color="#DC2626" />
                <span>Create cancellation reversal in Customer Ledger & clean up accounting records</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon path={mdiCancel} size={0.75} color="#DC2626" />
                <span>Mark this invoice status as <strong>CANCELLED</strong> in all sales reports and dashboard</span>
              </div>
            </div>
          </div>

          {/* Cancellation Reason */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              Reason for Cancellation (Optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Created by mistake, duplicate billing, incorrect customer"
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                fontSize: 13,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              style={{
                background: '#FEE2E2',
                border: '1px solid #EF4444',
                color: '#B91C1C',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '10px 16px',
                background: '#F1F5F9',
                color: '#475569',
                border: '1px solid #CBD5E1',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 13,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 2px 6px rgba(220, 38, 38, 0.3)',
                opacity: isSubmitting ? 0.8 : 1,
              }}
            >
              {isSubmitting ? (
                <>
                  <Icon path={mdiLoading} size={0.75} spin />
                  Cancelling...
                </>
              ) : (
                <>
                  <Icon path={mdiDelete} size={0.75} />
                  Confirm Delete
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
