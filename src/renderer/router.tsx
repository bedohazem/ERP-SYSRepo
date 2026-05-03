import React from 'react';
import { createHashRouter } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/Auth/LoginPage';
import ProductsPage from './pages/Products/ProductsPage';
import SettingsPage from './pages/Settings/SettingsPage';
import SalesPage from './pages/Sales/SalesPage';
import CustomersPage from './pages/Customers/CustomersPage';


function DashboardPage() {
  return <div>دي لوحة التحكم</div>;
}

function SuppliersPage() {
  return <div>دي صفحة الموردين</div>;
}

function ReportsPage() {
  return <div>دي صفحة التقارير</div>;
}

function withShell(title: string, element: React.ReactNode) {
  return <AppShell title={title}>{element}</AppShell>;
}

export const router = createHashRouter([
  {
    path: '/',
    element: <LoginPage />
  },
  {
    path: '/dashboard',
    element: withShell('الرئيسية', <DashboardPage />)
  },
  {
    path: '/products',
    element: withShell('المنتجات', <ProductsPage />)
  },
  {
    path: '/sales',
    element: withShell('المبيعات', <SalesPage />)
  },
  {
    path: '/customers',
    element: withShell('العملاء', <CustomersPage />)
  },
  {
    path: '/suppliers',
    element: withShell('الموردين', <SuppliersPage />)
  },
  {
    path: '/reports',
    element: withShell('التقارير', <ReportsPage />)
  },
  {
    path: '/settings',
    element: withShell('الإعدادات', <SettingsPage />)
  }
]);