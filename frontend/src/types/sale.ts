// ─── Sale Types ───────────────────────────────────────────────────────────────

export type SaleStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export type SaleUnit = 'KG' | 'MAUND' | 'DOZEN' | 'PIECE' | 'CRATE' | 'BAG' | 'TON';

export interface SaleItem {
  id: string;
  saleId: string;
  itemName: string;
  qty: number;
  unit: SaleUnit;
  rate: number;
  amount: number;
}

export interface Sale {
  id: string;
  invoiceNo: string;
  clientId: string;
  client?: { id: string; name: string; phone: string };
  date: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  status: SaleStatus;
  notes?: string;
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSaleItemDto {
  itemName: string;
  qty: number;
  unit: SaleUnit;
  rate: number;
}

export interface CreateSaleDto {
  clientId: string;
  date: string;
  items: CreateSaleItemDto[];
  discount?: number;
  paid?: number;
  notes?: string;
  branchId?: string;
}

export interface SaleListResponse {
  data: Sale[];
  total: number;
  page: number;
  limit: number;
  totalRevenue: number;
  totalBalance: number;
}
