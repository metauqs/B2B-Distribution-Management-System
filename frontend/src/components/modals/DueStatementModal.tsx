'use client';

import React, { useState, useEffect, useRef } from 'react';
import { fmtMoney } from '@/utils/formatters';
import { loadBrandConfigWithLogo, generateOutstandingDueStatementHTML, generateTemplateJpgBase64, downloadImage, shareDocumentAsImageOnWhatsApp } from '@/utils/documentTemplates';
import { WhatsAppShareModal } from '@/components/modals/WhatsAppShareModal';

interface InvoiceItem {
  invoiceNo: string;
  date: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

interface ClientInfo {
  id: string;
  name: string;
  clientId?: string;
  type?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  deliveryLocation?: string;
  openingBalance?: number;
  currentBalance?: number;
}

interface DueStatementModalProps {
  client: ClientInfo;
  invoices: InvoiceItem[];
  mode: 'view' | 'share';
  onClose: () => void;
  onToast?: (msg: string) => void;
}

export function DueStatementModal({ client, invoices, mode, onClose, onToast }: DueStatementModalProps) {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [waShareModal, setWaShareModal] = useState<{ jpgBase64: string; whatsappUrl: string; filename: string; displayPhone?: string } | null>(null);
  const statementRef = useRef<HTMLDivElement>(null);

  const openBal = client.openingBalance ?? 0;
  const activeInvoices = invoices.filter(inv => inv.status !== 'CANCELLED');
  const totalInvoiceAmt = activeInvoices.reduce((sum, item) => sum + item.total, 0);
  const totalPaidAmt = activeInvoices.reduce((sum, item) => sum + item.paid, 0);
  const invoiceOutstanding = activeInvoices.reduce((sum, item) => sum + item.balance, 0);
  const totalOutstanding = (client.currentBalance !== undefined && client.currentBalance !== null)
    ? client.currentBalance
    : (openBal + invoiceOutstanding);

  const cleanPhone = client.whatsapp || client.phone || '';
  const formattedPhone = cleanPhone.replace(/[^0-9]/g, '');

  const showToast = (msg: string) => {
    if (onToast) onToast(msg);
  };

  useEffect(() => {
    if (mode === 'share') {
      const prep = async () => {
        const brand = await loadBrandConfigWithLogo();
        const html = generateOutstandingDueStatementHTML({
          clientName: client.name,
          clientId: client.clientId,
          clientType: client.type,
          phone: client.phone,
          whatsapp: client.whatsapp,
          address: client.address,
          deliveryLocation: client.deliveryLocation,
          openingBalance: openBal,
          invoices: invoices.map(inv => ({
            invoiceNo: inv.invoiceNo,
            date: inv.date,
            total: inv.total,
            paid: inv.paid,
            balance: inv.balance,
            status: inv.status
          })),
          totalBilled: totalInvoiceAmt,
          totalPaid: totalPaidAmt,
          totalOutstanding
        }, brand, typeof window !== 'undefined' ? window.location.origin : '');
        setHtmlContent(html);
      };
      prep();
    }
  }, [mode, client, invoices, totalInvoiceAmt, totalPaidAmt, totalOutstanding, openBal]);

  // Non-blocking silent background image pre-rendering
  useEffect(() => {
    if (htmlContent && mode === 'share' && !imageUrl) {
      generateTemplateJpgBase64(htmlContent)
        .then(url => { if (url) setImageUrl(url); })
        .catch(() => {});
    }
  }, [htmlContent, mode, imageUrl]);

  const handleDownload = async () => {
    setDownloading(true);
    showToast('⏳ Generating image...');
    try {
      let url = imageUrl;
      if (!url && htmlContent) {
        url = await generateTemplateJpgBase64(htmlContent);
        if (url) setImageUrl(url);
      }
      if (!url) {
        showToast('❌ Unable to generate the image. Please try again.');
        return;
      }
      showToast('📦 Preparing download...');
      const cleanName = (client.name || 'Client').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
      await downloadImage(url, `DueStatement_${cleanName}.jpg`, showToast);
    } catch (err) {
      console.error(err);
      showToast('❌ Unable to generate the image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleSendWhatsApp = async () => {
    setDownloading(true);
    showToast('⏳ Generating statement image...');
    try {
      let url = imageUrl;
      if (!url && htmlContent) {
        url = await generateTemplateJpgBase64(htmlContent);
        if (url) setImageUrl(url);
      }
      if (!url) {
        showToast('❌ Unable to generate statement image. Please try again.');
        return;
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      const cleanName = (client.name || 'Client').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
      const filename = `Due_Statement_${cleanName}_${dateStr}.jpg`;

      const result = await shareDocumentAsImageOnWhatsApp(
        {
          jpgBase64: url,
          filename,
          phone: client.whatsapp || client.phone || '',
        },
        (msg) => { if (msg) showToast(msg); }
      );

      if (result.method === 'modal' && result.jpgBase64) {
        setWaShareModal({
          jpgBase64: result.jpgBase64,
          whatsappUrl: result.whatsappUrl || 'https://wa.me/',
          filename,
          displayPhone: client.whatsapp || client.phone || undefined,
        });
      }
    } catch (err) {
      console.error('handleSendWhatsApp error:', err);
      showToast('❌ Unable to share. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 99999,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '820px',
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f8f9fa'
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>
            {mode === 'view' ? '🔍 Outstanding Dues Breakdown' : '✉️ Due Statement Preview & Share'}
          </h3>
          <button 
            onClick={onClose} 
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: 'var(--muted)'
            }}
          >
            &times;
          </button>
        </div>

        {/* Modal Content */}
        <div style={{
          padding: '20px',
          overflowY: 'auto',
          flex: 1,
          backgroundColor: '#f1f3f5'
        }}>
          {mode === 'view' && (
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              padding: '16px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
            }}>
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', color: 'var(--forest)' }}>{client.name}</h4>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Client ID: {client.clientId || 'WH-0000'}</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="va-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Invoice ID</th>
                      <th>Invoice Date</th>
                      <th style={{ textAlign: 'right' }}>Invoice Total</th>
                      <th style={{ textAlign: 'right' }}>Paid</th>
                      <th style={{ textAlign: 'right' }}>Remaining Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(inv => (
                      <tr key={inv.invoiceNo}>
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--forest)' }}>{inv.invoiceNo}</td>
                        <td>{new Date(inv.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(inv.total)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--ok)' }}>{fmtMoney(inv.paid)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--clay)', fontWeight: 700 }}>{fmtMoney(inv.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: 'rgba(181, 83, 60, 0.05)',
                border: '1px solid rgba(181, 83, 60, 0.15)',
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--clay)' }}>TOTAL OUTSTANDING DUE</span>
                <span className="mono" style={{ fontWeight: 700, fontSize: '16px', color: 'var(--clay)' }}>{fmtMoney(totalOutstanding)}</span>
              </div>
            </div>
          )}

          {mode === 'share' && (
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
              <div style={{
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                borderRadius: '8px',
                overflow: 'hidden',
                width: '100%',
                backgroundColor: '#ffffff',
                maxHeight: '65vh',
                overflowY: 'auto'
              }}>
                {imageUrl ? (
                  <img src={imageUrl} alt="Statement Preview" style={{ width: '100%', display: 'block', height: 'auto' }} />
                ) : htmlContent ? (
                  <iframe
                    srcDoc={htmlContent}
                    title="Statement Preview"
                    style={{ width: '100%', height: '560px', border: 'none', background: '#fff' }}
                  />
                ) : (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>
                    ⏳ Preparing statement preview...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          backgroundColor: '#f8f9fa'
        }}>
          <button className="va-btn secondary small" onClick={onClose}>Close</button>
          
          {mode === 'share' && (
            <>
              <button className="va-btn secondary small" onClick={handleDownload} disabled={downloading}>
                {downloading ? '⏳ Generating JPG...' : '⬇ Download JPG'}
              </button>
              <button className="va-btn small" onClick={handleSendWhatsApp} disabled={downloading}>
                {downloading ? '⏳ Generating...' : '💬 Send via WhatsApp'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* WhatsApp Image Share Modal (desktop fallback) */}
      {waShareModal && (
        <WhatsAppShareModal
          imageBase64={waShareModal.jpgBase64}
          filename={waShareModal.filename}
          whatsappUrl={waShareModal.whatsappUrl}
          displayPhone={waShareModal.displayPhone}
          onClose={() => setWaShareModal(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}
