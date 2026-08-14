'use client';

import React, { useEffect, useState } from 'react';
import Icon from '@mdi/react';
import {
  mdiAlert,
  mdiArchive,
  mdiDelete,
  mdiFileDocument,
  mdiCash,
  mdiTruck,
  mdiBookOpen,
  mdiClose,
  mdiLoading
} from '@mdi/js';
import { fmtMoney } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';

interface DeleteSummary {
  id: string;
  clientId: string;
  name: string;
  ownerName?: string | null;
  phone?: string | null;
  status: string;
  isArchived: boolean;
  openingBalance: number;
  currentBalance: number;
  invoiceCount: number;
  totalInvoiceValue: number;
  collectionCount: number;
  totalCollected: number;
  ledgerCount: number;
  deliveryCount: number;
  chequeCount: number;
  hasTransactions: boolean;
  allowedAction: 'ARCHIVE' | 'HARD_DELETE' | 'PERMANENT_DELETE';
  message: string;
}

interface DeleteClientModalProps {
  clientId: string;
  clientName: string;
  clientCode?: string | null;
  isPermanentPurge?: boolean;
  onClose: () => void;
  onSuccess: (action: 'ARCHIVE' | 'HARD_DELETE' | 'PERMANENT_DELETE', message: string) => void;
}

