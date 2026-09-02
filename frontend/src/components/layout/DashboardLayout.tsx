'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastContainer } from '@/components/ui/Toast';
import { apiFetch } from '@/utils/apiFetch';
import { useAppDispatch, useAppSelector } from '@/store';
import { fetchCurrentUser } from '@/store/slices/authSlice';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const { user, isAuthenticated } = useAppSelector(state => state.auth);

  // Background silent session validation only if user state is not already hydrated
  useEffect(() => {
    if (!user || !isAuthenticated) {
      dispatch(fetchCurrentUser()).then((action) => {
        if (fetchCurrentUser.rejected.match(action)) {
          const payload = action.payload as string;
          if (payload?.includes('expired') || payload?.includes('invalid')) {
            console.warn('🔒 Session invalid or expired. Redirecting to login...');
            router.replace('/login?expired=true');
          }
        }
      });
    }
  }, [dispatch, router, user, isAuthenticated]);

  // Periodic background heartbeat & tab focus revalidation (throttled to 120s to save mobile battery)
  useEffect(() => {
    let lastChecked = 0;
    const CHECK_THROTTLE_MS = 120000;

    const handleResume = async () => {
      const now = Date.now();
      if (now - lastChecked < CHECK_THROTTLE_MS) return;
      lastChecked = now;

      try {
        const res = await apiFetch('/api/health');
        if (res.status === 401) {
          router.replace('/login?expired=true');
          return;
        }
        window.dispatchEvent(new Event('app-revalidate'));
      } catch (err) {
        console.warn('⚠️ Network check error:', err);
      }
    };

    window.addEventListener('focus', handleResume);
    const handleVis = () => {
      if (document.visibilityState === 'visible') handleResume();
    };
    document.addEventListener('visibilitychange', handleVis);
    window.addEventListener('pageshow', handleResume);
    window.addEventListener('online', handleResume);

    return () => {
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleVis);
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('online', handleResume);
    };
  }, [router]);

  // If unauthenticated, redirect smoothly to /login without visual blocking overlay
  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="va-app">
      {isSidebarOpen && (
        <div 
          className="va-side-backdrop" 
          onClick={() => setIsSidebarOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(27, 38, 30, 0.55)',
            zIndex: 35,
            transition: 'opacity 0.2s ease',
          }}
        />
      )}
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
      />
      <div className="va-main">
        <Topbar onMenuToggle={() => setIsSidebarOpen(true)} />
        <div className="va-content" id="va-content">
          <div className="va-page-flow">
            {children}
          </div>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
