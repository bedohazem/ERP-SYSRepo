export const SELECTIVE_BACKUP_FORMAT = 'erp-selective-backup';

export const SELECTIVE_BACKUP_SCHEMA_VERSION = 1;

export const SELECTIVE_BACKUP_SECTIONS = [
  'catalog_stock',
  'customers',
  'suppliers',
  'users_permissions',
  'promotions',
  'store_settings',
] as const;

export type SelectiveBackupSection = (typeof SELECTIVE_BACKUP_SECTIONS)[number];

export const SELECTIVE_BACKUP_SECTION_LABELS: Record<
  SelectiveBackupSection,
  string
> = {
  catalog_stock: 'المنتجات والمخزون',
  customers: 'العملاء',
  suppliers: 'الموردين',
  users_permissions: 'المستخدمين والصلاحيات',
  promotions: 'العروض',
  store_settings: 'إعدادات المتجر',
};

export const SELECTIVE_BACKUP_SECTION_DEPENDENCIES: Record<
  SelectiveBackupSection,
  readonly SelectiveBackupSection[]
> = {
  catalog_stock: [],

  customers: [],

  suppliers: [],

  users_permissions: [],

  /*
   * العرض ممكن يكون مربوط
   * بتصنيف أو منتج.
   */
  promotions: ['catalog_stock'],

  store_settings: [],
};

export const SELECTIVE_BACKUP_PRESETS = {
  products_stock: ['catalog_stock'],

  contacts: ['customers', 'suppliers'],

  business_master: ['catalog_stock', 'customers', 'suppliers'],

  complete_setup: [
    'catalog_stock',
    'customers',
    'suppliers',
    'users_permissions',
    'promotions',
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
 * حاليًا لا نصدر كلمات المرور
 * أو Password Hashes.
 *
 * لذلك لا يوجد Secret Credential
 * داخل الملف.
 *
 * نقدر نضيف Optional encryption
 * للملف كله لاحقًا بدون تغيير
 * الـschema.
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
