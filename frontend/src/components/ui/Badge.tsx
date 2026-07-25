'use client';

import { cn } from '@/utils/formatters';

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'danger' | 'warning' | 'muted' | 'forest';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const badgeVariantMap: Record<BadgeVariant, string> = {
  success: 'badge-success',
  danger:  'badge-danger',
  warning: 'badge-warning',
  muted:   'badge-muted',
  forest:  'badge-forest',
};

export function Badge({ variant = 'muted', children, className }: BadgeProps) {
  return (
    <span className={cn('badge', badgeVariantMap[variant], className)}>
      {children}
    </span>
  );
}

// ─── Sale Status Badge ────────────────────────────────────────────────────────

const saleStatusMap: Record<string, BadgeVariant> = {
  PAID:      'success',
  PARTIAL:   'warning',
  PENDING:   'muted',
  CANCELLED: 'danger',
};

const saleStatusLabel: Record<string, string> = {
  PAID:      'Paid',
  PARTIAL:   'Partial',
  PENDING:   'Pending',
  CANCELLED: 'Cancelled',
};

export function SaleStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={saleStatusMap[status] ?? 'muted'}>
      {saleStatusLabel[status] ?? status}
    </Badge>
  );
}

// ─── Delivery Status Badge ────────────────────────────────────────────────────

const deliveryStatusMap: Record<string, BadgeVariant> = {
  DELIVERED:  'success',
  DISPATCHED: 'forest',
  PENDING:    'muted',
  FAILED:     'danger',
  RETURNED:   'warning',
};

const deliveryStatusLabel: Record<string, string> = {
  DELIVERED:  'Delivered',
  DISPATCHED: 'Dispatched',
  PENDING:    'Pending',
  FAILED:     'Failed',
  RETURNED:   'Returned',
};

export function DeliveryStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={deliveryStatusMap[status] ?? 'muted'}>
      {deliveryStatusLabel[status] ?? status}
    </Badge>
  );
}

// ─── Stock Status Badge ───────────────────────────────────────────────────────

const stockStatusMap: Record<string, BadgeVariant> = {
  IN_STOCK:     'success',
  LOW_STOCK:    'warning',
  OUT_OF_STOCK: 'danger',
};

const stockStatusLabel: Record<string, string> = {
  IN_STOCK:     'In Stock',
  LOW_STOCK:    'Low Stock',
  OUT_OF_STOCK: 'Out of Stock',
};

export function StockStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={stockStatusMap[status] ?? 'muted'}>
      {stockStatusLabel[status] ?? status}
    </Badge>
  );
}
