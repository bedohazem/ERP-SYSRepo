import React, { lazy, Suspense } from 'react';
import RouterGuard from './router-guard';
import { createHashRouter } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/Auth/LoginPage';
import type { PermissionKey } from '../shared/permissions';

const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage'));

const ProductsPage = lazy(() => import('./pages/Products/ProductsPage'));

const PromotionsPage = lazy(() => import('./pages/Promotions/PromotionsPage'));

const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage'));

const SalesPage = lazy(() => import('./pages/Sales/SalesPage'));

const CustomersPage = lazy(() => import('./pages/Customers/CustomersPage'));

const InvoicesPage = lazy(() => import('./pages/Invoices/InvoicesPage'));

const ReportsPage = lazy(() => import('./pages/Reports/ReportsPage'));

const InventoryPage = lazy(() => import('./pages/Inventory/InventoryPage'));

const SuppliersPage = lazy(() => import('./pages/Suppliers/SuppliersPage'));

const PurchasesPage = lazy(() => import('./pages/Purchases/PurchasesPage'));

const PurchaseHistoryPage = lazy(
  () => import('./pages/Purchases/PurchaseHistoryPage'),
);

const CashPage = lazy(() => import('./pages/Cash/CashPage'));

const ShiftManagementPage = lazy(
  () => import('./pages/Shifts/ShiftManagementPage'),
);

const ExpensesPage = lazy(() => import('./pages/Expenses/ExpensesPage'));

const UsersPage = lazy(() => import('./pages/Users/UsersPage'));
const SalespeoplePage = lazy(
  () => import('./pages/Salespeople/SalespeoplePage'),
);
const ActivityLogPage = lazy(() => import('./pages/Activity/ActivityLogPage'));

const StockCountPage = lazy(() => import('./pages/StockCount/StockCountPage'));

const LiabilitiesPage = lazy(
  () => import('./pages/Liabilities/LiabilitiesPage'),
);

const AboutPage = lazy(() => import('./pages/About/AboutPage'));

type Role = 'admin' | 'cashier';

function RouteLoading() {
  return (
    <div
      style={{
        minHeight: '240px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        color: '#94a3b8',
      }}
    >
      جاري تحميل الشاشة...
    </div>
  );
}

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
      <AppShell title={title}>
        <Suspense fallback={<RouteLoading />}>{element}</Suspense>
      </AppShell>
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
    path: '/salespeople',

    element: withShell(
      'البائعين',

      <SalespeoplePage />,

      {
        allowedRoles: ['admin'],
      },
    ),
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
