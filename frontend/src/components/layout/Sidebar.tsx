'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Home,
  Settings,
  ReceiptText,
  Truck,
  WalletCards,
  ClipboardList,
  Inbox,
  Package,
  Users,
  Send,
  BarChart3,
  SlidersHorizontal,
} from 'lucide-react';
import { useAppSelector } from '@/store';
import { hasModuleAccess } from '@/utils/rbac';
import { savePageState } from '@/utils/navigationStateStore';

interface SubItem {
  label: string;
  num: string;
  href: string;
  icon: any;
  module: string; // Track module for access control
}

interface NavItemConfig {
  label: string;
  href?: string;
  icon: any;
  isGroup: boolean;
  title?: string;
  items?: SubItem[];
  module?: string; // Track module for access control
}

const NAV_ITEMS: NavItemConfig[] = [
  { label: 'Dashboard', href: '/', icon: Home, isGroup: false, module: 'dashboard' },
  {
    label: 'Operations',
    icon: SlidersHorizontal,
    isGroup: true,
    title: 'OPERATIONS',
    items: [
      { label: 'Sales & Billing', num: '', href: '/sales', icon: ReceiptText, module: 'sales' },
      { label: 'Delivery',        num: '', href: '/delivery', icon: Truck, module: 'delivery' },
      { label: 'Collections',     num: '', href: '/collections', icon: WalletCards, module: 'collections' }
    ]
  },
  {
    label: 'Supply Chain',
    icon: Package,
    isGroup: true,
    title: 'SUPPLY CHAIN',
    items: [
      { label: 'Price List',      num: '', href: '/pricelist', icon: ClipboardList, module: 'pricelist' },
      { label: 'Purchases',       num: '', href: '/purchases', icon: Inbox, module: 'purchases' },
      { label: 'Inventory',       num: '', href: '/inventory', icon: Package, module: 'inventory' }
    ]
  },
  { label: 'Clients',   href: '/clients',   icon: Users, isGroup: false, module: 'clients' },
  { label: 'Expenses',  href: '/expenses',  icon: Send, isGroup: false, module: 'expenses' },
  { label: 'Employees', href: '/employees', icon: Users, isGroup: false, module: 'employees' },
  { label: 'Reports',   href: '/reports',   icon: BarChart3, isGroup: false, module: 'reports' },
  { label: 'Setting',   href: '/settings',  icon: Settings, isGroup: false, module: 'settings' }
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname  = usePathname();
  const router    = useRouter();
  const [loading, setLoading] = useState(false);
  const user = useAppSelector(state => state.auth.user);
  const isLoadingUser = useAppSelector(state => state.auth.isLoading);
  
  // Track hovered and clicked/locked groups for desktop hover/click behavior
  const [hoveredGroups, setHoveredGroups] = useState<Record<string, boolean>>({});
  const [lockedGroups, setLockedGroups] = useState<Record<string, boolean>>({
    'OPERATIONS': true,
    'SUPPLY CHAIN': true
  });
  
  // Collapsed mobile popup menu trigger index
  const [activePopupIdx, setActivePopupIdx] = useState<number | null>(null);

  useEffect(() => {
    // Prefetch all key module routes for instant 0ms transitions
    const routes = ['/', '/sales', '/inventory', '/clients', '/purchases', '/delivery', '/reports', '/employees', '/pricelist', '/collections', '/expenses', '/settings'];
    routes.forEach(r => {
      try { router.prefetch(r); } catch (e) {}
    });
  }, [router]);

  const handleNavClick = (href: string) => {
    if (typeof window !== 'undefined') {
      const currentPath = window.location.pathname;
      savePageState(currentPath, {}, window.scrollY);
    }
    if (onClose) onClose();
  };

  /**
   * Filter NAV_ITEMS based on user role with resilient fallbacks
   */
  const getAccessibleNavItems = (): NavItemConfig[] => {
    let activeRole = user?.role;

    // Check localStorage cached user if Redux state is temporarily unhydrated
    if (!activeRole && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('sabzi_user');
        if (raw) {
          const parsed = JSON.parse(raw);
          activeRole = parsed?.role;
        }
      } catch (e) {}
    }

    // Fallback: If no role is identified, render standard NAV_ITEMS so sidebar is never blank
    if (!activeRole) {
      return NAV_ITEMS;
    }

    return NAV_ITEMS.filter(item => {
      if (!item.module) return true;
      return hasModuleAccess(activeRole!, item.module);
    }).map(item => {
      if (item.isGroup && item.items) {
        return {
          ...item,
          items: item.items.filter(sub => hasModuleAccess(activeRole!, sub.module))
        };
      }
      return item;
    }).filter(item => {
      if (item.isGroup && item.items) {
        return item.items.length > 0;
      }
      return true;
    });
  };

  const accessibleNavItems = getAccessibleNavItems();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const isGroupActive = (items?: SubItem[]) =>
    items ? items.some(item => isActive(item.href)) : false;

  const isGroupOpen = (title: string) =>
    !!(lockedGroups[title] || hoveredGroups[title]);

  const handleGroupClick = (title: string) => {
    setLockedGroups(prev => ({ ...prev, [title]: !prev[title] }));
  };

  const handleGroupMouseEnter = (title: string) => {
    setHoveredGroups(prev => ({ ...prev, [title]: true }));
  };

  const handleGroupMouseLeave = (title: string) => {
    setHoveredGroups(prev => ({ ...prev, [title]: false }));
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  // Close popups on click outside
  useEffect(() => {
    const handleDocumentClick = () => {
      setActivePopupIdx(null);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('click', handleDocumentClick);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('click', handleDocumentClick);
      }
    };
  }, []);

  // Shared button styles to ensure identical category sizes
  const categoryButtonStyle = (active: boolean) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    fontSize: '14px',
    borderRadius: '10px',
    fontWeight: 600,
    boxSizing: 'border-box' as const,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    background: active ? 'var(--leaf)' : 'transparent',
    border: 'none',
    color: active ? '#fff' : 'rgba(250, 246, 236, 0.85)',
    textDecoration: 'none'
  });

  return (
    <div className={`va-side${isOpen ? ' open' : ''}`}>
      {/* Brand */}
      <div className="va-brand" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 14px 16px', borderBottom: '1px solid rgba(255,255,255,0.12)', marginBottom: '10px' }}>
        <div className="hide-collapsed">
          <div className="eyebrow">DAILY REGISTER</div>
          <h1 style={{ fontSize: '18px' }}>Halal Vegg Supplies</h1>
        </div>
        <div className="show-collapsed" style={{ fontSize: '24px', fontWeight: 'bold', width: '100%', textAlign: 'center' }}>
          🥬
        </div>

        {/* Mobile close button */}
        {onClose && (
          <button 
            type="button" 
            onClick={onClose} 
            className="va-mobile-close-btn"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--cream)',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px',
              display: 'none',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Nav List - Expanded (visible on desktop view) */}
      <nav className="va-nav hide-collapsed" aria-label="Main navigation" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {isLoadingUser && !user ? (
          <div style={{ padding: '16px 12px', color: 'rgba(250, 246, 236, 0.6)', fontSize: '13px', textAlign: 'center' }}>
            Loading navigation...
          </div>
        ) : (
          <>
            {accessibleNavItems.map((item, idx) => {
          if (!item.isGroup) {
            const href = item.href ?? '/';
            const active = isActive(href);
            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column' }}>
                <Link
                  href={href}
                  prefetch={true}
                  onClick={onClose}
                  className={`va-nav-btn${active ? ' active' : ''}`}
                  style={categoryButtonStyle(active)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}><item.icon size={20} weight="Bold" /></span>
                    <span>{item.label}</span>
                  </div>
                </Link>
              </div>
            );
          } else {
            const title = item.title ?? '';
            const active = isGroupActive(item.items);
            const open = isGroupOpen(title);
            return (
              <div 
                key={idx} 
                style={{ display: 'flex', flexDirection: 'column' }}
                onMouseEnter={() => handleGroupMouseEnter(title)}
                onMouseLeave={() => handleGroupMouseLeave(title)}
              >
                <button
                  type="button"
                  onClick={() => handleGroupClick(title)}
                  style={categoryButtonStyle(active)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}><item.icon size={20} weight="Bold" /></span>
                    <span>{item.label}</span>
                  </div>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>
                    {open ? '﹀' : '＞'}
                  </span>
                </button>

                {open && item.items && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1px',
                    paddingLeft: '24px',
                    marginTop: '4px'
                  }}>
                    {item.items.map((sub, itemIdx) => {
                      const isLast = itemIdx === item.items!.length - 1;
                      return (
                        <div key={sub.href} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                          {/* Vertical connector line */}
                          {!isLast && (
                            <div style={{
                              position: 'absolute',
                              left: '-16px',
                              top: 0,
                              bottom: 0,
                              width: '1.5px',
                              background: 'rgba(250,246,236,0.12)',
                            }} />
                          )}
                          {/* Curved branch line */}
                          <div style={{
                            position: 'absolute',
                            left: '-16px',
                            top: '-10px',
                            bottom: '50%',
                            width: '8px',
                            borderLeft: '1.5px solid rgba(250,246,236,0.12)',
                            borderBottom: '1.5px solid rgba(250,246,236,0.12)',
                            borderBottomLeftRadius: '6px',
                          }} />
                          <Link
                            href={sub.href}
                            prefetch={true}
                            onClick={onClose}
                            className={`va-nav-btn${isActive(sub.href) ? ' active' : ''}`}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '7px 10px',
                              fontSize: '13px',
                              borderRadius: '8px',
                              fontWeight: 500
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', marginRight: '2px' }}><sub.icon size={18} weight="Bold" /></span>
                            <span>{sub.label}</span>
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
        })}
          </>
        )}
      </nav>

      {/* Nav List - Collapsed/Slim (visible on mobile view) */}
      <nav className="va-nav show-collapsed" aria-label="Collapsed navigation" style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center', padding: '10px 0' }}>
        {isLoadingUser && !user ? (
          <div style={{ padding: '16px 12px', color: 'rgba(250, 246, 236, 0.6)', fontSize: '13px', textAlign: 'center' }}>
            Loading...
          </div>
        ) : (
          <>
            {accessibleNavItems.map((item, idx) => {
          if (!item.isGroup) {
            const href = item.href ?? '/';
            const active = isActive(href);
            return (
              <div key={idx} style={{ position: 'relative', display: 'flex', justifyContent: 'center', width: '100%' }}>
                <Link
                  href={href}
                  prefetch={true}
                  onClick={onClose}
                  className={`va-nav-btn${active ? ' active' : ''}`}
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    fontSize: '20px'
                  }}
                  title={item.label}
                >
                  <item.icon size={22} weight="Bold" />
                </Link>
              </div>
            );
          } else {
            const active = isGroupActive(item.items);
            return (
              <div
                key={idx}
                style={{ position: 'relative', display: 'flex', justifyContent: 'center', width: '100%' }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePopupIdx(activePopupIdx === idx ? null : idx);
                  }}
                  style={{
                    all: 'unset',
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                    cursor: 'pointer',
                    background: active ? 'var(--leaf)' : 'transparent',
                    border: active ? '1px solid rgba(250,246,236,0.2)' : '1px solid transparent',
                    color: active ? '#fff' : 'rgba(250,246,236,0.7)',
                    transition: 'all 0.15s'
                  }}
                >
                  <item.icon size={22} weight="Bold" />
                </button>

                {/* Popover floating submenu */}
                {activePopupIdx === idx && item.items && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: '52px',
                      top: '0',
                      width: '180px',
                      background: 'var(--forest)',
                      border: '1px solid rgba(250,246,236,0.15)',
                      borderRadius: '8px',
                      boxShadow: '4px 8px 30px rgba(0,0,0,0.4)',
                      zIndex: 100,
                      padding: '8px 0',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <div style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      color: 'var(--mustard)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      padding: '6px 14px 4px 14px',
                      borderBottom: '1px solid rgba(250,246,236,0.08)',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center' }}><item.icon size={12} weight="Bold" /></span>
                      <span>{item.label}</span>
                    </div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      paddingLeft: '24px',
                      paddingRight: '8px',
                      marginTop: '6px'
                    }}>
                      {item.items.map((sub, itemIdx) => {
                        const isLast = itemIdx === item.items!.length - 1;
                        return (
                          <div key={sub.href} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                            {/* Vertical connector line */}
                            {!isLast && (
                              <div style={{
                                position: 'absolute',
                                left: '-16px',
                                top: 0,
                                bottom: 0,
                                width: '1.5px',
                                background: 'rgba(250,246,236,0.12)',
                              }} />
                            )}
                            {/* Curved branch line */}
                            <div style={{
                              position: 'absolute',
                              left: '-16px',
                              top: '-10px',
                              bottom: '50%',
                              width: '8px',
                              borderLeft: '1.5px solid rgba(250,246,236,0.12)',
                              borderBottom: '1.5px solid rgba(250,246,236,0.12)',
                              borderBottomLeftRadius: '6px',
                            }} />
                            <Link
                              href={sub.href}
                              prefetch={true}
                              onClick={onClose}
                              className={`va-nav-btn${isActive(sub.href) ? ' active' : ''}`}
                              style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 8px',
                                fontSize: '13px',
                                borderRadius: '6px',
                                fontWeight: 500
                              }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', marginRight: '2px' }}><sub.icon size={18} weight="Bold" /></span>
                              <span>{sub.label}</span>
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          }
        })}
          </>
        )}
      </nav>

      {/* Logout */}
      <div className="va-side-foot">
        <div className="hide-collapsed">
          <button
            onClick={handleLogout}
            disabled={loading}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 11,
              color: 'rgba(250,246,236,0.6)',
              display: 'block',
              marginBottom: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(250,246,236,0.6)')}
          >
            {loading ? 'Signing out…' : '← Sign out'}
          </button>
          <div>Autosaves · shared</div>
        </div>
        <div className="show-collapsed" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
          <button
            onClick={handleLogout}
            disabled={loading}
            title="Sign out"
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 16,
              color: 'rgba(250,246,236,0.6)',
              display: 'block',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(250,246,236,0.6)')}
          >
            {loading ? '…' : '↩'}
          </button>
        </div>
      </div>
    </div>
  );
}
