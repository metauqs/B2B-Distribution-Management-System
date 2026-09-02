'use client';

import React, { useState, useEffect } from 'react';
import {
  loadBrandConfigWithLogo,
  generateDailyPaymentHistoryHTML,
  generateTemplateJpgBase64,
  downloadImage,
  openPrintWindow,
  writeAndPrint,
  DailyPaymentHistoryDocData,
} from '@/utils/documentTemplates';
import { fmtMoney } from '@/utils/formatters';

export interface DailyPaymentHistoryPreviewModalProps {
  data: DailyPaymentHistoryDocData;
  onClose: () => void;
  onToast?: (msg: string) => void;
}

export function DailyPaymentHistoryPreviewModal({ data, onClose, onToast }: DailyPaymentHistoryPreviewModalProps) {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [imageUrl, setImageUrl]       = useState<string>('');
  const [downloading, setDownloading] = useState(false);

  const showToast = (msg: string) => {
    if (onToast) onToast(msg);
  };

  useEffect(() => {
    const prep = async () => {
      const brand = await loadBrandConfigWithLogo();
      const html = generateDailyPaymentHistoryHTML(data, brand, typeof window !== 'undefined' ? window.location.origin : '');
      setHtmlContent(html);
    };
    prep();
  }, [data]);

  // Background image rendering for fast download
  useEffect(() => {
    if (htmlContent && !imageUrl) {
      generateTemplateJpgBase64(htmlContent)
        .then(url => { if (url) setImageUrl(url); })
        .catch(() => {});
    }
  }, [htmlContent, imageUrl]);

  const handleDownload = async () => {
    setDownloading(true);
    showToast('⏳ Generating daily report image...');
    try {
      let url = imageUrl;
      if (!url && htmlContent) {
        url = await generateTemplateJpgBase64(htmlContent);
      }
      if (url) {
        const dateSlug = (data.businessDate || 'today').replace(/\s+/g, '_');
        downloadImage(url, `daily_payment_history_${dateSlug}.jpg`);
        showToast('✅ Daily payment history report downloaded');
      } else {
        showToast('❌ Failed to generate report image');
      }
    } catch {
      showToast('❌ Failed to download report image');
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!htmlContent) return;
    const printWin = openPrintWindow();
    if (printWin) {
      writeAndPrint(printWin, htmlContent);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        width: '100%',
        maxWidth: 860,
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid #E2E8F0',
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#F8FAFC',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, color: '#0F172A', fontWeight: 800 }}>
              📊 Daily Payment History Preview
            </h3>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
              Business Date: <strong>{data.businessDate}</strong> • {data.summary.totalTransactions} Transaction{data.summary.totalTransactions !== 1 ? 's' : ''} • Total: <strong>{fmtMoney(data.summary.totalCollected)}</strong>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#F1F5F9',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              cursor: 'pointer',
              fontWeight: 700,
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Document Preview Body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 20,
          background: '#F1F5F9',
          display: 'flex',
          justifyContent: 'center',
        }}>
          {htmlContent ? (
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 8,
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                width: '100%',
                maxWidth: 794,
                padding: 16,
              }}
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          ) : (
            <div style={{ padding: 40, color: '#64748B', fontStyle: 'italic' }}>
              Loading document preview…
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#FFFFFF',
          flexWrap: 'wrap',
          gap: 10,
        }}>
          <button
            onClick={onClose}
            className="va-btn secondary small"
            style={{ padding: '8px 16px', fontWeight: 700 }}
          >
            Close
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handlePrint}
              className="va-btn secondary small"
              style={{ padding: '8px 16px', fontWeight: 700 }}
            >
              🖨️ Print Report
            </button>
            <button
              onClick={handleDownload}
              className="va-btn small"
              disabled={downloading}
              style={{ padding: '8px 18px', fontWeight: 800, background: '#166534', color: '#FFF' }}
            >
              {downloading ? '⏳ Generating JPG…' : '⬇️ Download JPG'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
