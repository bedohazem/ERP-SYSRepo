export const SELECTIVE_BACKUP_FORMAT = 'erp-selective-backup';

export const SELECTIVE_BACKUP_SCHEMA_VERSION = 1;

export const SELECTIVE_BACKUP_SECTIONS = [
  'catalog_stock',

  'customers',
  'customer_open_debts',

  'suppliers',
  'supplier_open_dues',

  'users_permissions',

  'promotions',

  'open_liabilities',

  'account_opening_balances',

  'open_purchase_orders',

  'store_settings',
] as const;

export type SelectiveBackupSection = (typeof SELECTIVE_BACKUP_SECTIONS)[number];

export const SELECTIVE_BACKUP_SECTION_LABELS: Record<
  SelectiveBackupSection,
  string
> = {
  catalog_stock: 'المنتجات والمخزون',

  customers: 'العملاء ونقاط الولاء',

  customer_open_debts: 'مديونيات العملاء الحالية',

  suppliers: 'بيانات الموردين',

  supplier_open_dues: 'مستحقات الموردين الحالية',

  users_permissions: 'المستخدمين والصلاحيات',

  promotions: 'العروض',

  open_liabilities: 'الالتزامات المفتوحة',

  account_opening_balances: 'أرصدة الحسابات الحالية',

  open_purchase_orders: 'أوامر الشراء المفتوحة',

  store_settings: 'إعدادات المتجر',
};

export const SELECTIVE_BACKUP_SECTION_DEPENDENCIES: Record<
  SelectiveBackupSection,
  readonly SelectiveBackupSection[]
> = {
  catalog_stock: [],

  customers: [],

  customer_open_debts: ['customers'],

  suppliers: [],

  supplier_open_dues: ['suppliers'],

  users_permissions: [],

  promotions: ['catalog_stock'],

  open_liabilities: [],

  account_opening_balances: [],

  open_purchase_orders: ['catalog_stock', 'suppliers'],

  store_settings: [],
};

export const SELECTIVE_BACKUP_PRESETS = {
  products_stock: ['catalog_stock'],

  contacts: ['customers', 'suppliers'],

  business_master: ['catalog_stock', 'customers', 'suppliers'],

  financial_state: [
    'customer_open_debts',
    'supplier_open_dues',
    'open_liabilities',
    'account_opening_balances',
    'open_purchase_orders',
  ],

  complete_setup: [
    'catalog_stock',

    'customers',
    'customer_open_debts',

    'suppliers',
    'supplier_open_dues',

    'users_permissions',

    'promotions',

    'open_liabilities',

    'account_opening_balances',

    'open_purchase_orders',

    'store_settings',
  ],
} as const satisfies Record<string, readonly SelectiveBackupSection[]>;

export type SelectiveBackupPreset = keyof typeof SELECTIVE_BACKUP_PRESETS;

const SECTION_ORDER = new Map<SelectiveBackupSection, number>(
  SELECTIVE_BACKUP_SECTIONS.map((section, index) => [section, index]),
);

export function isSelectiveBackupSection(
  value: unknown,
): value is SelectiveBackupSection {
  return (
    typeof value === 'string' &&
    (SELECTIVE_BACKUP_SECTIONS as readonly string[]).includes(value)
  );
}

export function normalizeSelectiveBackupSections(
  input: readonly unknown[],
): SelectiveBackupSection[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('اختار نوع بيانات واحد على الأقل للنسخة الانتقائية');
  }

  const resolved = new Set<SelectiveBackupSection>();

  function addSection(section: SelectiveBackupSection) {
    if (resolved.has(section)) {
      return;
    }

    for (const dependency of SELECTIVE_BACKUP_SECTION_DEPENDENCIES[section]) {
      addSection(dependency);
    }

    resolved.add(section);
  }

  for (const rawSection of input) {
    if (!isSelectiveBackupSection(rawSection)) {
      throw new Error(
        `نوع بيانات غير مدعوم في النسخة الانتقائية: ${String(rawSection)}`,
      );
    }

    addSection(rawSection);
  }

  return [...resolved].sort(
    (left, right) =>
      (SECTION_ORDER.get(left) ?? 0) - (SECTION_ORDER.get(right) ?? 0),
  );
}

export function getSelectiveBackupPresetSections(
  preset: SelectiveBackupPreset,
): SelectiveBackupSection[] {
  return normalizeSelectiveBackupSections(SELECTIVE_BACKUP_PRESETS[preset]);
}

/*
 * Password hashes لا يتم
 * تصديرها أصلًا.
 */
export function selectiveBackupRequiresEncryption(
  _sections: readonly SelectiveBackupSection[],
): boolean {
  return false;
}

export type SelectiveBackupManifestV1 = {
  format: typeof SELECTIVE_BACKUP_FORMAT;

  schema_version: typeof SELECTIVE_BACKUP_SCHEMA_VERSION;

  created_at: string;

  app_version: string;

  sections: SelectiveBackupSection[];

  encrypted: boolean;

  counts: Partial<Record<SelectiveBackupSection, number>>;
};
