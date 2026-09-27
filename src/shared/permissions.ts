export const PERMISSION_DEFINITIONS = [
  {
    key: 'dashboard.view',
    label: 'عرض الصفحة الرئيسية',
    group: 'عام',
  },

  {
    key: 'sales.use',
    label: 'إنشاء المبيعات',
    group: 'المبيعات',
  },
  {
    key: 'sales.history',
    label: 'عرض سجل الفواتير',
    group: 'المبيعات',
  },
  {
    key: 'sales.returns',
    label: 'مرتجعات المبيعات',
    group: 'المبيعات',
  },
  {
    key: 'sales.exchanges',
    label: 'استبدال المبيعات',
    group: 'المبيعات',
  },

  {
    key: 'customers.view',
    label: 'عرض العملاء',
    group: 'العملاء',
  },
  {
    key: 'customers.manage',
    label: 'إضافة وتعديل العملاء',
    group: 'العملاء',
  },
  {
    key: 'customers.payments',
    label: 'دفعات العملاء',
    group: 'العملاء',
  },

  {
    key: 'expenses.view',
    label: 'عرض المصروفات',
    group: 'المصروفات',
  },
  {
    key: 'expenses.manage',
    label: 'إضافة وتعديل المصروفات',
    group: 'المصروفات',
  },

  {
    key: 'stock_count.view',
    label: 'عرض الجرد',
    group: 'المخزون',
  },
  {
    key: 'stock_count.count',
    label: 'تنفيذ العد داخل الجرد',
    group: 'المخزون',
  },

  {
    key: 'shifts.operate_own',
    label: 'فتح وإغلاق الشفت الشخصي',
    group: 'الشفتات',
  },

  {
    key: 'products.manage',
    label: 'إدارة المنتجات',
    group: 'الإدارة',
  },
  {
    key: 'promotions.manage',
    label: 'إدارة العروض',
    group: 'الإدارة',
  },
  {
    key: 'inventory.view',
    label: 'عرض المخزون',
    group: 'الإدارة',
  },
  {
    key: 'inventory.adjust',
    label: 'تسوية المخزون',
    group: 'الإدارة',
  },
  {
    key: 'suppliers.manage',
    label: 'إدارة الموردين',
    group: 'الإدارة',
  },
  {
    key: 'purchases.manage',
    label: 'إدارة المشتريات',
    group: 'الإدارة',
  },
  {
    key: 'reports.view',
    label: 'عرض التقارير الكاملة',
    group: 'الإدارة',
  },
  {
    key: 'cash.manage',
    label: 'إدارة الخزنة',
    group: 'الإدارة',
  },
  {
    key: 'shifts.manage',
    label: 'إدارة جميع الشفتات',
    group: 'الإدارة',
  },
  {
    key: 'liabilities.manage',
    label: 'إدارة الالتزامات',
    group: 'الإدارة',
  },
  {
    key: 'activity.view',
    label: 'عرض سجل العمليات',
    group: 'الإدارة',
  },
  {
    key: 'costs.view',
    label: 'عرض تكاليف وأسعار الشراء',
    group: 'الإدارة',
  },

  {
    key: 'about.view',
    label: 'عرض صفحة الدعم',
    group: 'عام',
  },
] as const

export type PermissionKey = (typeof PERMISSION_DEFINITIONS)[number]['key']

export const PERMISSION_KEYS: PermissionKey[] = PERMISSION_DEFINITIONS.map(
  (item) => item.key,
)

export const PERMISSION_DEPENDENCIES: Partial<
  Record<PermissionKey, PermissionKey[]>
> = {
  'sales.returns': ['sales.history'],

  'sales.exchanges': ['sales.history'],

  'customers.manage': ['customers.view'],

  'customers.payments': ['customers.view'],

  'expenses.manage': ['expenses.view'],

  'stock_count.count': ['stock_count.view'],

  'inventory.adjust': ['inventory.view'],

  'shifts.manage': ['shifts.operate_own'],

  'products.manage': ['costs.view'],

  'purchases.manage': ['costs.view'],

  'reports.view': ['costs.view'],

  'activity.view': ['costs.view'],
}

export function normalizePermissions(
  values: readonly string[],
): PermissionKey[] {
  /*
   * الرئيسية صلاحية أساسية.
   * المستخدم لازم يقدر يدخل
   * للنظام بعد Login دائمًا.
   */
  const result = new Set<PermissionKey>(['dashboard.view'])

  for (const value of values) {
    if (isPermissionKey(value)) {
      result.add(value)
    }
  }

  let changed = true

  while (changed) {
    changed = false

    for (const permission of [...result]) {
      const dependencies = PERMISSION_DEPENDENCIES[permission] ?? []

      for (const dependency of dependencies) {
        if (!result.has(dependency)) {
          result.add(dependency)

          changed = true
        }
      }
    }
  }

  return [...result]
}

export const CASHIER_DEFAULT_PERMISSIONS: PermissionKey[] = [
  'dashboard.view',

  'sales.use',
  'sales.history',
  'sales.returns',
  'sales.exchanges',

  'customers.view',
  'customers.manage',
  'customers.payments',

  'expenses.view',
  'expenses.manage',

  'stock_count.view',
  'stock_count.count',

  'shifts.operate_own',

  'about.view',
]

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.includes(value as PermissionKey)
}

export function getRoleDefaultPermissions(role: string): PermissionKey[] {
  if (role === 'admin') {
    return [...PERMISSION_KEYS]
  }

  return [...CASHIER_DEFAULT_PERMISSIONS]
}
