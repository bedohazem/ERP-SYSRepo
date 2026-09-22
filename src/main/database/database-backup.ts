import fs from 'node:fs'
import path from 'node:path'

import { closeDb, getDb, getDbPath } from './db'

import { validateErpDatabaseFile } from './backup-integrity'

function removeIfExists(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, {
        force: true,
      })
    }
  } catch {
    // ignore cleanup error
  }
}

export async function createVerifiedDatabaseBackup(destinationPath: string) {
  const cleanPath = String(destinationPath || '').trim()

  if (!cleanPath) {
    throw new Error('مسار النسخة الاحتياطية غير صحيح')
  }

  const currentDbPath = getDbPath()

  if (path.resolve(cleanPath) === path.resolve(currentDbPath)) {
    throw new Error(
      'لا يمكن حفظ النسخة الاحتياطية فوق قاعدة بيانات التشغيل الحالية',
    )
  }

  fs.mkdirSync(path.dirname(cleanPath), {
    recursive: true,
  })

  /*
   * backup() من SQLite يضمن
   * Snapshot متسقة حتى مع WAL.
   */
  await getDb().backup(cleanPath)

  try {
    const validation = validateErpDatabaseFile(cleanPath)

    return validation
  } catch (error) {
    /*
     * ما نسيبش Backup تالفة
     * ونقول للمستخدم إنها نجحت.
     */
    removeIfExists(cleanPath)

    throw error
  }
}

export async function restoreVerifiedDatabase(sourcePathInput: string) {
  const sourcePath = String(sourcePathInput || '').trim()

  /*
   * أول حماية:
   * لا نلمس قاعدة البرنامج قبل
   * التأكد من الملف المختار.
   */
  const sourceValidation = validateErpDatabaseFile(sourcePath)

  const targetPath = getDbPath()

  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    throw new Error('اختر نسخة احتياطية منفصلة عن قاعدة بيانات التشغيل الحالية')
  }

  const targetDir = path.dirname(targetPath)

  fs.mkdirSync(targetDir, {
    recursive: true,
  })

  const stamp = Date.now()

  const safetyBackupPath = `${targetPath}.before-restore-${stamp}.bak`

  const stagingPath = `${targetPath}.restore-${stamp}.tmp`

  let safetyBackupCreated = false

  /*
   * نفعّله قبل أول تعديل
   * على ملف قاعدة التشغيل.
   *
   * مهم جدًا:
   * ممكن حذف Target ينجح
   * ثم rename يفشل.
   */
  let targetMutationStarted = false

  try {
    /*
     * Safety backup بالـSQLite API
     * وليس copyFile على DB مفتوحة.
     */
    if (fs.existsSync(targetPath)) {
      await createVerifiedDatabaseBackup(safetyBackupPath)

      safetyBackupCreated = true
    }

    /*
     * نقفل Connection قبل
     * استبدال ملف القاعدة.
     */
    closeDb()

    fs.copyFileSync(sourcePath, stagingPath)

    /*
     * فحص النسخة الـstaged نفسها
     * قبل أن تحل محل ERP DB.
     */
    validateErpDatabaseFile(stagingPath)

    targetMutationStarted = true

    removeIfExists(targetPath)

    fs.renameSync(stagingPath, targetPath)

    /*
     * فحص الملف في مكانه النهائي
     * قبل فتح Repository layer.
     */
    validateErpDatabaseFile(targetPath)

    /*
     * getDb() يشغل initialization /
     * migrations الحالية.
     */
    getDb()

    /*
     * وبعد فتحه نتأكد إن الملف
     * مازال سليمًا.
     */
    validateErpDatabaseFile(targetPath)

    return {
      source: sourceValidation,

      path: sourcePath,

      safetyBackupPath: safetyBackupCreated ? safetyBackupPath : null,
    }
  } catch (restoreError) {
    /*
     * Rollback تلقائي لو حصل
     * أي Failure بعد بدء الاستبدال.
     */
    try {
      closeDb()
    } catch {
      // ignore
    }

    removeIfExists(stagingPath)

    if (
      targetMutationStarted &&
      safetyBackupCreated &&
      fs.existsSync(safetyBackupPath)
    ) {
      try {
        removeIfExists(targetPath)

        fs.copyFileSync(safetyBackupPath, targetPath)

        validateErpDatabaseFile(targetPath)

        getDb()
      } catch (rollbackError) {
        console.error(
          'CRITICAL: database restore rollback failed:',
          rollbackError,
        )

        throw new Error(
          'فشل الاسترجاع وفشل أيضًا الرجوع التلقائي لقاعدة البيانات السابقة. نسخة الأمان مازالت محفوظة.',
        )
      }
    } else {
      /*
       * لو لم نبدل Target أصلًا،
       * فقط نعيد فتح الحالية.
       */
      try {
        getDb()
      } catch {
        // keep original error
      }
    }

    throw restoreError
  } finally {
    removeIfExists(stagingPath)
  }
}
