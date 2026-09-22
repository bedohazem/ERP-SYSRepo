import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { getDb } from './db'

import { safeCreateActivityLog } from './repositories/activity.repo'

import { createVerifiedDatabaseBackup } from './database-backup'

const BACKUP_SETTING_KEY = 'auto_backup_dir'

/*
 * Retention:
 *
 * - آخر 24 Snapshot حديثة.
 * - Snapshot يومية لآخر 14 يوم.
 * - Snapshot أسبوعية لآخر 8 أسابيع.
 * - آخر 10 نسخ Manual.
 *
 * نفس الملف يمكن أن يحقق أكثر
 * من قاعدة، لذلك العدد النهائي
 * عادة أقل من 56.
 */
const RETENTION = {
  recent: 24,
  daily: 14,
  weekly: 8,
  manual: 10,
} as const

export type AutoBackupReason = 'startup' | 'hourly' | 'shutdown' | 'manual'

type BackupFile = {
  file: string
  fullPath: string
  size: number
  createdAt: string
  time: number
  reason: AutoBackupReason | 'unknown'
}

function getDefaultBackupDir() {
  return path.join(app.getPath('documents'), 'ERP-Store-Backups')
}

function readConfiguredBackupDir() {
  try {
    const db = getDb()

    const row = db
      .prepare(
        `
        SELECT value

        FROM app_settings

        WHERE key = ?

        LIMIT 1
        `,
      )
      .get(BACKUP_SETTING_KEY) as
      | {
          value?: string
        }
      | undefined

    const savedPath = String(row?.value || '').trim()

    return savedPath || getDefaultBackupDir()
  } catch {
    return getDefaultBackupDir()
  }
}

function saveConfiguredBackupDir(dirPath: string) {
  const db = getDb()

  db.prepare(
    `
    INSERT INTO
      app_settings (
        key,
        value
      )

    VALUES (?, ?)

    ON CONFLICT(key)
    DO UPDATE SET
      value =
        excluded.value
    `,
  ).run(BACKUP_SETTING_KEY, dirPath)
}

export function getAutoBackupDir() {
  return readConfiguredBackupDir()
}

export function setAutoBackupDir(dirPath: string) {
  const cleanPath = String(dirPath || '').trim()

  if (!cleanPath) {
    throw new Error('اختار مكان صحيح للنسخ التلقائي')
  }

  if (!fs.existsSync(cleanPath)) {
    fs.mkdirSync(cleanPath, {
      recursive: true,
    })
  }

  const stat = fs.statSync(cleanPath)

  if (!stat.isDirectory()) {
    throw new Error('المسار المختار ليس فولدر')
  }

  /*
   * نتأكد إن المكان قابل للكتابة.
   */
  const probePath = path.join(
    cleanPath,
    `.erp-write-test-${process.pid}-${Date.now()}`,
  )

  try {
    fs.writeFileSync(probePath, 'ok', 'utf8')

    fs.rmSync(probePath, {
      force: true,
    })
  } catch {
    throw new Error('لا يمكن الكتابة داخل مكان النسخ المختار')
  }

  saveConfiguredBackupDir(cleanPath)

  return getAutoBackupInfo()
}

function getBackupName(reason: AutoBackupReason) {
  const now = new Date()

  const stamp = [
    now.getFullYear(),

    String(now.getMonth() + 1).padStart(2, '0'),

    String(now.getDate()).padStart(2, '0'),

    String(now.getHours()).padStart(2, '0'),

    String(now.getMinutes()).padStart(2, '0'),

    String(now.getSeconds()).padStart(2, '0'),
  ].join('-')

  return `erp-auto-${reason}-${stamp}.db`
}

function makeUniqueBackupPath(backupDir: string, reason: AutoBackupReason) {
  const baseName = getBackupName(reason)

  const parsed = path.parse(baseName)

  let backupPath = path.join(backupDir, baseName)

  let counter = 1

  while (fs.existsSync(backupPath)) {
    backupPath = path.join(backupDir, `${parsed.name}-${counter}${parsed.ext}`)

    counter += 1
  }

  return backupPath
}

function getReasonFromFileName(file: string): BackupFile['reason'] {
  const match = /^erp-auto-(startup|hourly|shutdown|manual)-/i.exec(file)

  if (!match) {
    return 'unknown'
  }

  return match[1].toLowerCase() as AutoBackupReason
}

