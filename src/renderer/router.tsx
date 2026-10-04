import React from 'react';
import RouterGuard from './router-guard';
import { createHashRouter } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/Auth/LoginPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import ProductsPage from './pages/Products/ProductsPage';
import PromotionsPage from './pages/Promotions/PromotionsPage';
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
import ShiftManagementPage from './pages/Shifts/ShiftManagementPage';
import ExpensesPage from './pages/Expenses/ExpensesPage';
import UsersPage from './pages/Users/UsersPage';
import ActivityLogPage from './pages/Activity/ActivityLogPage';
import StockCountPage from './pages/StockCount/StockCountPage';
import LiabilitiesPage from './pages/Liabilities/LiabilitiesPage';
import AboutPage from './pages/About/AboutPage';
import type { PermissionKey } from '../shared/permissions';

type Role = 'admin' | 'cashier';

function withShell(
  title: string,

  element: React.ReactNode,

  options?: {
    allowedRoles?: Role[];

    permission?: PermissionKey;
  },
) {
  return (
    <RouterGuard
      allowedRoles={options?.allowedRoles}
      requiredPermission={options?.permission}
    >
      <AppShell title={title}>{element}</AppShell>
    </RouterGuard>
  );
}

export const router = createHashRouter([
  {
    path: '/',
    element: <LoginPage />,
  },
  {
    path: '/dashboard',
    element: withShell('الرئيسية', <DashboardPage />, {
      permission: 'dashboard.view',
    }),
  },
  {
    path: '/products',
    element: withShell('المنتجات', <ProductsPage />, {
      permission: 'products.manage',
    }),
  },
  {
    path: '/promotions',
    element: withShell('العروض', <PromotionsPage />, {
      permission: 'promotions.manage',
    }),
  },
  {
    path: '/inventory',
    element: withShell('المخزون', <InventoryPage />, {
      permission: 'inventory.view',
    }),
  },
  {
    path: '/stock-count',
    element: withShell('الجرد', <StockCountPage />, {
      permission: 'stock_count.view',
    }),
  },
  {
    path: '/sales',
    element: withShell('المبيعات', <SalesPage />, {
      permission: 'sales.use',
    }),
  },
  {
    path: '/invoices',
    element: withShell('سجل الفواتير', <InvoicesPage />, {
      permission: 'sales.history',
    }),
  },
  {
    path: '/customers',
    element: withShell('العملاء', <CustomersPage />, {
      permission: 'customers.view',
    }),
  },
  {
    path: '/suppliers',
    element: withShell('الموردين', <SuppliersPage />, {
      permission: 'suppliers.manage',
    }),
  },
  {
    path: '/purchases',
    element: withShell('فواتير الشراء', <PurchasesPage />, {
      permission: 'purchases.manage',
    }),
  },
  {
    path: '/purchase-history',
    element: withShell('سجل الشراء', <PurchaseHistoryPage />, {
      permission: 'purchases.manage',
    }),
  },
  {
    path: '/reports',
    element: withShell('التقارير', <ReportsPage />, {
      permission: 'reports.view',
    }),
  },
  {
    path: '/cash',
    element: withShell('الخزنة', <CashPage />, {
      permission: 'cash.manage',
    }),
  },
  {
    path: '/shifts',
    element: withShell('إدارة الشفتات', <ShiftManagementPage />, {
      permission: 'shifts.manage',
    }),
  },
  {
    path: '/expenses',
    element: withShell('المصروفات', <ExpensesPage />, {
      permission: 'expenses.view',
    }),
  },
  {
    path: '/users',
    element: withShell('المستخدمين', <UsersPage />, {
      allowedRoles: ['admin'],
    }),
  },
  {
    path: '/activity',
    element: withShell('سجل العمليات', <ActivityLogPage />, {
      permission: 'activity.view',
    }),
  },
  {
    path: '/liabilities',
    element: withShell('التزامات المحل', <LiabilitiesPage />, {
      permission: 'liabilities.manage',
    }),
  },
  {
    path: '/settings',
    element: withShell('الإعدادات', <SettingsPage />, {
      allowedRoles: ['admin'],
    }),
  },
  {
    path: '/about',
    element: withShell('عن البرنامج والدعم', <AboutPage />, {
      permission: 'about.view',
    }),
  },
]);
