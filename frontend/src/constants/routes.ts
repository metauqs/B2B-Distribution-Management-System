// ─── Route Constants ──────────────────────────────────────────────────────────

export const ROUTES = {
  // Auth
  LOGIN: '/login',
  LOGOUT: '/logout',

  // Main
  DASHBOARD: '/',

  // Sales
  SALES: '/sales',
  SALES_NEW: '/sales/new',
  SALES_DETAIL: (id: string) => `/sales/${id}`,

  // Purchases
  PURCHASES: '/purchases',
  PURCHASES_NEW: '/purchases/new',
  PURCHASES_DETAIL: (id: string) => `/purchases/${id}`,

  // Inventory
  INVENTORY: '/inventory',

  // Clients
  CLIENTS: '/clients',
  CLIENTS_NEW: '/clients/new',
  CLIENTS_DETAIL: (id: string) => `/clients/${id}`,

  // Collections
  COLLECTIONS: '/collections',

  // Delivery
  DELIVERY: '/delivery',

  // Price List
  PRICE_LIST: '/pricelist',

  // Reports
  REPORTS: '/reports',
  REPORTS_SALES: '/reports/sales',
  REPORTS_PURCHASES: '/reports/purchases',
  REPORTS_EXPENSES: '/reports/expenses',

  // Settings
  SETTINGS: '/settings',
  SETTINGS_BRANCHES: '/settings/branches',
  SETTINGS_USERS: '/settings/users',
} as const;

export const API_ENDPOINTS = {
  // Auth
  AUTH_LOGIN: '/api/auth/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_ME: '/api/auth/me',

  // Clients
  CLIENTS: '/api/clients',
  CLIENT: (id: string) => `/api/clients/${id}`,

  // Sales
  SALES: '/api/sales',
  SALE: (id: string) => `/api/sales/${id}`,
  SALE_BILL: (id: string) => `/api/sales/${id}/bill`,

  // Purchases
  PURCHASES: '/api/purchases',
  PURCHASE: (id: string) => `/api/purchases/${id}`,

  // Inventory
  INVENTORY: '/api/inventory',
  INVENTORY_ITEM: (id: string) => `/api/inventory/${id}`,

  // Expenses
  EXPENSES: '/api/expenses',
  EXPENSE: (id: string) => `/api/expenses/${id}`,

  // Collections
  COLLECTIONS: '/api/collections',
  COLLECTION: (id: string) => `/api/collections/${id}`,

  // Price List
  PRICE_LIST: '/api/pricelist',
  PRICE_LIST_ITEM: (id: string) => `/api/pricelist/${id}`,

  // Delivery
  DELIVERY: '/api/delivery',
  DELIVERY_ITEM: (id: string) => `/api/delivery/${id}`,

  // Reports
  REPORTS_DASHBOARD: '/api/reports/dashboard',
  REPORTS_SALES: '/api/reports/sales',
  REPORTS_PURCHASES: '/api/reports/purchases',
  REPORTS_EXPENSES: '/api/reports/expenses',

  // Suppliers
  SUPPLIERS: '/api/suppliers',
  SUPPLIER: (id: string) => `/api/suppliers/${id}`,

  // Branches
  BRANCHES: '/api/branches',
  BRANCH: (id: string) => `/api/branches/${id}`,
} as const;
