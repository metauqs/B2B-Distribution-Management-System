'use client';

import React, { useState, useEffect } from 'react';

interface WhatsAppShareModalProps {
  /** Base64 JPG dataUrl of the generated document image */
  imageBase64: string;
  /** Filename shown to the user (e.g. "Invoice_IN-0001.jpg") */
  filename: string;
  /** Formatted WhatsApp URL (e.g. "https://wa.me/923001234567") */
  whatsappUrl: string;
  /** Called when user closes the modal */
  onClose: () => void;
  /** Called with a toast message */
  onToast?: (msg: string) => void;
}

/**
 * WhatsAppShareModal
 *
 * Shows a professional image-preview modal with two actions:
 *  1. Copy Image to Clipboard  (Clipboard API — works in Chrome/Edge/iOS Safari 16.4+)
 *  2. Open WhatsApp            (opens the client's WhatsApp chat)
 *
 * The user copies the image and pastes it directly inside WhatsApp — this is
 * the most reliable cross-browser approach since WhatsApp doesn't accept
 * image attachments via URL parameters.
 */
export function WhatsAppShareModal({
  imageBase64,
  filename,
  whatsappUrl,
  onClose,
  onToast,
}: WhatsAppShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [copySupported, setCopySupported] = useState(false);
  const [whatsappOpened, setWhatsappOpened] = useState(false);

  useEffect(() => {
    // Check if Clipboard API with image write is supported
    setCopySupported(
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard !== 'undefined' &&
      typeof (navigator.clipboard as any).write === 'function'
    );
  }, []);

  const copyImageToClipboard = async () => {
    try {
      // Convert base64 dataUrl → PNG Blob (Clipboard API only accepts image/png)
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
          } catch (err) {
            reject(err);
          }
        }, 'image/png', 1.0);
      });

      setCopied(true);
      if (onToast) onToast('✅ Image copied! Now paste it in WhatsApp.');
      setTimeout(() => setCopied(false), 4000);
    } catch (err) {
      console.warn('Clipboard image copy failed:', err);
      // Fallback: trigger download
      const link = document.createElement('a');
      link.href = imageBase64;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (onToast) onToast('📦 Image downloaded! Attach it in WhatsApp.');
    }
  };

  const openWhatsApp = () => {
    window.open(whatsappUrl, '_blank');
    setWhatsappOpened(true);
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '460px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)',
          color: '#fff',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>📲 Share Invoice via WhatsApp</div>
            <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>{filename}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              borderRadius: '50%',
              width: 30,
              height: 30,
              color: '#fff',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >×</button>
        </div>

        {/* Image Preview */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          background: '#f3f4f6',
          maxHeight: '50vh',
        }}>
          <img
            src={imageBase64}
            alt="Invoice Preview"
            style={{
              width: '100%',
              borderRadius: '10px',
              display: 'block',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            }}
          />
        </div>

        {/* Instructions */}
        <div style={{
          padding: '12px 16px',
          background: whatsappOpened ? '#f0fdf4' : '#fffbeb',
          borderTop: '1px solid #e5e7eb',
          borderBottom: '1px solid #e5e7eb',
        }}>
          {!whatsappOpened ? (
            <p style={{ margin: 0, fontSize: '12px', color: '#78350f', lineHeight: 1.5 }}>
              <strong>How to send:</strong> Click <strong>"Copy Image"</strong> below, then click{' '}
              <strong>"Open WhatsApp"</strong>. Inside WhatsApp, press{' '}
              <strong>Ctrl+V</strong> (desktop) or <strong>long-press → Paste</strong> (mobile) to attach the image.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: '12px', color: '#166534', lineHeight: 1.5 }}>
              <strong>✅ WhatsApp is open!</strong> Paste the image using{' '}
              <strong>Ctrl+V</strong> (desktop) or <strong>long-press → Paste</strong> (mobile) in the chat.
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{
          padding: '12px 16px',
          display: 'flex',
          gap: '10px',
          background: '#fff',
        }}>
          <button
            onClick={copyImageToClipboard}
            style={{
              flex: 1,
              padding: '11px 14px',
              background: copied ? '#166534' : '#1A3C28',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'background 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {copied ? '✅ Copied!' : (copySupported ? '📋 Copy Image' : '⬇ Download Image')}
          </button>

          <button
            onClick={openWhatsApp}
            style={{
              flex: 1,
              padding: '11px 14px',
              background: '#25D366',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 4px 12px rgba(37,211,102,0.25)',
            }}
          >
            💬 Open WhatsApp
          </button>
        </div>

        <div style={{
          padding: '8px 16px 14px',
          textAlign: 'center',
          fontSize: '10px',
          color: '#9ca3af',
        }}>
          Image is high-resolution and print-quality
        </div>
      </div>
    </div>
  );
}
