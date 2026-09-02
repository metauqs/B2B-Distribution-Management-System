'use client';

import React, { useState, useEffect } from 'react';
import { fmtMoney } from '@/utils/formatters';
import {
  loadBrandConfigWithLogo,
  generateCollectionSlipHTML,
  generateTemplateJpgBase64,
  downloadImage,
  openPrintWindow,
  writeAndPrint,
  CollectionSlipData,
} from '@/utils/documentTemplates';
import { WhatsAppShareModal } from '@/components/modals/WhatsAppShareModal';

export interface CollectionReceiptModalProps {
  data: CollectionSlipData & { whatsapp?: string };
  onClose: () => void;
  onToast?: (msg: string) => void;
}

export function CollectionReceiptModal({ data, onClose, onToast }: CollectionReceiptModalProps) {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [waShareModal, setWaShareModal] = useState<{ jpgBase64: string; whatsappUrl: string; filename: string; displayPhone?: string } | null>(null);

  const cleanPhone = data.whatsapp || data.phone || '';
  const formattedPhone = cleanPhone.replace(/[^0-9]/g, '');

  const showToast = (msg: string) => {
    if (onToast) onToast(msg);
  };

  useEffect(() => {
    const prep = async () => {
      const brand = await loadBrandConfigWithLogo();
      const html = generateCollectionSlipHTML(data, brand, typeof window !== 'undefined' ? window.location.origin : '');
      setHtmlContent(html);
    };
    prep();
  }, [data]);

  // Silent background image rendering
  useEffect(() => {
    if (htmlContent && !imageUrl) {
      generateTemplateJpgBase64(htmlContent)
        .then(url => { if (url) setImageUrl(url); })
        .catch(() => {});
    }
  }, [htmlContent, imageUrl]);

  const handleDownload = async () => {
    setDownloading(true);
    showToast('⏳ Generating receipt image...');
    try {
      let url = imageUrl;
      if (!url && htmlContent) {
        url = await generateTemplateJpgBase64(htmlContent);
      }
      if (url) {
        downloadImage(url, `payment_receipt_${data.receiptNo}.jpg`);
        showToast('✅ Payment receipt image downloaded');
      } else {
        showToast('❌ Failed to generate receipt image');
      }
    } catch {
      showToast('❌ Failed to download receipt image');
    } finally {
      setDownloading(false);
    }
  };

  const handleShareWhatsApp = async () => {
    if (!formattedPhone) {
      showToast('❌ Customer phone number is missing');
      return;
    }
    showToast('⏳ Preparing WhatsApp receipt slip...');
    try {
      let url = imageUrl;
      if (!url && htmlContent) {
        url = await generateTemplateJpgBase64(htmlContent);
      }
      if (!url) {
        showToast('❌ Failed to generate receipt image');
        return;
      }
      const text = `Assalam-o-Alaikum ${data.clientName},\n\nThank you for your payment of *${fmtMoney(data.amountReceived)}*.\nReceipt #${data.receiptNo} (Date: ${data.date}).\n\nRemaining Outstanding: *${fmtMoney(data.remainingBalance)}*\n\nThank you for choosing HALAL VEGG SUPPLIES.`;
      const waUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(text)}`;

      setWaShareModal({
        jpgBase64: url,
        whatsappUrl: waUrl,
        filename: `payment_receipt_${data.receiptNo}.jpg`,
        displayPhone: formattedPhone,
      });
    } catch (err: any) {
      showToast(`❌ ${err.message || 'Failed to share receipt'}`);
    }
  };

  const handlePrint = () => {
    const printWin = openPrintWindow();
    if (!printWin) return showToast('❌ Allow popups to print receipt');
    loadBrandConfigWithLogo().then(brand => {
      const html = generateCollectionSlipHTML(data, brand, window.location.origin);
      writeAndPrint(printWin, html);
    });
  };

  const excessAmt = data.excessPayment ?? 0;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.7)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16
    }}>
      <div style={{
        background: '#FFFFFF', borderRadius: 16, width: '100%', maxWidth: 640,
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        display: 'flex', flexDirection: 'column'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#F8FAFC', borderTopLeftRadius: 16, borderTopRightRadius: 16
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1E293B' }}>
              ✅ Payment Receipt #{data.receiptNo}
            </h3>
            <span style={{ fontSize: 12, color: '#64748B' }}>{data.clientName} · {data.date}</span>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: '#64748B' }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: 20, flex: 1 }}>
          {/* Top Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#B45309', textTransform: 'uppercase' }}>Previous Balance</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: '#B45309', marginTop: 2 }}>{fmtMoney(data.previousBalance)}</div>
            </div>

            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Amount Received</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: '#15803D', marginTop: 2 }}>{fmtMoney(data.amountReceived)}</div>
            </div>

            <div style={{ background: excessAmt > 0 ? '#F0FDF4' : (data.remainingBalance > 0 ? '#FEF2F2' : '#F0FDF4'), border: `1px solid ${excessAmt > 0 ? '#BBF7D0' : (data.remainingBalance > 0 ? '#FCA5A5' : '#BBF7D0')}`, padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: excessAmt > 0 ? '#166534' : (data.remainingBalance > 0 ? '#991B1B' : '#166534'), textTransform: 'uppercase' }}>
                {excessAmt > 0 ? 'Advance Credit' : 'Remaining Dues'}
              </div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: excessAmt > 0 ? '#15803D' : (data.remainingBalance > 0 ? '#DC2626' : '#15803D'), marginTop: 2 }}>
                {excessAmt > 0 ? `+${fmtMoney(excessAmt)}` : fmtMoney(data.remainingBalance)}
              </div>
            </div>
          </div>

          {/* Payment Info */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '10px 14px', borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span><strong>Payment Method:</strong> {data.paymentMethod}</span>
              {data.reference && <span><strong>Reference:</strong> {data.reference}</span>}
              {data.notes && <span><strong>Notes:</strong> {data.notes}</span>}
            </div>
          </div>

          {/* FIFO Allocations List */}
          {data.allocations && data.allocations.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', marginBottom: 6 }}>
                📍 FIFO Invoice Payment Allocation Breakdown
              </div>
              <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #E2E8F0', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>Invoice No</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Amount Paid</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Remaining Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.allocations.map((a, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>#{a.invoiceNo}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#15803D', fontWeight: 700 }}>{fmtMoney(a.allocatedAmount)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: a.remainingBalance > 0 ? '#B45309' : '#166534' }}>{fmtMoney(a.remainingBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Live Document Preview Box */}
          {htmlContent && (
            <div style={{ border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden', height: 240, background: '#F8FAFC' }}>
              <iframe
                srcDoc={htmlContent}
                title="Receipt Slip Preview"
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            </div>
          )}
        </div>

        {/* Modal Action Buttons */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#F8FAFC', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, flexWrap: 'wrap', gap: 10
        }}>
          <button className="va-btn secondary small" onClick={onClose}>Close</button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="va-btn outline small" onClick={handlePrint} style={{ fontWeight: 700 }}>
              🖨️ Print Slip
            </button>
            <button className="va-btn outline small" onClick={handleDownload} disabled={downloading} style={{ fontWeight: 700 }}>
              {downloading ? '⏳ Image...' : '💾 Download Image'}
            </button>
            <button className="va-btn small" onClick={handleShareWhatsApp} style={{ background: '#25D366', borderColor: '#25D366', fontWeight: 800 }}>
              💬 Share WhatsApp Slip
            </button>
          </div>
        </div>
      </div>

      {/* WhatsApp Share Guided Modal */}
      {waShareModal && (
        <WhatsAppShareModal
          onClose={() => setWaShareModal(null)}
          imageBase64={waShareModal.jpgBase64}
          whatsappUrl={waShareModal.whatsappUrl}
          filename={waShareModal.filename}
          displayPhone={waShareModal.displayPhone}
          onToast={showToast}
        />
      )}
    </div>
  );
}
