'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastContainer } from '@/components/ui/Toast';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
