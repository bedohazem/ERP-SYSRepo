import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useAppStore } from '../../store/app.store';

type MenuItem = {
  to: string;
  label: string;
  icon: string;
  title: string;
};

const menuItems: MenuItem[] = [
  { to: '/dashboard', label: 'الرئيسية', icon: '🏠' ,title: 'الرئيسية'},
  { to: '/sales', label: 'المبيعات', icon: '🧾' ,title: 'المبيعات'},
  { to: '/invoices', label: 'سجل الفواتير', icon: '📄' ,title: 'سجل الفواتير'},
  { to: '/products', label: 'المنتجات', icon: '👕' ,title: 'المنتجات'},
  { to: '/inventory', label: 'المخزون', icon: '📦', title: 'المخزون' },
  { to: '/customers', label: 'العملاء', icon: '👤' ,title: 'العملاء'},
  { to: '/suppliers', label: 'الموردين', icon: '🚚' ,title: 'الموردين'},
  { to: '/purchases', label: 'فواتير الشراء', icon: '🛒', title: 'فواتير الشراء' },
  { to: '/purchase-history', label: 'سجل الشراء', icon: '📑', title: 'سجل الشراء' },
  { to: '/reports', label: 'التقارير', icon: '📊' ,title: 'التقارير'},
  { to: '/settings', label: 'الإعدادات', icon: '⚙️' ,title: 'الإعدادات'}
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

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: sidebarOpen ? '280px 1fr' : '92px 1fr',
        gridTemplateAreas: '"sidebar main"',
        minHeight: '100vh',
        height: '100vh',
        gap: '16px',
        padding: '16px',
        background: '#08152f',
        color: '#fff',
        fontFamily: 'Segoe UI, Tahoma, sans-serif',
        transition: 'grid-template-columns 0.25s ease',
        overflow: 'hidden',
         boxSizing: 'border-box'
      }}
    >
      <main
        style={{
          gridArea: 'main',
          display: 'grid',
          gridTemplateRows: '88px minmax(0, 1fr)',
          gap: '16px',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        <header
          style={{
            background: 'rgba(17,24,39,0.85)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '24px',
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '6px' }}>
              أهلاً بك
            </div>
            <h1 style={{ margin: 0, fontSize: '28px' }}>{title}</h1>
          </div>
        </header>

        <section
          style={{
            background: 'rgba(17,24,39,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '24px',
            padding: '24px',
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
          gridArea: 'sidebar',
          background: 'rgba(10,20,40,0.92)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px',
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
            justifyContent: sidebarOpen ? 'space-between' : 'center',
            gap: '10px',
            marginBottom: '18px'
          }}
        >
          {sidebarOpen ? (
            <div>
              <h2 style={{ margin: 0, fontSize: '22px', textAlign: 'right' }}>ERP Store</h2>
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
          ) : null}

          <button
            onClick={toggleSidebar}
            title={sidebarOpen ? 'إخفاء القائمة' : 'إظهار القائمة'}
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '18px',
              flexShrink: 0
            }}
          >
            {sidebarOpen ? '‹' : '›'}
          </button>
        </div>

        <nav style={{ display: 'grid', gap: '10px' }}>
          {menuItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.title}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: sidebarOpen ? 'flex-start' : 'center',
                gap: '12px',
                minHeight: '52px',
                padding: sidebarOpen ? '12px 14px' : '12px',
                borderRadius: '16px',
                textDecoration: 'none',
                color: '#fff',
                background: isActive
                  ? 'linear-gradient(135deg, #2563eb, #3b82f6)'
                  : 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.05)',
                textAlign: 'right',
                fontWeight: 600,
                transition: '0.2s ease'
              })}
            >
              <span style={{ fontSize: '20px', width: '24px', textAlign: 'center' }}>
                {item.icon}
              </span>

              {sidebarOpen ? (
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{item.label}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'grid', gap: '12px' }}>
          <div
            style={{
              borderRadius: '18px',
              padding: sidebarOpen ? '16px' : '12px 8px',
              background:
                'linear-gradient(135deg, rgba(37,99,235,0.18), rgba(139,92,246,0.12))',
              border: '1px solid rgba(255,255,255,0.08)',
              textAlign: sidebarOpen ? 'right' : 'center'
            }}
          >
            {sidebarOpen ? (
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
            onClick={() => {
              logout();
              navigate('/');
            }}
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
            {sidebarOpen ? 'تسجيل خروج' : '⎋'}
          </button>
        </div>
      </aside>
    </div>
  );
}