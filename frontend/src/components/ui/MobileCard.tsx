'use client';

import React from 'react';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface MobileCardProps {
  title: React.ReactNode;
  headerBadge?: React.ReactNode;
  headerColor?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface MobileCardRowProps {
  label: React.ReactNode;
  value?: React.ReactNode;
  valueColor?: string;
  isMono?: boolean;
  href?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface MobileCardBoxProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  bg?: string;
  borderColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export interface MobileCardBadgeProps {
  children: React.ReactNode;
  variant?: 'green' | 'blue' | 'yellow' | 'red' | 'purple' | 'gray';
  style?: React.CSSProperties;
}

// ─── Component: MobileCard (Main Container & Header) ──────────────────────────

export function MobileCard({
  title,
  headerBadge,
  headerColor = 'linear-gradient(135deg, #1E5E3A 0%, #2A7A4C 100%)',
  children,
  footer,
  className = '',
  style = {},
}: MobileCardProps) {
  return (
    <div
      className={`va-mobile-card-container ${className}`}
      style={{
        background: '#FFFFFF',
        borderRadius: '16px',
        border: '1px solid #E2E8F0',
        boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        width: '100%',
        marginBottom: '14px',
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: headerColor,
          color: '#FFFFFF',
          padding: '12px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '0.01em', wordBreak: 'break-word', minWidth: 0, flex: 1 }}>
          {title}
        </div>
        {headerBadge && (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.22)',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              color: '#FFFFFF',
              fontSize: '12px',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: '12px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {headerBadge}
          </div>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {children}
      </div>

      {/* Footer / Action Bar */}
      {footer && (
        <div
          style={{
            padding: '12px 18px',
            background: '#F8FAFC',
            borderTop: '1px solid #F1F5F9',
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

// ─── Component: MobileCardRow (Standardized Key-Value Row) ────────────────────

export function MobileCardRow({
  label,
  value,
  valueColor = '#0F172A',
  isMono = false,
  href,
  icon,
  children,
  className = '',
  style = {},
}: MobileCardRowProps) {
  return (
    <div
      className={`mobile-card-row ${className}`}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '13px',
        minHeight: '22px',
        gap: '12px',
        ...style,
      }}
    >
      <span style={{ color: '#64748B', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <div
        style={{
          fontWeight: 700,
          color: valueColor,
          textAlign: 'right',
          wordBreak: 'break-word',
          fontFamily: isMono ? 'var(--font-mono), monospace' : 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          justifyContent: 'flex-end',
        }}
      >
        {icon && <span>{icon}</span>}
        {href ? (
          <a
            href={href}
            style={{
              color: '#2563EB',
              textDecoration: 'none',
              fontWeight: 700,
            }}
          >
            {value ?? children}
          </a>
        ) : (
          value ?? children
        )}
      </div>
    </div>
  );
}

// ─── Component: MobileCardBox (Light Green Tinted Sub-Box) ─────────────────────

export function MobileCardBox({
  title,
  children,
  bg = '#F0FDF4',
  borderColor = '#DCFCE7',
  className = '',
  style = {},
}: MobileCardBoxProps) {
  return (
    <div
      className={`mobile-card-box ${className}`}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: '12px',
        padding: '12px 14px',
        marginTop: '4px',
        marginBottom: '4px',
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: '#166534',
            marginBottom: '8px',
            borderBottom: title ? `1px solid ${borderColor}` : 'none',
            paddingBottom: '4px',
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Component: MobileCardBadge (Status Badge Pill) ───────────────────────────

export function MobileCardBadge({ children, variant = 'blue', style = {} }: MobileCardBadgeProps) {
  const variantStyles: Record<string, { bg: string; color: string; border: string }> = {
    green: { bg: '#DCFCE7', color: '#15803D', border: '#86EFAC' },
    blue: { bg: '#E0F2FE', color: '#0369A1', border: '#BAE6FD' },
    yellow: { bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' },
    red: { bg: '#FEE2E2', color: '#B91C1C', border: '#FCA5A5' },
    purple: { bg: '#F3E8FF', color: '#6B21A8', border: '#E9D5FF' },
    gray: { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' },
  };

  const current = variantStyles[variant] || variantStyles.blue;

  return (
    <span
      style={{
        display: 'inline-block',
        borderRadius: '20px',
        padding: '3px 10px',
        fontSize: '11px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
        background: current.bg,
        color: current.color,
        border: `1px solid ${current.border}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
