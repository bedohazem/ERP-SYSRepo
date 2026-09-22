import fs from 'node:fs'

import Database from 'better-sqlite3'

/*
 * Core tables فقط.
 *
 * الجداول الأحدث لا نطلب وجودها هنا
 * لأن getDb() مسؤول عن إنشاء /
 * ترقية الـSchema بعد Restore.
 *
 * ده يسمح باسترجاع Backup أقدم
 * حقيقية من نفس ERP.
 */
const REQUIRED_ERP_TABLES = [
  'users',
  'app_settings',
  'products',
  'product_variants',
  'sales',
  'sale_items',
] as const

export type DatabaseValidationResult = {
  path: string
  size: number
  tables: string[]
}

export function validateErpDatabaseFile(
  filePathInput: string,
): DatabaseValidationResult {
  const filePath = String(filePathInput || '').trim()

  if (!filePath) {
    throw new Error('مسار النسخة الاحتياطية غير صحيح')
  }

  if (!fs.existsSync(filePath)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود')
  }

  const stat = fs.statSync(filePath)

  if (!stat.isFile()) {
    throw new Error('المسار المختار ليس ملف قاعدة بيانات')
  }

  if (stat.size <= 0) {
    throw new Error('ملف النسخة الاحتياطية فارغ')
  }

  let db: Database.Database | null = null

  try {
    db = new Database(filePath, {
      readonly: true,
      fileMustExist: true,
    })

    /*
     * Integrity check كامل قبل
     * السماح بأي Restore.
     */
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as Array<
      Record<string, unknown>
    >

    const integrityOk =
      integrityRows.length > 0 &&
      integrityRows.every(
        (row) =>
          String(
            row.integrity_check ?? Object.values(row)[0] ?? '',
          ).toLowerCase() === 'ok',
      )

    if (!integrityOk) {
      throw new Error('قاعدة البيانات تالفة أو فشل فحص سلامتها')
    }

    const tableRows = db
      .prepare(
        `
        SELECT name

        FROM sqlite_master

        WHERE
          type = 'table'
          AND name NOT LIKE 'sqlite_%'
        `,
      )
      .all() as Array<{
      name: string
    }>

    const tables = tableRows.map((row) => String(row.name))

    const tableSet = new Set(tables)

    const missingTables = REQUIRED_ERP_TABLES.filter(
      (table) => !tableSet.has(table),
    )

    if (missingTables.length > 0) {
      throw new Error(
        `الملف ليس نسخة ERP صالحة. جداول مطلوبة غير موجودة: ${missingTables.join(', ')}`,
      )
    }

    return {
      path: filePath,
      size: stat.size,
      tables,
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('قاعدة البيانات') ||
        error.message.includes('النسخة') ||
        error.message.includes('ERP'))
    ) {
      throw error
    }

    throw new Error('الملف المختار ليس قاعدة بيانات ERP صالحة')
  } finally {
    try {
      db?.close()
    } catch {
      // ignore close failure
    }
  }
}
