'use client';

import { Loader2 } from 'lucide-react';

// ─── Spinner ──────────────────────────────────────────────────────────────────

interface SpinnerProps {
  size?: number;
  color?: string;
}

export function Spinner({ size = 20, color = 'var(--color-leaf)' }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      style={{ color, animation: 'spin 1s linear infinite' }}
    />
  );
}

// ─── Full Page Loader ─────────────────────────────────────────────────────────

export function PageLoader() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-cream)',
        zIndex: 999,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Spinner size={40} />
        <p style={{ color: 'var(--color-muted)', fontSize: 'var(--font-size-sm)' }}>Loading...</p>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({ width = '100%', height = 16 }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{ width, height: typeof height === 'number' ? `${height}px` : height }}
    />
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} style={{ borderBottom: '1px solid var(--color-lineSoft)' }}>
          {Array.from({ length: cols }).map((_, colIdx) => (
            <td key={colIdx} style={{ padding: '10px 14px' }}>
              <Skeleton height={14} width={colIdx === 0 ? '60%' : '80%'} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && (
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>{icon}</div>
      )}
      <p style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', color: 'var(--color-ink)', marginBottom: 6 }}>
        {title}
      </p>
      {description && (
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-muted)', marginBottom: 20 }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
