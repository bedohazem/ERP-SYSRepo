import { getDb, resetDatabaseData, seedDefaultAppSettings } from './db';

import {
  SELECTIVE_STORE_SETTING_KEYS,
  buildSelectiveBackupPackage,
} from './selective-backup';

import {
  restoreSelectiveBackupPackage,
  type SelectiveRestoreResult,
} from './selective-restore';

import {
  normalizeSelectiveBackupSections,
  type SelectiveBackupManifestV1,
  type SelectiveBackupSection,
} from '../../shared/selective-backup';

type PreservedAdminSnapshot = {
  id: number;

  name: string;

  username: string;

  password: string;

  role: string;

  is_active: number;

  must_change_password: number;

  created_at: string | null;
};

export type SelectiveResetResult = {
  sections: SelectiveBackupSection[];

  manifest: SelectiveBackupManifestV1;

  restore: SelectiveRestoreResult;

  preserved_admin: {
    id: number;

    username: string;
  };
};

function getPreservedAdminSnapshot(
  actorIdInput: number,
): PreservedAdminSnapshot {
  const actorId = Number(actorIdInput);

  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw new Error('رقم المدير غير صحيح');
  }

  const row = getDb()
    .prepare(
      `
      SELECT
        id,
        name,
        username,
        password,
        role,
        is_active,

        IFNULL(
          must_change_password,
          0
        ) AS must_change_password,

        created_at

      FROM users

      WHERE id = ?

        AND role =
          'admin'

        AND is_active = 1

      LIMIT 1
      `,
    )
    .get(actorId) as PreservedAdminSnapshot | undefined;

  if (!row) {
    throw new Error('حساب المدير الحالي غير صالح للتصفير الانتقائي');
  }

  return {
    id: Number(row.id),

    name: String(row.name || ''),

    username: String(row.username || ''),

    password: String(row.password || ''),

    role: 'admin',

    is_active: 1,

    must_change_password: Number(row.must_change_password) === 1 ? 1 : 0,

    created_at: row.created_at ?? null,
  };
}

function restorePreservedAdmin(snapshot: PreservedAdminSnapshot) {
  const db = getDb();

  /*
   * resetDatabaseData قد ينشئ
   * Test Admin داخل Vitest فقط.
   *
   * نحذف أي Seed مؤقت حتى تكون
   * قاعدة التصفير الانتقائي مطابقة
   * لسلوك Production.
   */
  db.exec(`
    DELETE FROM user_permissions;
    DELETE FROM users;
  `);

  db.prepare(
    `
    INSERT INTO users (
      id,
      name,
      username,
      password,
      role,
      is_active,
      must_change_password,
      created_at
    )

    VALUES (
      ?, ?, ?, ?, 'admin',
      1, ?, ?
    )
    `,
  ).run(
    snapshot.id,

    snapshot.name,

    snapshot.username,

    snapshot.password,

    snapshot.must_change_password,

    snapshot.created_at,
  );
}

function resetPortableStoreSettingsToDefaults() {
  const db = getDb();

  const placeholders = SELECTIVE_STORE_SETTING_KEYS.map(() => '?').join(', ');

  /*
   * نمسح فقط الإعدادات المحمولة
   * التي تدخل في Selective Backup.
   *
   * إعدادات الجهاز المحلي مثل:
   * - auto_backup_dir
   * - cash_drawer_printer_name
   * - مفاتيح التفعيل القديمة
   *
   * لا يتم لمسها.
   */
  db.prepare(
    `
    DELETE FROM app_settings

    WHERE key IN (
      ${placeholders}
    )
    `,
  ).run(...SELECTIVE_STORE_SETTING_KEYS);

  /*
   * نرجع Defaults البرنامج.
   *
   * لو store_settings مختارة،
   * الـRestore اللي بعد كده
   * هيكتب قيم النسخة فوقها.
   */
  seedDefaultAppSettings(db);
}

export function resetDatabaseKeepingSelectiveData(input: {
  sections: readonly unknown[];

  actorId: number;

  appVersion: string;
}): SelectiveResetResult {
  const sections = normalizeSelectiveBackupSections(input.sections);

  const appVersion = String(input.appVersion || '').trim();

  if (!appVersion) {
    throw new Error('إصدار البرنامج غير متاح');
  }

  const adminSnapshot = getPreservedAdminSnapshot(input.actorId);

  /*
   * مهم جدًا:
   *
   * الـSelective Package يتبني
   * قبل حذف أي حاجة.
   */
  const backup = buildSelectiveBackupPackage({
    sections,

    appVersion,
  });

  const db = getDb();

  let restoreResult: SelectiveRestoreResult | null = null;

  /*
   * العملية كلها Atomic:
   *
   * Reset
   * + إعادة المدير
   * + Restore المحدد
   *
   * لو أي خطوة فشلت يتم Rollback
   * وترجع قاعدة البيانات كما كانت.
   */
  const transaction = db.transaction(() => {
    resetDatabaseData();

    resetPortableStoreSettingsToDefaults();

    restorePreservedAdmin(adminSnapshot);

    restoreResult = restoreSelectiveBackupPackage(
      backup,
      sections,
      adminSnapshot.id,
    );

    const foreignKeyIssues = db
      .prepare(
        `
          PRAGMA foreign_key_check
          `,
      )
      .all();

    if (foreignKeyIssues.length > 0) {
      throw new Error('فشل التحقق من العلاقات بعد التصفير الانتقائي');
    }
  });

  transaction();

  if (!restoreResult) {
    throw new Error('تعذر إكمال التصفير الانتقائي');
  }

  return {
    sections,

    manifest: backup.manifest,

    restore: restoreResult,

    preserved_admin: {
      id: adminSnapshot.id,

      username: adminSnapshot.username,
    },
  };
}
