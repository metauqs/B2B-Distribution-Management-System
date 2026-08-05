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

  const { user, isAuthenticated, isCheckingSession } = useAppSelector(state => state.auth);

  // Perform session verification with HttpOnly cookie on initial mount
  useEffect(() => {
    dispatch(fetchCurrentUser());
  }, [dispatch]);

  // Auth Guard redirect if session is unauthenticated after verification check
  useEffect(() => {
    if (!isCheckingSession && (!isAuthenticated || !user)) {
      console.warn('🔒 Unauthenticated or expired session. Redirecting to login...');
      router.replace('/login?expired=true');
    }
  }, [isCheckingSession, isAuthenticated, user, router]);

  // Periodic heartbeat & window focus revalidation
  useEffect(() => {
    let lastChecked = 0;
    const CHECK_THROTTLE_MS = 15000;

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

  // Render Session Verification Loader while checking authentication with server
  if (isCheckingSession) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(circle at 50% 30%, #1F3D2B 0%, #152A1D 60%, #0D1B13 100%)',
        color: '#FAF6EC',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
        <div style={{
          width: '200px',
          maxHeight: '80px',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/logo.png" 
            alt="Halal Vegg Supplies Logo" 
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.4))',
            }}
          />
        </div>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#D99B26', fontWeight: 700, marginBottom: 4 }}>
          DAILY REGISTER
        </div>
        
        <div style={{
          marginTop: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(255,255,255,0.07)',
          padding: '9px 20px',
          borderRadius: 30,
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
        }}>
          <div style={{
            width: 15,
            height: 15,
            border: '2.5px solid #6FD89A',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite'
          }} />
          <span style={{ fontSize: 13, color: 'rgba(250,246,236,0.9)', fontWeight: 600 }}>Verifying Authentication Session…</span>
        </div>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Render null while redirecting unauthenticated users to /login
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
            background: 'rgba(27, 38, 30, 0.45)',
            backdropFilter: 'blur(3px)',
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
          {children}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
