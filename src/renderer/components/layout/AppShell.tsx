import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useAppStore } from '../../store/app.store';


type AppTheme = 'dark' | 'light';

function applyAppTheme(theme?: AppTheme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

type Role = 'admin' | 'cashier';

type MenuItem = {
  to: string;
  label: string;
  icon: string;
  title: string;
  roles?: Role[];
};

const menuItems: MenuItem[] = [
  { to: '/dashboard', label: 'الرئيسية', icon: '🏠', title: 'الرئيسية', roles: ['admin', 'cashier'] },
  { to: '/sales', label: 'المبيعات', icon: '🧾', title: 'المبيعات', roles: ['admin', 'cashier'] },
  { to: '/invoices', label: 'سجل الفواتير', icon: '📄', title: 'سجل الفواتير', roles: ['admin', 'cashier'] },
  { to: '/products', label: 'المنتجات', icon: '👕', title: 'المنتجات', roles: ['admin'] },
  { to: '/inventory', label: 'المخزون', icon: '📦', title: 'المخزون', roles: ['admin'] },
  { to: '/stock-count', label: 'الجرد', icon: '🧮', title: 'الجرد', roles: ['admin', 'cashier'] },
  { to: '/customers', label: 'العملاء', icon: '👤', title: 'العملاء', roles: ['admin', 'cashier'] },
  { to: '/suppliers', label: 'الموردين', icon: '🚚', title: 'الموردين', roles: ['admin', 'cashier'] },
  { to: '/purchases', label: 'فواتير الشراء', icon: '🛒', title: 'فواتير الشراء', roles: ['admin', 'cashier'] },
  { to: '/purchase-history', label: 'سجل الشراء', icon: '📑', title: 'سجل الشراء', roles: ['admin', 'cashier'] },
  { to: '/users', label: 'المستخدمين', icon: '👥', title: 'المستخدمين', roles: ['admin'] },
  { to: '/reports', label: 'التقارير', icon: '📊', title: 'التقارير', roles: ['admin'] },
  { to: '/expenses', label: 'المصروفات', icon: '💳', title: 'المصروفات', roles: ['admin', 'cashier'] },
  { to: '/cash', label: 'الخزنة', icon: '💵', title: 'الخزنة', roles: ['admin'] },
  { to: '/activity', label: 'سجل العمليات', icon: '🕘', title: 'سجل العمليات', roles: ['admin'] },
  { to: '/settings', label: 'الإعدادات', icon: '⚙️', title: 'الإعدادات', roles: ['admin'] }
];

export default function AppShell({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const { sidebarOpen, toggleSidebar } = useAppStore();

  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [appLogoUrl, setAppLogoUrl] = useState('');
  const [appName, setAppName] = useState('ERP Store');

  const [appTheme, setAppTheme] = useState<'dark' | 'light'>(
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
  );

  function applyTheme(theme: 'dark' | 'light') {
    setAppTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  async function changeTheme(theme: 'dark' | 'light') {
    applyTheme(theme);

    try {
      const result = await window.api.saveAppTheme(theme, {
        actor_id: user?.id
      });

      if (result?.success === false) {
        return;
      }

      if (result?.status?.app_theme) {
        applyTheme(result.status.app_theme === 'light' ? 'light' : 'dark');

        window.dispatchEvent(
          new CustomEvent('license-status-changed', {
            detail: result.status
          })
        );
      }
    } catch (error) {
      console.error('Failed to save app theme:', error);
    }
  }
  const isLight = appTheme === 'light';

  const userRole: Role = user?.role === 'admin' ? 'admin' : 'cashier';

  const visibleMenuItems = menuItems.filter((item) =>
    item.roles ? item.roles.includes(userRole) : true
  );

  const effectiveSidebarOpen = isMobile ? true : sidebarOpen;

  useEffect(() => {
    function handleResize() {
      const nextIsMobile = window.innerWidth <= 900;
      setIsMobile(nextIsMobile);

      if (!nextIsMobile) {
        setMobileMenuOpen(false);
      }
    }

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    void window.api
      .getLicenseStatus()
      .then((status) => {
        setAppLogoUrl(status.app_logo_url || '');
        setAppName(status.app_name || 'ERP Store');
        const nextTheme = status.app_theme === 'light' ? 'light' : 'dark';
        applyTheme(nextTheme);
      })
      .catch(() => {
        setAppLogoUrl('');
        setAppName('ERP Store');
      });
  }, []);

  function handleLogout() {
    logout();
    navigate('/');
  }

  useEffect(() => {
    function handleLicenseChanged(event: Event) {
      const customEvent = event as CustomEvent<any>;

      if (customEvent.detail) {
        setAppLogoUrl(customEvent.detail.app_logo_url || '');
        setAppName(customEvent.detail.app_name || 'ERP Store');
        const nextTheme = customEvent.detail.app_theme === 'light' ? 'light' : 'dark';
        setAppTheme(nextTheme);
        document.documentElement.setAttribute('data-theme', nextTheme);
        applyAppTheme(customEvent.detail.app_theme);
      }
    }

    window.addEventListener('license-status-changed', handleLicenseChanged);

    return () => {
      window.removeEventListener('license-status-changed', handleLicenseChanged);
    };
  }, []);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : sidebarOpen ? '280px 1fr' : '92px 1fr',
        gridTemplateAreas: isMobile ? '"main"' : '"sidebar main"',
        minHeight: '100vh',
        height: '100vh',
        gap: isMobile ? '10px' : '16px',
        padding: isMobile ? '10px' : '16px',
        background: isLight ? '#eef2ff' : '#08152f',
        color: isLight ? '#111827' : '#fff',
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        transition: 'grid-template-columns 0.25s ease',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      {isMobile && mobileMenuOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            border: 'none',
            background: 'rgba(0,0,0,0.55)',
            cursor: 'pointer'
          }}
        />
      )}

      <main
        style={{
          gridArea: 'main',
          display: 'grid',
          gridTemplateRows: isMobile ? 'auto minmax(0, 1fr)' : '88px minmax(0, 1fr)',
          gap: isMobile ? '10px' : '16px',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        <header
          style={{
            background: isLight ? 'rgba(255,255,255,0.96)' : 'rgba(17,24,39,0.85)',
            border: isLight ? '1px solid rgba(15,23,42,0.10)' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: isMobile ? '18px' : '24px',
            padding: isMobile ? '14px' : '20px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ minWidth: 0 }}>
             <div style={{ color: isLight ? '#64748b' : '#94a3b8', fontSize: '13px', marginBottom: '6px' }}>
              أهلاً بك
            </div>

            <h1
              style={{
                margin: 0,
                fontSize: isMobile ? '21px' : '28px',
                lineHeight: 1.25,
                color: isLight ? '#0f172a' : '#fff',
                wordBreak: 'break-word'
              }}
            >
              {title}
            </h1>
          </div>

          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              style={mobileMenuButtonStyle}
            >
              ☰
            </button>
          )}
        </header>

        <section
          style={{
            background: isLight ? 'rgba(248,250,252,0.95)' : 'rgba(17,24,39,0.7)',
            border: isLight ? '1px solid rgba(15,23,42,0.10)' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: isMobile ? '18px' : '24px',
            padding: isMobile ? '12px' : '24px',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            boxSizing: 'border-box'
          }}
        >
          {children}
        </section>
      </main>

      <aside
        style={{
          gridArea: isMobile ? undefined : 'sidebar',
          position: isMobile ? 'fixed' : 'static',
          top: isMobile ? '10px' : undefined,
          bottom: isMobile ? '10px' : undefined,
          right: isMobile ? '10px' : undefined,
          zIndex: isMobile ? 9999 : undefined,
          width: isMobile ? 'min(320px, calc(100vw - 20px))' : undefined,
          transform: isMobile
            ? mobileMenuOpen
              ? 'translateX(0)'
              : 'translateX(120%)'
            : 'none',
          transition: 'transform 0.25s ease',
          background: isLight ? 'rgba(255,255,255,0.94)' : 'rgba(10,20,40,0.96)',
          border: isLight ? '1px solid rgba(15,23,42,0.10)' : '1px solid rgba(255,255,255,0.08)',
          boxShadow: isLight ? '0 18px 45px rgba(15,23,42,0.12)' : undefined,
          borderRadius: isMobile ? '18px' : '24px',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          boxSizing: 'border-box'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: effectiveSidebarOpen ? 'space-between' : 'center',
            gap: '10px',
            marginBottom: '18px'
          }}
        >
          {effectiveSidebarOpen ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                justifyContent: 'flex-end',
                width: '100%'
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: '22px', textAlign: 'right' }}>
                  {appName}
                </h2>

                <div
                  style={{
                    color: '#94a3b8',
                    fontSize: '13px',
                    marginTop: '6px',
                    textAlign: 'right'
                  }}
                >
                  نظام إدارة محل الملابس
                </div>
              </div>

              <LogoBox appLogoUrl={appLogoUrl} size={42} />
            </div>
          ) : (
            <LogoBox appLogoUrl={appLogoUrl} size={42} />
          )}

          <button
            type="button"
            onClick={() => {
              if (isMobile) {
                setMobileMenuOpen(false);
              } else {
                toggleSidebar();
              }
            }}
            title={isMobile ? 'إغلاق القائمة' : sidebarOpen ? 'إخفاء القائمة' : 'إظهار القائمة'}
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              border: isLight ? '1px solid rgba(15,23,42,0.10)' : '1px solid rgba(255,255,255,0.08)',
              background: isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.05)',
              color: isLight ? '#111827' : '#fff',
              cursor: 'pointer',
              fontSize: '18px',
              flexShrink: 0
            }}
          >
            {isMobile ? '×' : sidebarOpen ? '‹' : '›'}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: effectiveSidebarOpen ? '1fr 1fr' : '1fr',
            gap: '8px',
            marginBottom: '12px'
          }}
        >
          <button
            type="button"
            title="الوضع النهاري"
            onClick={() => void changeTheme('light')}
            style={themeButtonStyle(appTheme === 'light', effectiveSidebarOpen)}
          >
            ☀️
            {effectiveSidebarOpen && <span>نهاري</span>}
          </button>

          <button
            type="button"
            title="الوضع الليلي"
            onClick={() => void changeTheme('dark')}
            style={themeButtonStyle(appTheme === 'dark', effectiveSidebarOpen)}
          >
            🌙
            {effectiveSidebarOpen && <span>ليلي</span>}
          </button>
        </div>

        <nav style={{ display: 'grid', gap: '10px' }}>
          {visibleMenuItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.title}
              onClick={() => {
                if (isMobile) {
                  setMobileMenuOpen(false);
                  return;
                }

                if (sidebarOpen) {
                  toggleSidebar();
                }
              }}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: effectiveSidebarOpen ? 'flex-start' : 'center',
                gap: '12px',
                minHeight: '50px',
                padding: effectiveSidebarOpen ? '12px 14px' : '12px',
                borderRadius: '16px',
                textDecoration: 'none',
                color: isActive ? '#fff' : isLight ? '#334155' : '#fff',
                background: isActive
                  ? 'linear-gradient(135deg, #2563eb, #3b82f6)'
                  : isLight
                    ? 'rgba(15,23,42,0.04)'
                    : 'rgba(255,255,255,0.04)',
                border: isActive
                  ? '1px solid rgba(37,99,235,0.30)'
                  : isLight
                    ? '1px solid rgba(15,23,42,0.06)'
                    : '1px solid rgba(255,255,255,0.05)',
                textAlign: 'right',
                fontWeight: 600,
                transition: '0.2s ease'
              })}
            >
              <span style={{ fontSize: '20px', width: '24px', textAlign: 'center' }}>
                {item.icon}
              </span>

              {effectiveSidebarOpen ? (
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {item.label}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'grid', gap: '12px', paddingTop: '16px' }}>
          <div
            style={{
              borderRadius: '18px',
              padding: effectiveSidebarOpen ? '16px' : '12px 8px',
              background:
                'linear-gradient(135deg, rgba(37,99,235,0.18), rgba(139,92,246,0.12))',
              border: '1px solid rgba(255,255,255,0.08)',
              textAlign: effectiveSidebarOpen ? 'right' : 'center'
            }}
          >
            {effectiveSidebarOpen ? (
              <>
                <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '6px' }}>
                  المستخدم الحالي
                </div>

                <div style={{ fontWeight: 700, fontSize: '16px' }}>
                  {user?.name || '—'}
                </div>

                <div style={{ color: '#60a5fa', fontSize: '13px', marginTop: '4px' }}>
                  {user?.role === 'admin' ? 'مدير النظام' : 'كاشير'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '20px' }}>👤</div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            title="تسجيل خروج"
            style={{
              width: '100%',
              height: '46px',
              borderRadius: '14px',
              border: '1px solid rgba(239,68,68,0.35)',
              background: 'rgba(239,68,68,0.12)',
              color: '#f87171',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {effectiveSidebarOpen ? 'تسجيل خروج' : '⎋'}
          </button>
        </div>
      </aside>
    </div>
  );
}

function LogoBox({
  appLogoUrl,
  size
}: {
  appLogoUrl: string;
  size: number;
}) {
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '12px',
        background: 'linear-gradient(135deg, #2563eb, #8b5cf6)',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0
      }}
    >
      {appLogoUrl ? (
        <img
          key={appLogoUrl}
          src={appLogoUrl}
          alt="App Logo"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span style={{ fontSize: '20px' }}>👕</span>
      )}
    </div>
  );
}

const mobileMenuButtonStyle: React.CSSProperties = {
  width: '42px',
  height: '42px',
  borderRadius: '12px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '20px'
};

function themeButtonStyle(active: boolean, expanded: boolean): React.CSSProperties {
  return {
    minHeight: '42px',
    borderRadius: '14px',
    border: active
      ? '1px solid rgba(37,99,235,0.45)'
      : '1px solid rgba(255,255,255,0.10)',
    background: active
      ? 'linear-gradient(135deg, #2563eb, #7c3aed)'
      : 'rgba(255,255,255,0.06)',
    color: active ? '#ffffff' : 'var(--text)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: 900,
    cursor: 'pointer',
    padding: expanded ? '0 12px' : '0',
    width: '100%'
  };
}