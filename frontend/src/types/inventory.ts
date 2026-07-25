// ─── Inventory Types ──────────────────────────────────────────────────────────

export type InventoryUnit = 'KG' | 'MAUND' | 'DOZEN' | 'PIECE' | 'CRATE' | 'BAG' | 'TON';
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface Inventory {
  id: string;
  itemName: string;
  category?: string;
  qty: number;
  unit: InventoryUnit;
  rate: number;
  minStock: number;
  stockStatus: StockStatus;
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateInventoryDto {
  itemName?: string;
  category?: string;
  qty?: number;
  unit?: InventoryUnit;
  rate?: number;
  minStock?: number;
}

// ─── Expense Types ────────────────────────────────────────────────────────────

export type ExpenseCategory =
  | 'TRANSPORT'
  | 'LABOUR'
  | 'RENT'
  | 'UTILITIES'
  | 'COMMISSION'
  | 'MISCELLANEOUS'
  | 'OTHER';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  branchId: string;
  createdAt: string;
}

// ─── Wastage Types ────────────────────────────────────────────────────────────

export interface Wastage {
  id: string;
  itemName: string;
  qty: number;
  unit: InventoryUnit;
  reason?: string;
  date: string;
  branchId: string;
  createdAt: string;
}

// ─── Collection Types ─────────────────────────────────────────────────────────

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'ONLINE';

export interface Collection {
  id: string;
  clientId: string;
  client?: { id: string; name: string };
  amount: number;
  method: PaymentMethod;
  date: string;
  reference?: string;
  notes?: string;
  branchId: string;
  createdAt: string;
}

// ─── Delivery Types ───────────────────────────────────────────────────────────

export type DeliveryStatus = 'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'FAILED' | 'RETURNED';

export interface Delivery {
  id: string;
  saleId: string;
  sale?: { id: string; invoiceNo: string };
  clientId: string;
  client?: { id: string; name: string; address: string; phone: string };
  date: string;
  zone?: string;
  status: DeliveryStatus;
  notes?: string;
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Price List Types ─────────────────────────────────────────────────────────

export interface PriceList {
  id: string;
  itemName: string;
  unit: InventoryUnit;
  buyRate: number;
  sellRate: number;
  date: string;
  branchId: string;
  createdAt: string;
}
