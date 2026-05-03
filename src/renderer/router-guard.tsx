import { Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.store';

export default function RouterGuard({ children }: any) {
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  if (!isAuth) {
    return <Navigate to="/" replace />;
  }

  return children;
}