export function DeleteClientModal({
  clientId,
  clientName,
  clientCode,
  isPermanentPurge = false,
  onClose,
  onSuccess
}: DeleteClientModalProps) {
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summary, setSummary] = useState<DeleteSummary | null>(null);
  const [error, setError] = useState('');
  const [inputPhrase, setInputPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadSummary() {
      setLoadingSummary(true);
      setError('');
      try {
        const res = await apiFetch(`/api/clients/${clientId}/delete-summary`);
        const json = await res.json();
        if (!isMounted) return;
        if (res.ok && json.success) {
          setSummary(json.data);
        } else {
          setError(json.error || 'Failed to load client record summary');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setError(err.message || 'Network error loading summary');
      } finally {
        if (isMounted) setLoadingSummary(false);
      }
    }

    loadSummary();
    return () => { isMounted = false; };
  }, [clientId]);

  const isPurgeMode = isPermanentPurge || (summary?.isArchived && summary?.hasTransactions);
  const requiredPhrase = isPurgeMode ? 'DELETE PERMANENTLY' : (summary?.hasTransactions ? 'ARCHIVE' : 'DELETE');
  const isPhraseMatching = inputPhrase.trim().toUpperCase() === requiredPhrase;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPhraseMatching || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const res = await apiFetch(`/api/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmationPhrase: inputPhrase.trim(),
          reason: reason.trim() || undefined,
          permanent: isPurgeMode
        })
      });

      const json = await res.json();
      if (res.ok && json.success) {
        onSuccess(json.action || (isPurgeMode ? 'PERMANENT_DELETE' : summary?.hasTransactions ? 'ARCHIVE' : 'HARD_DELETE'), json.message);
      } else {
        setError(json.error || 'Failed to complete client deletion/archival');
        setIsSubmitting(false);
      }
    } catch (err: any) {
      setError(err.message || 'Network error executing request');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 16
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--paper, #fff)',
          borderRadius: 12,
          maxWidth: 540,
          width: '100%',
          boxShadow: '0 20px 40px rgba(0,0,0,0.24)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--line, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: isPurgeMode ? '#FEF2F2' : summary?.hasTransactions ? '#FFF8E6' : '#FFF0F0'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: isPurgeMode ? '#FEE2E2' : summary?.hasTransactions ? '#FFEAA7' : '#FFD2D2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isPurgeMode ? '#991B1B' : summary?.hasTransactions ? '#D97706' : '#DC2626'
              }}
            >
              <Icon
                path={isPurgeMode ? mdiDelete : summary?.hasTransactions ? mdiArchive : mdiAlert}
                size={0.9}
              />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1a202c' }}>
                {isPurgeMode
                  ? 'Permanently Delete Archived Client'
                  : summary?.hasTransactions
                  ? 'Archive Client Profile'
                  : 'Delete Client Profile'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#718096' }}>
                {isPurgeMode
                  ? 'Irreversible database purge of client & records'
                  : summary?.hasTransactions
                  ? 'Preserve financial history & deactivate'
                  : 'Permanent deletion of empty account'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              color: '#a0aec0',
              padding: 4
            }}
          >
            <Icon path={mdiClose} size={0.9} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                background: '#FDE8E8',
                color: '#9B1C1C',
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 16,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <Icon path={mdiAlert} size={0.7} color="#9B1C1C" />
              <span>{error}</span>
            </div>
          )}

          {/* Client Target Banner */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 8,
              background: 'var(--panel, #f8fafc)',
              border: '1px solid var(--line, #e2e8f0)',
              marginBottom: 16
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted, #718096)', letterSpacing: 0.5 }}>
              Target Client
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #1a202c)' }}>{clientName}</span>
              <span style={{ fontSize: 12, fontWeight: 600, background: '#e2e8f0', padding: '2px 8px', borderRadius: 4, color: '#4a5568' }}>
                {clientCode || 'WH-0000'}
              </span>
            </div>
          </div>

          {loadingSummary ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)' }}>
              <Icon path={mdiLoading} size={1.5} spin />
              <p style={{ marginTop: 8, fontSize: 13 }}>Auditing client transaction history...</p>
            </div>
          ) : summary ? (
            <>
              {/* Financial & Operational Summary */}
              <div
                style={{
                  border: '1px solid var(--line, #e2e8f0)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  marginBottom: 16,
                  fontSize: 13
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'var(--panel, #f1f5f9)',
                    fontWeight: 700,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: 'var(--muted, #64748b)'
                  }}
                >
                  Associated Records Summary
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, background: 'var(--line, #e2e8f0)' }}>
                  <div style={{ background: '#fff', padding: '10px 12px' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>Invoices</div>
                    <div style={{ fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon path={mdiFileDocument} size={0.65} color="var(--primary)" />
                      <span>{summary.invoiceCount} ({fmtMoney(summary.totalInvoiceValue)})</span>
                    </div>
                  </div>
                  <div style={{ background: '#fff', padding: '10px 12px' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>Payments / Collections</div>
                    <div style={{ fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon path={mdiCash} size={0.65} color="var(--ok)" />
                      <span>{summary.collectionCount} ({fmtMoney(summary.totalCollected)})</span>
                    </div>
                  </div>
                  <div style={{ background: '#fff', padding: '10px 12px' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>Current Outstanding Dues</div>
                    <div style={{ fontWeight: 700, marginTop: 2, color: summary.currentBalance > 0 ? '#C53030' : undefined }}>
                      {fmtMoney(summary.currentBalance)}
                    </div>
                  </div>
                  <div style={{ background: '#fff', padding: '10px 12px' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>Opening Balance</div>
                    <div style={{ fontWeight: 700, marginTop: 2 }}>
                      {fmtMoney(summary.openingBalance)}
                    </div>
                  </div>
                  <div style={{ background: '#fff', padding: '10px 12px' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>Customer Ledger Entries</div>
                    <div style={{ fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon path={mdiBookOpen} size={0.65} color="var(--muted)" />
                      <span>{summary.ledgerCount} entries</span>
                    </div>
                  </div>
                  <div style={{ background: '#fff', padding: '10px 12px' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>Deliveries</div>
                    <div style={{ fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon path={mdiTruck} size={0.65} color="var(--muted)" />
                      <span>{summary.deliveryCount} deliveries</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Safeguard Notice Box */}
              {isPurgeMode ? (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: '#FEF2F2',
                    border: '2px solid #DC2626',
                    color: '#991B1B',
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    marginBottom: 16
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon path={mdiAlert} size={0.8} color="#DC2626" />
                    <span>⚠️ PERMANENT DATABASE PURGE (IRREVERSIBLE)</span>
                  </div>
                  You are about to permanently delete this client profile from the database along with all associated historical sales invoices, payment allocations, customer ledgers, and delivery records. <strong>This action CANNOT be undone or recovered.</strong>
                </div>
              ) : summary.hasTransactions ? (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: '#FEF3C7',
                    border: '1px solid #FCD34D',
                    color: '#92400E',
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    marginBottom: 16
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon path={mdiArchive} size={0.75} color="#B45309" />
                    <span>Protected Financial Account (Archive Required)</span>
                  </div>
                  This client has active/historical financial records. To protect accounting integrity and financial audit trails, <strong>permanent deletion is blocked</strong>. Archiving will hide the client from active operational lists while keeping all past invoices, collections, and reports fully intact.
                </div>
              ) : (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: '#FEE2E2',
                    border: '1px solid #FCA5A5',
                    color: '#991B1B',
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    marginBottom: 16
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon path={mdiDelete} size={0.75} color="#DC2626" />
                    <span>Clean Account (Permanent Deletion)</span>
                  </div>
                  This client has zero historical transactions. Confirming will permanently remove this account from the database.
                </div>
              )}

              {/* Confirmation Form */}
              <form onSubmit={handleConfirm}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#374151' }}>
                    Reason for {isPurgeMode ? 'Permanent Purge' : summary.hasTransactions ? 'Archiving' : 'Deletion'} (Optional)
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Business closed, duplicate account, permanent removal requested..."
                    disabled={isSubmitting}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--line, #cbd5e1)',
                      fontSize: 13,
                      outline: 'none'
                    }}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#111827' }}>
                    Type <span style={{ color: isPurgeMode ? '#991B1B' : summary.hasTransactions ? '#D97706' : '#DC2626', background: '#F3F4F6', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>{requiredPhrase}</span> to confirm:
                  </label>
                  <input
                    type="text"
                    value={inputPhrase}
                    onChange={(e) => setInputPhrase(e.target.value)}
                    placeholder={`Type ${requiredPhrase}`}
                    disabled={isSubmitting}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 6,
                      border: isPhraseMatching
                        ? `2px solid ${isPurgeMode ? '#DC2626' : summary.hasTransactions ? '#D97706' : '#DC2626'}`
                        : '1px solid var(--line, #cbd5e1)',
                        fontSize: 14,
                        fontWeight: 600,
                        letterSpacing: 1,
                        outline: 'none'
                    }}
                  />
                </div>

                {/* Modal Footer */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--line, #e2e8f0)', paddingTop: 16 }}>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="va-btn secondary"
                    style={{ padding: '8px 16px', fontSize: 13 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!isPhraseMatching || isSubmitting}
                    style={{
                      padding: '8px 18px',
                      fontSize: 13,
                      fontWeight: 700,
                      borderRadius: 6,
                      border: 'none',
                      cursor: !isPhraseMatching || isSubmitting ? 'not-allowed' : 'pointer',
                      background: !isPhraseMatching
                        ? '#E2E8F0'
                        : isPurgeMode
                        ? '#991B1B'
                        : summary.hasTransactions
                        ? '#D97706'
                        : '#DC2626',
                      color: !isPhraseMatching ? '#94A3B8' : '#FFFFFF',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {isSubmitting ? (
                      <>
                        <Icon path={mdiLoading} size={0.7} spin />
                        <span>Processing...</span>
                      </>
                    ) : isPurgeMode ? (
                      <>
                        <Icon path={mdiDelete} size={0.75} />
                        <span>Permanently Delete Client & Records</span>
                      </>
                    ) : summary.hasTransactions ? (
                      <>
                        <Icon path={mdiArchive} size={0.75} />
                        <span>Archive Client</span>
                      </>
                    ) : (
                      <>
                        <Icon path={mdiDelete} size={0.75} />
                        <span>Delete Client</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
