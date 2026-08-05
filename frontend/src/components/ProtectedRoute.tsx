'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAppSelector } from '@/store';
import { hasModuleAccess, getDefaultRouteForRole } from '@/utils/rbac';

interface ProtectedRouteProps {
  children: React.ReactNode;
  module: string;
  fallback?: React.ReactNode;
}

export function ProtectedRoute({ children, module, fallback }: ProtectedRouteProps) {
  const router = useRouter();
  const { user, isAuthenticated, isCheckingSession } = useAppSelector(state => state.auth);

  useEffect(() => {
    if (!isCheckingSession) {
      if (!isAuthenticated || !user) {
        router.replace('/login?expired=true');
        return;
      }

      if (!hasModuleAccess(user.role, module)) {
        router.replace(getDefaultRouteForRole(user.role));
        return;
      }
    }
  }, [isCheckingSession, isAuthenticated, user, module, router]);

  if (isCheckingSession) {
    return null;
  }

  if (!user || !isAuthenticated || !hasModuleAccess(user.role, module)) {
    return fallback ? <>{fallback}</> : null;
  }

  return <>{children}</>;
}
