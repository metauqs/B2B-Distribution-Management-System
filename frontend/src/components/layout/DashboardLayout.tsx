'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastContainer } from '@/components/ui/Toast';
import { apiFetch } from '@/utils/apiFetch';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    let lastChecked = 0;
    const CHECK_THROTTLE_MS = 10000; // Max once per 10 seconds

    const handleResume = async () => {
      const now = Date.now();
      if (now - lastChecked < CHECK_THROTTLE_MS) return;
      lastChecked = now;

      console.log('🔄 Tab resume/focus or online event. Verifying session...');

      try {
        const res = await apiFetch('/api/health');
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        window.dispatchEvent(new Event('app-revalidate'));
      } catch (err) {
        console.warn('⚠️ Network or backend unreachable:', err);
      }
    };

    window.addEventListener('focus', handleResume);
    const handleVis = () => {
      if (document.visibilityState === 'visible') {
        handleResume();
      }
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
  }, []);

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
