/**
 * Authoritative Super Admin configuration and verification utilities.
 * Under system security invariants, Khizar Hayat is the sole Super Admin.
 * No other user or employee may ever be assigned or escalated to Super Admin.
 */

export const SUPER_ADMIN_CONFIG = {
  name: 'Khizar Hayat',
  userId: 'cmsezxgk800001vhqbp1yt6iy',
  employeeId: 'cms5v07z200002eleyayw7n6x',
  employeeNumber: '9001',
  email: 'amtkuk46@gmail.com',
  phone: '03118469001',
};

/**
 * Checks if the given user identity matches Khizar Hayat's authoritative user record.
 */
export function isKhizarHayatUser(userId?: string | null, email?: string | null): boolean {
  if (!userId && !email) return false;
  if (userId && userId === SUPER_ADMIN_CONFIG.userId) return true;
  if (email && email.trim().toLowerCase() === SUPER_ADMIN_CONFIG.email.toLowerCase()) return true;
  return false;
}

/**
 * Checks if the given employee identity matches Khizar Hayat's authoritative employee record.
 */
export function isKhizarHayatEmployee(employeeId?: string | null, phone?: string | null, email?: string | null): boolean {
  if (!employeeId && !phone && !email) return false;
  if (employeeId && (employeeId === SUPER_ADMIN_CONFIG.employeeId || employeeId === SUPER_ADMIN_CONFIG.employeeNumber)) return true;
  if (email && email.trim().toLowerCase() === SUPER_ADMIN_CONFIG.email.toLowerCase()) return true;
  if (phone && phone.trim() === SUPER_ADMIN_CONFIG.phone) return true;
  return false;
}

/**
 * Normalizes and checks if a role string represents Super Admin privilege.
 */
export function isSuperAdminRole(role?: string | null): boolean {
  if (!role) return false;
  const normalized = role.trim().toUpperCase().replace(/[\s-_]/g, '');
  return normalized === 'SUPERADMIN';
}
