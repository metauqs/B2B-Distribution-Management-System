// ─── Protected Route Component (for page-level access control) ────────────────

'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAppSelector } from '@/store';
import { hasModuleAccess, getDefaultRouteForRole } from '@/utils/rbac';

interface ProtectedRouteProps {
  children: React.ReactNode;
  module: string; // Module name to check access for
  fallback?: React.ReactNode;
}

/**
 * Wrapper component to protect pages based on user role
 * Usage:
 * <ProtectedRoute module="reports">
 *   <ReportsPage />
 * </ProtectedRoute>
 */
export function ProtectedRoute({ children, module, fallback }: ProtectedRouteProps) {
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);
  const isAuthenticated = useAppSelector(state => state.auth.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      router.push('/login');
      return;
    }

    if (!hasModuleAccess(user.role, module)) {
      // User doesn't have access, redirect to default landing page for role
      router.push(getDefaultRouteForRole(user.role));
      return;
    }
  }, [isAuthenticated, user, module, router]);

  if (!user || !hasModuleAccess(user.role, module)) {
    return fallback ? (
      <>
        {fallback}
      </>
    ) : (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>You don't have permission to access this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}
