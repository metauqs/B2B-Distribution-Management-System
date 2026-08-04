// ─── Role-Based Access Control (RBAC) ────────────────────────────────────────

import type { UserRole } from '@/types/auth';

export type AccessLevel = 'ADMIN' | 'SUPERVISOR' | 'BILLING_STAFF' | 'PURCHASE_STAFF' | 'DELIVERY_STAFF';

/**
 * Map backend UserRoles to access levels for RBAC
 * OWNER/MANAGER -> ADMIN (all modules)
 * MANAGER -> SUPERVISOR (all except users & reports)
 * CASHIER/SALESMAN -> BILLING_STAFF (sales, billing, pricelist, clients)
 * ACCOUNTANT -> PURCHASE_STAFF (purchases, inventory)
 * DELIVERY -> DELIVERY_STAFF (delivery, collections)
 */
export const roleToAccessLevel = (role: UserRole): AccessLevel => {
  switch (role) {
    case 'OWNER':
      return 'ADMIN';
    case 'MANAGER':
      return 'SUPERVISOR';
    case 'CASHIER':
    case 'SALESMAN':
      return 'BILLING_STAFF';
    case 'ACCOUNTANT':
      return 'PURCHASE_STAFF';
    case 'DELIVERY':
      return 'DELIVERY_STAFF';
    default:
      return 'BILLING_STAFF'; // Default fallback
  }
};

/**
 * Define which modules each access level can access
 */
export const accessLevelModules: Record<AccessLevel, Set<string>> = {
  ADMIN: new Set([
    'dashboard',
    'sales',
    'purchases',
    'inventory',
    'clients',
    'collections',
    'delivery',
    'pricelist',
    'reports',
    'expenses',
    'employees',
    'settings',
  ]),
  SUPERVISOR: new Set([
    'dashboard',
    'sales',
    'purchases',
    'inventory',
    'clients',
    'collections',
    'delivery',
    'pricelist',
    'expenses',
    // Excludes: employees, reports, settings
  ]),
  BILLING_STAFF: new Set([
    'dashboard',
    'sales',
    'pricelist',
    'clients',
  ]),
  PURCHASE_STAFF: new Set([
    'dashboard',
    'purchases',
    'inventory',
  ]),
  DELIVERY_STAFF: new Set([
    'dashboard',
    'delivery',
    'collections',
  ]),
};

/**
 * Check if a user role has access to a module
 */
export const hasModuleAccess = (role: UserRole, module: string): boolean => {
  const accessLevel = roleToAccessLevel(role);
  const modules = accessLevelModules[accessLevel];
  return modules.has(module);
};

/**
 * Get all accessible modules for a role
 */
export const getAccessibleModules = (role: UserRole): Set<string> => {
  const accessLevel = roleToAccessLevel(role);
  return accessLevelModules[accessLevel];
};
