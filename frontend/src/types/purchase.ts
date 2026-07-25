// ─── Purchase Types ───────────────────────────────────────────────────────────

export type PurchaseStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export type PurchaseUnit = 'KG' | 'MAUND' | 'DOZEN' | 'PIECE' | 'CRATE' | 'BAG' | 'TON';

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  itemName: string;
  qty: number;
  unit: PurchaseUnit;
  rate: number;
  amount: number;
}

export interface Purchase {
  id: string;
  supplierId: string;
  supplier?: { id: string; name: string; phone: string };
  date: string;
  items: PurchaseItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  status: PurchaseStatus;
  notes?: string;
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePurchaseItemDto {
  itemName: string;
  qty: number;
  unit: PurchaseUnit;
  rate: number;
}

export interface CreatePurchaseDto {
  supplierId: string;
  date: string;
  items: CreatePurchaseItemDto[];
  discount?: number;
  paid?: number;
  notes?: string;
  branchId?: string;
}

// ─── Supplier Types ───────────────────────────────────────────────────────────

export type SupplierStatus = 'ACTIVE' | 'INACTIVE';

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  balance: number;
  status: SupplierStatus;
  branchId: string;
  createdAt: string;
  updatedAt: string;
}
