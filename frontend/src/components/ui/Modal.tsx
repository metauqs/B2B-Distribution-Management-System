'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  closeOnOverlayClick?: boolean;
}

const sizeWidths: Record<ModalSize, string> = {
  sm:   '400px',
  md:   '560px',
  lg:   '720px',
  xl:   '900px',
  full: '95vw',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
  children,
  footer,
  className,
  closeOnOverlayClick = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        ref={dialogRef}
        className={cn('modal-content', className)}
        style={{ width: sizeWidths[size], maxWidth: '100%' }}
      >
        {title && (
          <div className="modal-header">
            <h2
              id="modal-title"
              style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-ink)' }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-sm"
              style={{ padding: '4px', borderRadius: 'var(--radius-sm)' }}
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