function listAutoBackupFiles(backupDir: string): BackupFile[] {
  if (!fs.existsSync(backupDir)) {
    return []
  }

  return fs
    .readdirSync(backupDir)
    .filter((file) => file.startsWith('erp-auto-') && file.endsWith('.db'))
    .flatMap((file) => {
      const fullPath = path.join(backupDir, file)

      try {
        const stat = fs.statSync(fullPath)

        if (!stat.isFile()) {
          return []
        }

        return [
          {
            file,
            fullPath,

            size: stat.size,

            createdAt: stat.mtime.toISOString(),

            time: stat.mtime.getTime(),

            reason: getReasonFromFileName(file),
          },
        ]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.time - a.time)
}

function getDayKey(time: number) {
  const date = new Date(time)

  return [
    date.getFullYear(),

    String(date.getMonth() + 1).padStart(2, '0'),

    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/*
 * ISO-like week key كافي
 * للـretention هنا.
 */
function getWeekKey(time: number) {
  const date = new Date(time)

  const utc = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  )

  const day = utc.getUTCDay() || 7

  utc.setUTCDate(utc.getUTCDate() + 4 - day)

  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))

  const week = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  )

  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function keepFirstPerGroup(
  files: BackupFile[],
  keyFn: (time: number) => string,
  maxGroups: number,
  keep: Set<string>,
) {
  const groups = new Set<string>()

  for (const file of files) {
    const key = keyFn(file.time)

    if (groups.has(key)) {
      continue
    }

    if (groups.size >= maxGroups) {
      break
    }

    groups.add(key)

    keep.add(file.fullPath)
  }
}

export function cleanupAutoBackups(backupDir: string) {
  const files = listAutoBackupFiles(backupDir)

  const keep = new Set<string>()

  /*
   * النسخ اليدوية لها Retention
   * مستقلة تمامًا عن النسخ
   * التلقائية.
   *
   * لو أدخلناها ضمن recent /
   * daily / weekly ممكن يتخطى
   * عددها الحد المحدد.
   */
  const manualFiles = files.filter((file) => file.reason === 'manual')

  const automaticFiles = files.filter((file) => file.reason !== 'manual')

  /*
   * Rolling recent automatic
   * snapshots.
   */
  automaticFiles
    .slice(0, RETENTION.recent)
    .forEach((file) => keep.add(file.fullPath))

  /*
   * آخر 14 يوم من النسخ
   * التلقائية.
   */
  keepFirstPerGroup(automaticFiles, getDayKey, RETENTION.daily, keep)

  /*
   * آخر 8 أسابيع من النسخ
   * التلقائية.
   */
  keepFirstPerGroup(automaticFiles, getWeekKey, RETENTION.weekly, keep)

  /*
   * آخر 10 Manual backups
   * بالضبط كحد أقصى.
   */
  manualFiles
    .slice(0, RETENTION.manual)
    .forEach((file) => keep.add(file.fullPath))

  const deleted: string[] = []

  for (const file of files) {
    if (keep.has(file.fullPath)) {
      continue
    }

    try {
      fs.unlinkSync(file.fullPath)

      deleted.push(file.fullPath)
    } catch (error) {
      console.error('Failed to remove old auto backup:', file.fullPath, error)
    }
  }

  return {
    kept: files.length - deleted.length,

    deleted: deleted.length,
  }
}

export function getAutoBackupInfo() {
  const backupDir = getAutoBackupDir()

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, {
      recursive: true,
    })
  }

  const files = listAutoBackupFiles(backupDir)

  return {
    dir: backupDir,

    retention: {
      ...RETENTION,
    },

    maxBackups:
      RETENTION.recent + RETENTION.daily + RETENTION.weekly + RETENTION.manual,

    files: files.map(({ time, ...file }) => file),
  }
}

export async function createAutoBackup(reason: AutoBackupReason = 'manual') {
  try {
    const backupDir = getAutoBackupDir()

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, {
        recursive: true,
      })
    }

    const backupPath = makeUniqueBackupPath(backupDir, reason)

    const validation = await createVerifiedDatabaseBackup(backupPath)

    const cleanup = cleanupAutoBackups(backupDir)

    if (reason !== 'manual') {
      safeCreateActivityLog({
        user_id: null,

        action: 'auto_backup_created',

        entity: 'settings',

        entity_id: null,

        details: JSON.stringify({
          reason,

          path: backupPath,

          size: validation.size,

          cleanup,
        }),
      })
    }

    return {
      success: true,
      skipped: false,

      reason,

      path: backupPath,

      validation,

      cleanup,

      info: getAutoBackupInfo(),
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'فشل إنشاء النسخة الاحتياطية'

    if (reason !== 'manual') {
      safeCreateActivityLog({
        user_id: null,

        action: 'auto_backup_failed',

        entity: 'settings',

        entity_id: null,

        details: JSON.stringify({
          reason,
          error: message,
        }),
      })
    }

    console.error('Auto backup failed:', error)

    return {
      success: false,
      skipped: false,

      reason,

      message,
    }
  }
}
