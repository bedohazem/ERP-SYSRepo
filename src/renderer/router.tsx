import React from 'react';
import { createHashRouter } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/Auth/LoginPage';
import ProductsPage from './pages/Products/ProductsPage';
import SettingsPage from './pages/Settings/SettingsPage';
import SalesPage from './pages/Sales/SalesPage';
import CustomersPage from './pages/Customers/CustomersPage';
import InvoicesPage from './pages/Invoices/InvoicesPage';
import ReportsPage from './pages/Reports/ReportsPage';
import InventoryPage from './pages/Inventory/InventoryPage';
import SuppliersPage from './pages/Suppliers/SuppliersPage';
import PurchasesPage from './pages/Purchases/PurchasesPage';
import PurchaseHistoryPage from './pages/Purchases/PurchaseHistoryPage';

function DashboardPage() {
  return <div>دي لوحة التحكم</div>;
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
    path: '/inventory',
    element: withShell('المخزون', <InventoryPage />)
  },
  {
    path: '/sales',
    element: withShell('المبيعات', <SalesPage />)
  },
  {
    path: '/invoices',
    element: withShell('سجل الفواتير', <InvoicesPage />)
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
    path: '/purchases',
    element: withShell('فواتير الشراء', <PurchasesPage />)
  },
  {
    path: '/purchase-history',
    element: withShell('سجل الشراء', <PurchaseHistoryPage />)
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