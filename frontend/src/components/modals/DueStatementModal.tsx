import { useEffect, useRef, useState } from 'react';
import { fmtMoney } from '@/utils/formatters';
import { loadBrandConfig, generateOutstandingDueStatementHTML, generateTemplateImageBase64 } from '@/utils/documentTemplates';

interface OutstandingInvoice {
  invoiceNo: string;
  date: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

interface ClientInfo {
  id: string;
  clientId?: string | null;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
}

interface DueStatementModalProps {
  client: ClientInfo;
  invoices: OutstandingInvoice[];
  mode: 'view' | 'share';
  onClose: () => void;
}

export function DueStatementModal({ client, invoices, mode, onClose }: DueStatementModalProps) {
  const statementRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string>('');

  const totalInvoiceAmt = invoices.reduce((sum, inv) => sum + inv.total, 0);
  const totalPaidAmt = invoices.reduce((sum, inv) => sum + inv.paid, 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.balance, 0);

  const cleanPhone = client.whatsapp || client.phone || '';
  const formattedPhone = cleanPhone.replace(/[^0-9]/g, '');

  const statementDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const statementTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  // Generate the high-quality JPG image using central SVG/Canvas utility
  const generateStatementImage = async () => {
    if (!htmlContent) return;
    setRendering(true);
    try {
      const url = await generateTemplateImageBase64(htmlContent);
      setImageUrl(url);
    } catch (err) {
      console.error('Failed to generate statement image:', err);
    } finally {
      setRendering(false);
    }
  };

  useEffect(() => {
    if (mode === 'share') {
      const prep = async () => {
        const brand = await loadBrandConfig();
        const html = generateOutstandingDueStatementHTML({
          clientName: client.name,
          clientId: client.clientId,
          phone: client.phone,
          whatsapp: client.whatsapp,
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
        }, brand, window.location.origin);
        setHtmlContent(html);
      };
      prep();
    }
  }, [mode, client, invoices, totalInvoiceAmt, totalPaidAmt, totalOutstanding]);

  useEffect(() => {
    if (htmlContent && mode === 'share') {
      generateStatementImage();
    }
  }, [htmlContent, mode]);

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `Due_Statement_${client.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSendWhatsApp = () => {
    const msg = encodeURIComponent(
      `Dear ${client.name},\n\nPlease find your latest Outstanding Due Statement from HALAL VEGG SUPPLIES.\n\nYour current total outstanding balance is:\n*Rs. ${totalOutstanding.toLocaleString()}*\n\nKindly clear your pending dues at your earliest convenience.\n\nThank you.\nHALAL VEGG SUPPLIES`
    );
    const targetNo = formattedPhone ? formattedPhone : '';
    const waUrl = targetNo 
      ? `https://wa.me/${targetNo.startsWith('92') || targetNo.startsWith('0') ? '' : '92'}${targetNo.replace(/^0/, '')}?text=${msg}`
      : `https://wa.me/?text=${msg}`;

    // 1. Download statement first so they can attach it easily
    handleDownload();

    // 2. Open WhatsApp in new tab
    window.open(waUrl, '_blank');
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
        maxWidth: mode === 'share' ? '480px' : '750px',
        maxHeight: '90vh',
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
            {mode === 'view' ? '🔍 Outstanding Dues Breakdown' : '✉️ Send Due Statement'}
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {rendering && (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>
                  ⏳ Rendering high-quality statement...
                </div>
              )}

              {!rendering && imageUrl && (
                <div style={{
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  width: '100%',
                  backgroundColor: '#ffffff'
                }}>
                  <img 
                    src={imageUrl} 
                    alt="Statement Preview" 
                    style={{ width: '100%', display: 'block', height: 'auto' }} 
                  />
                </div>
              )}

              {/* Hidden Element used for JPG Generation */}
              <div 
                ref={statementRef} 
                style={{
                  position: 'absolute',
                  left: '-9999px',
                  top: '-9999px',
                  width: '780px',
                  background: '#ffffff',
                  boxSizing: 'border-box',
                }}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
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
          
          {mode === 'share' && imageUrl && (
            <>
              <button className="va-btn secondary small" onClick={handleDownload}>
                ⬇ Download JPG
              </button>
              <button className="va-btn small" onClick={handleSendWhatsApp}>
                💬 Send via WhatsApp
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
