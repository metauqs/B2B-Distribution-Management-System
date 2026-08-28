'use client';

import { useRef } from 'react';
import { fmtMoney, fmtDate } from '@/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SaleItem {
  itemName: string; qty: number; unit: string; rate: number; amount: number;
  product?: { urduName?: string };
}

interface Sale {
  id: string; invoiceNo: string; clientId: string;
  date: string; subtotal: number; discount: number; total: number;
  paid: number; balance: number; status: string;
  items: SaleItem[]; notes?: string;
}

interface Client { id: string; name: string; phone?: string; address?: string; }

export interface BillModalProps {
  sale:      Sale;
  client?:   Client;
  onClose:   () => void;
  onDelete?: () => void;
}

// ─── BillModal ────────────────────────────────────────────────────────────────

export function BillModal({ sale, client, onClose, onDelete }: BillModalProps) {
  const billRef = useRef<HTMLDivElement>(null);
  const hasDue  = sale.balance > 0.01;

  const handlePrint = () => {
    if (!billRef.current) return;
    const w = window.open('', '_blank', 'width=520,height=820');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head>
      <style>
        @font-face {
          font-family: 'Lora';
          src: url('/fonts/Lora-Variable.woff2') format('woff2');
          font-weight: 400 700;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: 'Jameel';
          src: url('/fonts/jameel-khushkhat.woff2') format('woff2');
          font-weight: 100 900;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: 'Jameel Noori Nastaleeq';
          src: url('/fonts/jameel-khushkhat.woff2') format('woff2');
          font-weight: 100 900;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: 'Jameel Khushkhat L';
          src: url('/fonts/jameel-khushkhat.woff2') format('woff2');
          font-weight: 100 900;
          font-style: normal;
          font-display: swap;
        }
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Lora',Georgia,serif;background:#fff;}
        .va-bill-head{text-align:center;background:#1F3D2B;padding:20px 22px 16px;}
        .va-bill-head .biz{font-family:'Lora',Georgia,serif;font-size:23px;font-weight:700;color:#fff;}
        .va-bill-head .biz-meta{font-size:11px;color:rgba(255,255,255,.75);margin-top:4px;}
        .va-bill-billno{background:#C99A2E;color:#1F3D2B;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:700;padding:8px 14px;}
        .va-bill-body{padding:20px 24px 0;}
        .va-bill-parties{display:flex;justify-content:space-between;gap:14px;border-bottom:2px dashed #DCE0D2;padding-bottom:14px;margin-bottom:14px;}
        .blk{font-size:12px;color:#2B2B26;}.blk .cap{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:#7A7C6E;font-weight:600;margin-bottom:4px;}
        .blk strong{font-size:14px;color:#1F3D2B;}.blk .mono{color:#7A7C6E;display:block;margin-top:2px;}.to{text-align:right;}
        table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;}
        th{text-align:left;padding:7px 4px;border-bottom:1.5px solid #1F3D2B;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#1F3D2B;}
        th.num,td.num{text-align:right;}th.item-col{text-align:right;}
        td{padding:8px 4px;border-bottom:1px solid #EDEFE6;vertical-align:middle;}td.item-col{text-align:right;font-size:16px;}
        .va-urdu{font-family:'Jameel','Jameel Noori Nastaleeq','Jameel Khushkhat L','Noto Nastaliq Urdu','Noto Sans Arabic','Segoe UI',sans-serif;font-weight:600;direction:rtl;unicode-bidi:isolate;line-height:1.3;letter-spacing:normal!important;text-transform:none!important;}
        .va-bill-total{display:flex;justify-content:space-between;align-items:center;border-top:2px dashed #DCE0D2;padding-top:12px;margin-top:4px;}
        .va-bill-total .lbl{font-size:12px;color:#7A7C6E;text-transform:uppercase;letter-spacing:.05em;}.va-bill-total .amt{font-family:'Lora',Georgia,serif;font-size:24px;font-weight:700;color:#1F3D2B;}
        .bakaya{display:flex;justify-content:space-between;align-items:center;border-radius:6px;padding:10px 12px;margin-top:10px;}
        .bakaya.has-due{background:#FBEAEA;border:1px solid #E9C6C6;}.bakaya:not(.has-due){background:#EDEFE6;border:1px solid #DCE0D2;}
        .bakaya .lbl{font-size:12px;color:#7A7C6E;text-transform:uppercase;letter-spacing:.05em;}.bakaya .urdu-tag{font-family:'Jameel','Jameel Noori Nastaleeq','Jameel Khushkhat L','Noto Nastaliq Urdu','Noto Sans Arabic',sans-serif;font-weight:600;font-size:13px;text-transform:none!important;letter-spacing:normal!important;color:#1F3D2B;margin-right:6px;direction:rtl;display:inline-block;}
        .bakaya .amt{font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;}.bakaya.has-due .amt{color:#A83E3E;}.bakaya:not(.has-due) .amt{color:#3E7A4E;}
        .foot{text-align:center;margin-top:16px;font-size:11px;color:#7A7C6E;padding-bottom:24px;}
      </style>
    </head><body>${billRef.current.innerHTML}</body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { w.print(); w.close(); }, 400);
  };

  return (
    <div className="va-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="va-modal" onClick={e => e.stopPropagation()}>

        {/* ─── Printable bill ───────────────────────────────────── */}
        <div className="va-bill" id="bill-capture" ref={billRef}>

          {/* Header */}
          <div className="va-bill-head" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px 20px' }}>
            <img src="/logo.avif" alt="Halal Vegg Supplies" width="160" height="48" loading="lazy" decoding="async" style={{ height: '48px', width: 'auto', objectFit: 'contain' }} />
          </div>

          {/* Invoice number bar */}
          <div className="va-bill-billno">
            {sale.invoiceNo}&nbsp;·&nbsp;{fmtDate(sale.date)}
          </div>

          <div className="va-bill-body">
            {/* Parties */}
            <div className="va-bill-parties">
              <div className="blk">
                <div className="cap">From</div>
                <strong className="biz-sub">Sabzi Ledger</strong>
              </div>
              <div className="blk to">
                <div className="cap">Bill To</div>
                <strong>{client?.name ?? '—'}</strong>
                {client?.phone && <span className="mono">{client.phone}</span>}
              </div>
            </div>

            {/* Items table */}
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="item-col">اردو</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{it.itemName}</td>
                    <td className="item-col">
                      <span className="va-urdu">{it.product?.urduName ?? ''}</span>
                    </td>
                    <td className="num">{it.qty} {it.unit}</td>
                    <td className="num">{fmtMoney(it.rate)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtMoney(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Subtotal / discount row */}
            {sale.discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 12, color: '#7A7C6E', marginBottom: 8 }}>
                <span>Subtotal: {fmtMoney(sale.subtotal)}</span>
                <span>Discount: -{fmtMoney(sale.discount)}</span>
              </div>
            )}

            {/* Grand total */}
            <div className="va-bill-total">
              <div className="lbl">Total</div>
              <div className="amt">{fmtMoney(sale.total)}</div>
            </div>

            {/* Paid */}
            {sale.paid > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#3E7A4E', margin: '8px 0', fontWeight: 600 }}>
                <span>Received</span><span style={{ fontFamily: 'IBM Plex Mono' }}>{fmtMoney(sale.paid)}</span>
              </div>
            )}

            {/* Balance due */}
            <div className={`bakaya${hasDue ? ' has-due' : ''}`}>
              <div className="lbl">
                <span className="urdu-tag">باقیہ</span>
                Balance Due
              </div>
              <div className="amt">{fmtMoney(hasDue ? sale.balance : 0)}</div>
            </div>

            {sale.notes && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#7A7C6E' }}>Note: {sale.notes}</div>
            )}

            <div className="foot">Thank you for your business!</div>
          </div>
        </div>

        {/* ─── Actions ─────────────────────────────────────────── */}
        <div className="va-modal-actions">
          <button className="va-btn" onClick={handlePrint}>🖨 Print</button>
          {onDelete && (
            <button className="va-btn danger" onClick={() => { if (confirm('Delete this invoice?')) { onDelete(); onClose(); } }}>
              Delete
            </button>
          )}
          <button className="va-btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
