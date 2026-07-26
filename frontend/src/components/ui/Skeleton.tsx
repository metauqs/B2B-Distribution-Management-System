'use client';

import React from 'react';

export function SkeletonBox({ width, height, style, className = '' }: { width?: string | number; height?: string | number; style?: React.CSSProperties; className?: string }) {
  return (
    <div
      className={`va-skeleton ${className}`}
      style={{
        width: width ?? '100%',
        height: height ?? '100%',
        ...style,
      }}
    />
  );
}

export function SkeletonKPI({ count = 4 }: { count?: number }) {
  return (
    <div className="va-cards" style={{ marginBottom: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="va-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <SkeletonBox width="50%" height={14} />
          <SkeletonBox width="80%" height={28} />
          <SkeletonBox width="40%" height={12} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Search & Filter Bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <SkeletonBox width="280px" height={40} style={{ borderRadius: 8 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <SkeletonBox width="100px" height={40} style={{ borderRadius: 8 }} />
          <SkeletonBox width="100px" height={40} style={{ borderRadius: 8 }} />
        </div>
      </div>

      {/* Table Skeleton */}
      <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0', padding: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 16, borderBottom: '1.5px solid #E2E8F0', paddingBottom: 12, marginBottom: 12 }}>
          {Array.from({ length: cols }).map((_, i) => (
            <SkeletonBox key={i} width={`${100 / cols}%`} height={16} />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: r < rows - 1 ? '1px solid #EDF2F7' : 'none' }}>
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonBox key={c} width={`${100 / cols}%`} height={16} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonMobileCards({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SkeletonBox width="60%" height={18} />
            <SkeletonBox width="25%" height={22} style={{ borderRadius: 12 }} />
          </div>
          <SkeletonBox width="85%" height={14} />
          <SkeletonBox width="45%" height={14} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <SkeletonBox width="48%" height={36} style={{ borderRadius: 8 }} />
            <SkeletonBox width="48%" height={36} style={{ borderRadius: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonProfile() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Profile Header */}
      <div style={{ background: '#FFFFFF', padding: 20, borderRadius: 12, border: '1px solid #E2E8F0', display: 'flex', gap: 16, alignItems: 'center' }}>
        <SkeletonBox width={64} height={64} style={{ borderRadius: '50%' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonBox width="35%" height={24} />
          <SkeletonBox width="55%" height={14} />
        </div>
      </div>
      {/* Profile Cards */}
      <SkeletonKPI count={3} />
      {/* Profile Table */}
      <SkeletonTable rows={4} cols={4} />
    </div>
  );
}

export function SkeletonPage({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{ padding: 16, width: '100%' }}>
      {children ?? (
        <>
          <SkeletonKPI count={4} />
          <SkeletonTable rows={5} cols={5} />
        </>
      )}
    </div>
  );
}

export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div style={{ background: '#FFFFFF', padding: 20, borderRadius: 12, border: '1px solid #E2E8F0', width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SkeletonBox width="30%" height={20} />
      <SkeletonBox width="100%" height={height} style={{ borderRadius: 8 }} />
    </div>
  );
}
