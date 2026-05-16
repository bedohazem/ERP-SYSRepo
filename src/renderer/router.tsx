import React from 'react';
import RouterGuard from './router-guard';
import { createHashRouter } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/Auth/LoginPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
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
import CashPage from './pages/Cash/CashPage';
import ExpensesPage from './pages/Expenses/ExpensesPage';
import UsersPage from './pages/Users/UsersPage';
import ActivityLogPage from './pages/Activity/ActivityLogPage';

type Role = 'admin' | 'cashier';

function withShell(
  title: string,
  element: React.ReactNode,
  allowedRoles?: Role[]
) {
  return (
    <RouterGuard allowedRoles={allowedRoles}>
      <AppShell title={title}>{element}</AppShell>
    </RouterGuard>
  );
}

export const router = createHashRouter([
  {
    path: '/',
    element: <LoginPage />
  },
  {
    path: '/dashboard',
    element: withShell('الرئيسية', <DashboardPage />, ['admin', 'cashier'])
  },
  {
    path: '/products',
    element: withShell('المنتجات', <ProductsPage />, ['admin'])
  },
  {
    path: '/inventory',
    element: withShell('المخزون', <InventoryPage />, ['admin'])
  },
  {
    path: '/sales',
    element: withShell('المبيعات', <SalesPage />, ['admin', 'cashier'])
  },
  {
    path: '/invoices',
    element: withShell('سجل الفواتير', <InvoicesPage />, ['admin', 'cashier'])
  },
  {
    path: '/customers',
    element: withShell('العملاء', <CustomersPage />, ['admin', 'cashier'])
  },
  {
    path: '/suppliers',
    element: withShell('الموردين', <SuppliersPage />, ['admin', 'cashier'])
  },
  {
    path: '/purchases',
    element: withShell('فواتير الشراء', <PurchasesPage />, ['admin', 'cashier'])
  },
  {
    path: '/purchase-history',
    element: withShell('سجل الشراء', <PurchaseHistoryPage />, ['admin', 'cashier'])
  },
  {
    path: '/reports',
    element: withShell('التقارير', <ReportsPage />, ['admin'])
  },
  {
    path: '/settings',
    element: withShell('الإعدادات', <SettingsPage />, ['admin'])
  },
  {
    path: '/cash',
    element: withShell('الخزنة', <CashPage />, ['admin'])
  },
  {
    path: '/expenses',
    element: withShell('المصروفات', <ExpensesPage />, ['admin'])
  },  
  {
    path: '/users',
    element: withShell('المستخدمين', <UsersPage />, ['admin'])
  },
  {
    path: '/activity',
    element: withShell('سجل العمليات', <ActivityLogPage />, ['admin'])
  },
  
]);