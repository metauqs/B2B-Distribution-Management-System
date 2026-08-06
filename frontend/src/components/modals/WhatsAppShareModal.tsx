'use client';

import React, { useState, useEffect } from 'react';

interface WhatsAppShareModalProps {
  /** Base64 JPG dataUrl of the generated document image */
  imageBase64: string;
  /** Filename shown to the user (e.g. "Invoice_IN-0001.jpg") */
  filename: string;
  /** Formatted WhatsApp URL with phone number — used as a secondary "direct chat" option */
  whatsappUrl: string;
  /** Display-friendly phone number shown to user (e.g. "0309-1243555") */
  displayPhone?: string;
  /** Called when user closes the modal */
  onClose: () => void;
  /** Called with a toast message */
  onToast?: (msg: string) => void;
}

/**
 * WhatsAppShareModal
 *
 * Shows a professional image-preview modal with a reliable 3-step sharing flow:
 *  Step 1 — Copy Image to Clipboard (or Download as fallback)
 *  Step 2 — Open WhatsApp (opens the app/web WITHOUT pre-dialing to avoid lookup errors)
 *  Step 3 — Paste in chat (Ctrl+V on desktop, long-press→Paste on mobile)
 *
 * Also provides a secondary "Open Direct Chat" link that uses wa.me/PHONE.
 * This is kept separate so that the "Couldn't look up phone number" error from
 * WhatsApp (which means the number isn't registered on WhatsApp) doesn't block
 * the primary sharing flow.
 */
export function WhatsAppShareModal({
  imageBase64,
  filename,
  whatsappUrl,
  displayPhone,
  onClose,
  onToast,
}: WhatsAppShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [copySupported, setCopySupported] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    setCopySupported(
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard !== 'undefined' &&
      typeof (navigator.clipboard as any).write === 'function'
    );
  }, []);

  // ── Copy image to clipboard (PNG) ─────────────────────────────────────────
  const copyImageToClipboard = async () => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = imageBase64;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          try {
            await (navigator.clipboard as any).write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            resolve();
          } catch (err) { reject(err); }
        }, 'image/png', 1.0);
      });

      setCopied(true);
      setStep(2);
      if (onToast) onToast('✅ Image copied! Now open WhatsApp and paste.');
      setTimeout(() => setCopied(false), 5000);
    } catch {
      // Fallback — download the image
      const link = document.createElement('a');
      link.href = imageBase64;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setStep(2);
      if (onToast) onToast('📦 Image downloaded! Attach it inside WhatsApp.');
    }
  };

  // ── Open WhatsApp main screen (NO phone number — avoids lookup error) ────────
  const openWhatsApp = () => {
    // Open WhatsApp without pre-dialing so we NEVER hit the "Couldn't look up number" error.
    // User will paste the copied image into any chat they choose.
    window.open('https://wa.me/', '_blank');
    setStep(3);
  };

  const stepColor = (s: 1 | 2 | 3) =>
    step > s ? '#166534' : step === s ? '#1A3C28' : '#9ca3af';

  const stepBg = (s: 1 | 2 | 3) =>
    step > s ? '#dcfce7' : step === s ? '#e6f0eb' : '#f3f4f6';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        padding: '16px',
      }}
    >
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '20px',
        width: '100%',
        maxWidth: '460px',
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)',
          color: '#fff',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>📲 Share via WhatsApp</div>
            <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '2px' }}>{filename}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.18)',
              border: 'none', borderRadius: '50%',
              width: 30, height: 30,
              color: '#fff', fontSize: '18px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* ── Image Preview ── */}
        <div style={{
          overflowY: 'auto',
          padding: '12px',
          background: '#f3f4f6',
          maxHeight: '38vh',
          flexShrink: 0,
        }}>
          <img
            src={imageBase64}
            alt="Document Preview"
            style={{ width: '100%', borderRadius: '10px', display: 'block', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
          />
        </div>

        {/* ── Step Guide ── */}
        <div style={{ padding: '14px 16px', background: '#fff', flexShrink: 0 }}>
          <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Follow these steps:
          </p>

          {/* Step 1 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: stepBg(1), color: stepColor(1),
              fontWeight: 800, fontSize: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 0.3s',
            }}>
              {step > 1 ? '✓' : '1'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: stepColor(1) }}>
                {copySupported ? 'Copy the Invoice Image' : 'Download the Invoice Image'}
              </div>
              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', lineHeight: 1.4 }}>
                {copySupported
                  ? 'Tap the green button below. The image is copied to your clipboard.'
                  : 'Tap the green button below. The image will download to your device.'}
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: stepBg(2), color: stepColor(2),
              fontWeight: 800, fontSize: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 0.3s',
            }}>
              {step > 2 ? '✓' : '2'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: stepColor(2) }}>Open WhatsApp & find the client</div>
              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', lineHeight: 1.4 }}>
                Tap "Open WhatsApp" below. Search for the client{displayPhone ? ` (${displayPhone})` : ''} and open their chat.
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: stepBg(3), color: stepColor(3),
              fontWeight: 800, fontSize: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 0.3s',
            }}>
              {step > 3 ? '✓' : '3'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: stepColor(3) }}>Paste & Send</div>
              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', lineHeight: 1.4 }}>
                In the message box: <strong>long-press → Paste</strong> (mobile) or <strong>Ctrl+V</strong> (desktop). Then tap Send.
              </div>
            </div>
          </div>
        </div>

        {/* ── Action Buttons ── */}
        <div style={{ padding: '0 16px 14px', display: 'flex', gap: '10px', flexShrink: 0 }}>
          {/* Step 1 button: Copy / Download */}
          <button
            onClick={copyImageToClipboard}
            style={{
              flex: 1,
              padding: '12px 14px',
              background: copied ? '#16a34a' : 'linear-gradient(135deg, #1A3C28, #2D6A4F)',
              color: '#fff', border: 'none',
              borderRadius: '12px', fontWeight: 700,
              fontSize: '13px', cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              boxShadow: copied ? '0 4px 12px rgba(22,163,74,0.3)' : '0 4px 12px rgba(26,60,40,0.25)',
            }}
          >
            {copied ? '✅ Image Copied!' : (copySupported ? '📋 Copy Image' : '⬇ Save Image')}
          </button>

          {/* Step 2 button: Open WhatsApp */}
          <button
            onClick={openWhatsApp}
            disabled={step < 2}
            style={{
              flex: 1,
              padding: '12px 14px',
              background: step >= 2 ? '#25D366' : '#d1fae5',
              color: step >= 2 ? '#fff' : '#6b7280',
              border: 'none', borderRadius: '12px',
              fontWeight: 700, fontSize: '13px',
              cursor: step >= 2 ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              boxShadow: step >= 2 ? '0 4px 12px rgba(37,211,102,0.3)' : 'none',
            }}
          >
            💬 Open WhatsApp
          </button>
        </div>

        {/* ── Status & Done ── */}
        {step === 3 && (
          <div style={{
            padding: '10px 16px 16px',
            textAlign: 'center',
            flexShrink: 0,
          }}>
            <div style={{
              padding: '10px 14px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#166534',
              fontWeight: 600,
            }}>
              ✅ All done! Paste the image in the WhatsApp chat and send.
            </div>
          </div>
        )}

        <div style={{ padding: '4px 16px 12px', textAlign: 'center', fontSize: '10px', color: '#d1d5db', flexShrink: 0 }}>
          High-resolution invoice image · HALAL VEGG SUPPLIES
        </div>
      </div>
    </div>
  );
}
