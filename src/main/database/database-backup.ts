import fs from 'node:fs';
import path from 'node:path';

import { closeDb, getDb, getDbPath } from './db';
import { runDatabaseMaintenanceExclusive } from './database-maintenance-lock';
import { validateErpDatabaseFile } from './backup-integrity';

const RESTORE_SAFETY_BACKUPS_TO_KEEP = 5;

const RESTORE_DEVICE_LOCAL_SETTING_KEYS = [
  /*
   * مسار خاص بالجهاز الذي أُخذت منه النسخة.
   */
  'auto_backup_dir',

  /*
   * اسم الطابعة المحلية لا يجب نقله
   * بين أجهزة مختلفة.
   */
  'cash_drawer_printer_name',

  /*
   * مفاتيح نظام التفعيل القديم.
   *
   * التفعيل الحالي لا يعتمد عليها؛
   * Paid activation الحالي عبارة عن
   * Signed Token مربوط بالجهاز ومخزن
   * خارج قاعدة ERP.
   */
  'app_activated',
  'app_trial_days',
  'app_trial_started_at',
  'app_deactivated_at',
] as const;

function clearRestoredDeviceLocalSettings() {
  const db = getDb();

  const placeholders = RESTORE_DEVICE_LOCAL_SETTING_KEYS.map(() => '?').join(
    ', ',
  );

  db.prepare(
    `
    DELETE FROM app_settings
    WHERE key IN (${placeholders})
    `,
  ).run(...RESTORE_DEVICE_LOCAL_SETTING_KEYS);
}

function removeIfExists(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, {
        force: true,
      });
    }
  } catch {
    // ignore cleanup error
  }
}

