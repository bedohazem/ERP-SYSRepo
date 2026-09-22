import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { cleanupAutoBackups } from '../../src/main/database/auto-backup'

function createBackupFile(dir: string, name: string, time: number) {
  const filePath = path.join(dir, name)

  fs.writeFileSync(filePath, 'backup', 'utf8')

  const date = new Date(time)

  fs.utimesSync(filePath, date, date)

  return filePath
}

describe('auto backup retention', () => {
  it('keeps recent daily weekly and manual history instead of only seven files', () => {
    const dir = path.join(process.cwd(), `.test-auto-backups-${Date.now()}`)

    fs.mkdirSync(dir, {
      recursive: true,
    })

    try {
      const now = Date.now()

      /*
       * 40 hourly snapshots
       * spanning more than
       * one recent window.
       */
      for (let index = 0; index < 40; index += 1) {
        createBackupFile(
          dir,

          `erp-auto-hourly-${String(index).padStart(3, '0')}.db`,

          now - index * 60 * 60 * 1000,
        )
      }

      /*
       * Older daily history.
       */
      for (let day = 2; day <= 20; day += 1) {
        createBackupFile(
          dir,

          `erp-auto-startup-day-${day}.db`,

          now - day * 24 * 60 * 60 * 1000,
        )
      }

      /*
       * Manual snapshots should
       * receive their own retention.
       */
      for (let index = 0; index < 15; index += 1) {
        createBackupFile(
          dir,

          `erp-auto-manual-${index}.db`,

          now - index * 2 * 24 * 60 * 60 * 1000,
        )
      }

      const result = cleanupAutoBackups(dir)

      const files = fs.readdirSync(dir)

      expect(result.deleted).toBeGreaterThan(0)

      expect(files.length).toBeGreaterThan(24)

      expect(
        files.filter((file) => file.startsWith('erp-auto-manual-')).length,
      ).toBeLessThanOrEqual(10)

      expect(files.some((file) => file.includes('day-'))).toBe(true)
    } finally {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
      })
    }
  })
})
