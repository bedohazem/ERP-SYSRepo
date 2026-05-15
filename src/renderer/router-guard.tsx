import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/auth.store';

type Role = 'admin' | 'cashier';

type RouterGuardProps = {
  children: ReactNode;
  allowedRoles?: Role[];
};

export default function RouterGuard({ children, allowedRoles }: RouterGuardProps) {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!isAuth) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  const userRole: Role = user?.role === 'admin' ? 'admin' : 'cashier';

  if (allowedRoles && !allowedRoles.includes(userRole)) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
}

function ForbiddenPage() {
  return (
    <div
      className="glass-card"
      style={{
        minHeight: '360px',
        borderRadius: '24px',
        padding: '36px',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        gap: '14px'
      }}
    >
      <div style={{ fontSize: '54px' }}>🔒</div>

      <h2 style={{ margin: 0 }}>غير مصرح لك بالدخول</h2>

      <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700, lineHeight: 1.8 }}>
        هذه الصفحة متاحة لمدير النظام فقط.
      </p>
    </div>
  );
}