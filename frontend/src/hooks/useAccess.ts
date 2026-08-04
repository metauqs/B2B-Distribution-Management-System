// ─── useAccess Hook for RBAC in components ────────────────────────────────────

import { useAppSelector } from '@/store';
import { hasModuleAccess, getAccessibleModules, roleToAccessLevel } from '@/utils/rbac';
import type { UserRole } from '@/types/auth';

export interface UseAccessResult {
  user: any;
  role: UserRole | null;
  hasAccess: (module: string) => boolean;
  accessibleModules: Set<string>;
  can: (module: string) => boolean; // Alias for hasAccess
  cannot: (module: string) => boolean;
  isAdmin: boolean;
  isSupervisor: boolean;
}

/**
 * Hook to check user access and permissions
 * Usage:
 * const { hasAccess, user, role } = useAccess();
 * if (hasAccess('reports')) { ... }
 */
export function useAccess(): UseAccessResult {
  const user = useAppSelector(state => state.auth.user);
  const role = user?.role ?? null;

  const hasAccess = (module: string): boolean => {
    if (!role) return false;
    return hasModuleAccess(role, module);
  };

  const accessibleModules = role ? getAccessibleModules(role) : new Set<string>();
  
  const accessLevel = role ? roleToAccessLevel(role) : null;

  return {
    user,
    role,
    hasAccess,
    accessibleModules,
    can: hasAccess,
    cannot: (module: string) => !hasAccess(module),
    isAdmin: accessLevel === 'ADMIN',
    isSupervisor: accessLevel === 'SUPERVISOR',
  };
}
