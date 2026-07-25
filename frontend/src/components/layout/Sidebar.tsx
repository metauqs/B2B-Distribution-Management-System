'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { 
  Home,
  Settings,
  BillList,
  Delivery,
  WalletMoney,
  ClipboardList,
  InboxIn,
  BoxMinimalistic,
  UsersGroupTwoRounded,
  UsersGroupRounded,
  CardSend,
  GraphNew,
  Tuning
} from '@solar-icons/react';

interface SubItem {
  label: string;
  num: string;
  href: string;
  icon: any;
}

interface NavItemConfig {
  label: string;
  href?: string;
  icon: any;
  isGroup: boolean;
  title?: string;
  items?: SubItem[];
}

const NAV_ITEMS: NavItemConfig[] = [
  { label: 'Dashboard', href: '/', icon: Home, isGroup: false },
  {
    label: 'Operations',
    icon: Tuning,
    isGroup: true,
    title: 'OPERATIONS',
    items: [
      { label: 'Sales & Billing', num: '', href: '/sales', icon: BillList },
      { label: 'Delivery',        num: '', href: '/delivery', icon: Delivery },
      { label: 'Collections',     num: '', href: '/collections', icon: WalletMoney }
    ]
  },
  {
    label: 'Supply Chain',
    icon: BoxMinimalistic,
    isGroup: true,
    title: 'SUPPLY CHAIN',
    items: [
      { label: 'Price List',      num: '', href: '/pricelist', icon: ClipboardList },
      { label: 'Purchases',       num: '', href: '/purchases', icon: InboxIn },
      { label: 'Inventory',       num: '', href: '/inventory', icon: BoxMinimalistic }
    ]
  },
  { label: 'Clients',   href: '/clients',   icon: UsersGroupRounded, isGroup: false },
  { label: 'Expenses',  href: '/expenses',  icon: CardSend, isGroup: false },
  { label: 'Employees', href: '/employees', icon: UsersGroupTwoRounded, isGroup: false },
  { label: 'Reports',   href: '/reports',   icon: GraphNew, isGroup: false },
  { label: 'Setting',   href: '/settings',  icon: Settings, isGroup: false }
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname  = usePathname();
  const router    = useRouter();
  const [loading, setLoading] = useState(false);
  
  // Track hovered and clicked/locked groups for desktop hover/click behavior
  const [hoveredGroups, setHoveredGroups] = useState<Record<string, boolean>>({});
  const [lockedGroups, setLockedGroups] = useState<Record<string, boolean>>({
    'OPERATIONS': true,
    'SUPPLY CHAIN': true
  });
  
  // Collapsed mobile popup menu trigger index
  const [activePopupIdx, setActivePopupIdx] = useState<number | null>(null);

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
        {NAV_ITEMS.map((item, idx) => {
          if (!item.isGroup) {
            const href = item.href ?? '/';
            const active = isActive(href);
            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column' }}>
                <Link
                  href={href}
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
      </nav>

      {/* Nav List - Collapsed/Slim (visible on mobile view) */}
      <nav className="va-nav show-collapsed" aria-label="Collapsed navigation" style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center', padding: '10px 0' }}>
        {NAV_ITEMS.map((item, idx) => {
          if (!item.isGroup) {
            const href = item.href ?? '/';
            const active = isActive(href);
            return (
              <div key={idx} style={{ position: 'relative', display: 'flex', justifyContent: 'center', width: '100%' }}>
                <Link
                  href={href}
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
