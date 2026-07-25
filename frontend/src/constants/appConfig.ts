// ─── App Configuration ────────────────────────────────────────────────────────

export const APP_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? 'Halal Vegg Supplies',
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '1.0.0',
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? '/api',
  currency: 'PKR',
  currencySymbol: '₨',
  dateFormat: 'DD/MM/YYYY',
  timezone: 'Asia/Karachi',
  language: 'ur',
  defaultPageSize: 25,
  maxPageSize: 100,
} as const;

export const UNITS = [
  { label: 'KG', value: 'KG' },
  { label: 'Maund', value: 'MAUND' },
  { label: 'Dozen', value: 'DOZEN' },
  { label: 'Piece', value: 'PIECE' },
  { label: 'Crate', value: 'CRATE' },
  { label: 'Bag', value: 'BAG' },
  { label: 'Ton', value: 'TON' },
] as const;

export const CLIENT_TYPES = [
  { label: 'Retail', value: 'RETAIL' },
  { label: 'Wholesale', value: 'WHOLESALE' },
  { label: 'Hotel', value: 'HOTEL' },
  { label: 'Restaurant', value: 'RESTAURANT' },
  { label: 'Other', value: 'OTHER' },
] as const;

export const PAYMENT_METHODS = [
  { label: 'Cash', value: 'CASH' },
  { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
  { label: 'Cheque', value: 'CHEQUE' },
  { label: 'Online via JazzCash', value: 'ONLINE' },
] as const;

export const EXPENSE_CATEGORIES = [
  { label: 'Transport', value: 'TRANSPORT' },
  { label: 'Labour', value: 'LABOUR' },
  { label: 'Rent', value: 'RENT' },
  { label: 'Utilities', value: 'UTILITIES' },
  { label: 'Commission', value: 'COMMISSION' },
  { label: 'Miscellaneous', value: 'MISCELLANEOUS' },
  { label: 'Other', value: 'OTHER' },
] as const;

export const DELIVERY_ZONES = [
  { label: 'Zone A — City Centre', value: 'ZONE_A' },
  { label: 'Zone B — North', value: 'ZONE_B' },
  { label: 'Zone C — South', value: 'ZONE_C' },
  { label: 'Zone D — East', value: 'ZONE_D' },
  { label: 'Zone E — West', value: 'ZONE_E' },
] as const;

export const SALE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PARTIAL: 'Partial',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  RETURNED: 'Returned',
};

export const USER_ROLES = [
  { label: 'Super Admin', value: 'SUPER_ADMIN' },
  { label: 'Branch Admin', value: 'BRANCH_ADMIN' },
  { label: 'Manager', value: 'MANAGER' },
  { label: 'Staff', value: 'STAFF' },
  { label: 'Viewer', value: 'VIEWER' },
] as const;
