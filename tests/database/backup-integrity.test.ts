import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  closeDb,
  getDb,
  getDbPath,
  resetDatabaseData,
} from '../../src/main/database/db'

import { validateErpDatabaseFile } from '../../src/main/database/backup-integrity'

import {
  createVerifiedDatabaseBackup,
  restoreVerifiedDatabase,
} from '../../src/main/database/database-backup'

function tempPath(name: string) {
  return path.join(path.dirname(getDbPath()), name)
}

describe('database backup integrity', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('creates a verified ERP backup', async () => {
    const backupPath = tempPath(`verified-${Date.now()}.db`)

    try {
      const result = await createVerifiedDatabaseBackup(backupPath)

      expect(result.size).toBeGreaterThan(0)

      expect(result.tables).toContain('users')

      expect(result.tables).toContain('sales')

      expect(() => validateErpDatabaseFile(backupPath)).not.toThrow()
    } finally {
      try {
        fs.rmSync(backupPath, {
          force: true,
        })
      } catch {
        // ignore
      }
    }
  })

  it('rejects a non database file', () => {
    const badPath = tempPath(`bad-${Date.now()}.db`)

    fs.writeFileSync(badPath, 'not a database', 'utf8')

    try {
      expect(() => validateErpDatabaseFile(badPath)).toThrow('قاعدة بيانات ERP')
    } finally {
      fs.rmSync(badPath, {
        force: true,
      })
    }
  })

  it('rejects a valid sqlite database that is not an ERP backup', () => {
    const otherPath = tempPath(`other-${Date.now()}.db`)

    const other = new Database(otherPath)

    other.exec(
      `
          CREATE TABLE notes (
            id INTEGER PRIMARY KEY,
            text TEXT
          );
          `,
    )

    other.close()

    try {
      expect(() => validateErpDatabaseFile(otherPath)).toThrow(
        'ليس نسخة ERP صالحة',
      )
    } finally {
      fs.rmSync(otherPath, {
        force: true,
      })
    }
  })

  it('restores a verified backup and preserves a safety backup', async () => {
    const sourcePath = tempPath(`restore-source-${Date.now()}.db`)

    await createVerifiedDatabaseBackup(sourcePath)

    const db = getDb()

    db.prepare(
      `
          INSERT INTO app_settings (
            key,
            value
          )

          VALUES (
            'restore_test_marker',
            'after-backup'
          )

          ON CONFLICT(key)
          DO UPDATE SET
            value = excluded.value
          `,
    ).run()

    const restored = await restoreVerifiedDatabase(sourcePath)

    expect(restored.safetyBackupPath).toBeTruthy()

    expect(fs.existsSync(restored.safetyBackupPath!)).toBe(true)

    const marker = getDb()
      .prepare(
        `
              SELECT value

              FROM app_settings

              WHERE key =
                'restore_test_marker'
              `,
      )
      .get()

    expect(marker).toBeUndefined()

    fs.rmSync(sourcePath, {
      force: true,
    })

    fs.rmSync(restored.safetyBackupPath!, {
      force: true,
    })
  })

  it('automatically rolls back when replacing the live database fails', async () => {
    const sourcePath = tempPath(`rollback-source-${Date.now()}.db`)

    /*
     * Source صالحة.
     */
    await createVerifiedDatabaseBackup(sourcePath)

    /*
     * بعد إنشاء Source نضيف
     * Marker إلى القاعدة الحالية.
     * Safety backup لازم تحفظه.
     */
    getDb()
      .prepare(
        `
        INSERT INTO app_settings (
          key,
          value
        )

        VALUES (
          'rollback_marker',
          'current-database'
        )

        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value
        `,
      )
      .run()

    const renameSpy = vi.spyOn(fs, 'renameSync')

    renameSpy.mockImplementationOnce(() => {
      throw new Error('simulated replace failure')
    })

    try {
      await expect(restoreVerifiedDatabase(sourcePath)).rejects.toThrow(
        'simulated replace failure',
      )

      /*
       * القاعدة الأصلية لازم
       * تكون رجعت تلقائيًا.
       */
      const marker = getDb()
        .prepare(
          `
            SELECT value

            FROM app_settings

            WHERE key =
              'rollback_marker'

            LIMIT 1
            `,
        )
        .get() as
        | {
            value: string
          }
        | undefined

      expect(marker?.value).toBe('current-database')

      expect(() => validateErpDatabaseFile(getDbPath())).not.toThrow()
    } finally {
      renameSpy.mockRestore()

      fs.rmSync(sourcePath, {
        force: true,
      })

      /*
       * ننظف Safety backups
       * التي أنشأها الاختبار.
       */
      const dir = path.dirname(getDbPath())

      const prefix = `${path.basename(getDbPath())}.before-restore-`

      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith(prefix) && file.endsWith('.bak')) {
          fs.rmSync(path.join(dir, file), {
            force: true,
          })
        }
      }
    }
  })

  it('does not touch the live database when the selected backup is invalid', async () => {
    const badPath = tempPath(`invalid-restore-${Date.now()}.db`)

    getDb()
      .prepare(
        `
        INSERT INTO app_settings (
          key,
          value
        )

        VALUES (
          'invalid_restore_marker',
          'still-here'
        )

        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value
        `,
      )
      .run()

    fs.writeFileSync(badPath, 'definitely not sqlite', 'utf8')

    try {
      await expect(restoreVerifiedDatabase(badPath)).rejects.toThrow()

      const marker = getDb()
        .prepare(
          `
            SELECT value

            FROM app_settings

            WHERE key =
              'invalid_restore_marker'

            LIMIT 1
            `,
        )
        .get() as
        | {
            value: string
          }
        | undefined

      expect(marker?.value).toBe('still-here')
    } finally {
      fs.rmSync(badPath, {
        force: true,
      })
    }
  })
})