export function cleanupRestoreSafetyBackups(
  targetPath = getDbPath(),
  keep = RESTORE_SAFETY_BACKUPS_TO_KEEP,
) {
  const dir = path.dirname(targetPath);

  const prefix = `${path.basename(targetPath)}.before-restore-`;

  if (!fs.existsSync(dir)) {
    return {
      kept: 0,
      deleted: 0,
    };
  }

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.bak'))
    .map((file) => {
      const fullPath = path.join(dir, file);

      try {
        const stat = fs.statSync(fullPath);

        if (!stat.isFile()) {
          return null;
        }

        return {
          fullPath,
          time: stat.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (
        item,
      ): item is {
        fullPath: string;
        time: number;
      } => Boolean(item),
    )
    .sort((a, b) => b.time - a.time);

  const keepCount = Math.max(1, Math.floor(keep));

  let deleted = 0;

  for (const file of files.slice(keepCount)) {
    try {
      fs.rmSync(file.fullPath, {
        force: true,
      });

      deleted += 1;
    } catch (error) {
      console.error(
        'Failed to remove old restore safety backup:',
        file.fullPath,
        error,
      );
    }
  }

  return {
    kept: files.length - deleted,
    deleted,
  };
}

async function createVerifiedDatabaseBackupUnlocked(destinationPath: string) {
  const cleanPath = String(destinationPath || '').trim();

  if (!cleanPath) {
    throw new Error('مسار النسخة الاحتياطية غير صحيح');
  }

  const currentDbPath = getDbPath();

  if (path.resolve(cleanPath) === path.resolve(currentDbPath)) {
    throw new Error(
      'لا يمكن حفظ النسخة الاحتياطية فوق قاعدة بيانات التشغيل الحالية',
    );
  }

  fs.mkdirSync(path.dirname(cleanPath), {
    recursive: true,
  });

  /*
   * backup() من SQLite يضمن
   * Snapshot متسقة حتى مع WAL.
   */
  await getDb().backup(cleanPath);

  try {
    const validation = validateErpDatabaseFile(cleanPath);

    return validation;
  } catch (error) {
    /*
     * ما نسيبش Backup تالفة
     * ونقول للمستخدم إنها نجحت.
     */
    removeIfExists(cleanPath);

    throw error;
  }
}

export function createVerifiedDatabaseBackup(destinationPath: string) {
  return runDatabaseMaintenanceExclusive(() =>
    createVerifiedDatabaseBackupUnlocked(destinationPath),
  );
}

async function restoreVerifiedDatabaseUnlocked(sourcePathInput: string) {
  const sourcePath = String(sourcePathInput || '').trim();

  /*
   * أول حماية:
   * لا نلمس قاعدة البرنامج قبل
   * التأكد من الملف المختار.
   */
  const sourceValidation = validateErpDatabaseFile(sourcePath);

  const targetPath = getDbPath();

  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    throw new Error(
      'اختر نسخة احتياطية منفصلة عن قاعدة بيانات التشغيل الحالية',
    );
  }

  const targetDir = path.dirname(targetPath);

  fs.mkdirSync(targetDir, {
    recursive: true,
  });

  const stamp = Date.now();

  const safetyBackupPath = `${targetPath}.before-restore-${stamp}.bak`;

  const stagingPath = `${targetPath}.restore-${stamp}.tmp`;

  let safetyBackupCreated = false;

  /*
   * نفعّله قبل أول تعديل
   * على ملف قاعدة التشغيل.
   *
   * مهم جدًا:
   * ممكن حذف Target ينجح
   * ثم rename يفشل.
   */
  let targetMutationStarted = false;

  try {
    /*
     * Safety backup بالـSQLite API
     * وليس copyFile على DB مفتوحة.
     */
    if (fs.existsSync(targetPath)) {
      await createVerifiedDatabaseBackupUnlocked(safetyBackupPath);

      safetyBackupCreated = true;
    }

    /*
     * نقفل Connection قبل
     * استبدال ملف القاعدة.
     */
    closeDb();

    fs.copyFileSync(sourcePath, stagingPath);

    /*
     * فحص النسخة الـstaged نفسها
     * قبل أن تحل محل ERP DB.
     */
    validateErpDatabaseFile(stagingPath);

    targetMutationStarted = true;

    removeIfExists(targetPath);

    fs.renameSync(stagingPath, targetPath);

    /*
     * فحص الملف في مكانه النهائي
     * قبل فتح Repository layer.
     */
    validateErpDatabaseFile(targetPath);

    /*
     * getDb() يشغل initialization /
     * migrations الحالية.
     */
    getDb();

    /*
     * Full Restore ينقل بيانات المتجر،
     * لكنه لا يجب أن ينقل حالة أو إعدادات
     * مرتبطة بالجهاز القديم.
     *
     * خصوصًا مفاتيح نظام التفعيل القديم
     * ومسار النسخ والطابعة المحلية.
     */
    clearRestoredDeviceLocalSettings();

    /*
     * وبعد فتحه وتنظيف الإعدادات المحلية
     * نتأكد إن الملف مازال سليمًا.
     */
    validateErpDatabaseFile(targetPath);

    return {
      source: sourceValidation,

      path: sourcePath,

      safetyBackupPath: safetyBackupCreated ? safetyBackupPath : null,
    };
  } catch (restoreError) {
    /*
     * Rollback تلقائي لو حصل
     * أي Failure بعد بدء الاستبدال.
     */
    try {
      closeDb();
    } catch {
      // ignore
    }

    removeIfExists(stagingPath);

    if (
      targetMutationStarted &&
      safetyBackupCreated &&
      fs.existsSync(safetyBackupPath)
    ) {
      try {
        removeIfExists(targetPath);

        fs.copyFileSync(safetyBackupPath, targetPath);

        validateErpDatabaseFile(targetPath);

        getDb();
      } catch (rollbackError) {
        console.error(
          'CRITICAL: database restore rollback failed:',
          rollbackError,
        );

        throw new Error(
          'فشل الاسترجاع وفشل أيضًا الرجوع التلقائي لقاعدة البيانات السابقة. نسخة الأمان مازالت محفوظة.',
        );
      }
    } else {
      /*
       * لو لم نبدل Target أصلًا،
       * فقط نعيد فتح الحالية.
       */
      try {
        getDb();
      } catch {
        // keep original error
      }
    }

    throw restoreError;
  } finally {
    removeIfExists(stagingPath);

    if (safetyBackupCreated) {
      cleanupRestoreSafetyBackups(targetPath);
    }
  }
}

export function restoreVerifiedDatabase(sourcePathInput: string) {
  return runDatabaseMaintenanceExclusive(() =>
    restoreVerifiedDatabaseUnlocked(sourcePathInput),
  );
}
