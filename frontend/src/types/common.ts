// ─── Common API Types ─────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ApiError {
  success: false;
  error: string;
  details?: Record<string, string[]>;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ─── UI Types ─────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface SelectOption {
  label: string;
  value: string;
}

// ─── Reports Types ────────────────────────────────────────────────────────────

export interface DashboardStats {
  todaySales: number;
  todayPurchases: number;
  todayCollections: number;
  totalReceivables: number;
  totalPayables: number;
  lowStockItems: number;
  pendingDeliveries: number;
  todayExpenses: number;
}

export interface SalesReport {
  period: string;
  totalSales: number;
  totalPaid: number;
  totalBalance: number;
  totalTransactions: number;
  topClients: Array<{ name: string; total: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
}

// ─── Branch Types ─────────────────────────────────────────────────────────────

export interface Branch {
  id: string;
  name: string;
  location: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
}
