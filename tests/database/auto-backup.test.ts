import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDb } from '../../src/main/database/db';

import {
  cleanupAutoBackups,
  getAutoBackupInfo,
} from '../../src/main/database/auto-backup';

function createBackupFile(dir: string, name: string, time: number) {
  const filePath = path.join(dir, name);

  fs.writeFileSync(filePath, 'backup', 'utf8');

  const date = new Date(time);

  fs.utimesSync(filePath, date, date);

  return filePath;
}

describe('auto backup retention', () => {
  it('keeps recent daily weekly and manual history instead of only seven files', () => {
    const dir = path.join(process.cwd(), `.test-auto-backups-${Date.now()}`);

    fs.mkdirSync(dir, {
      recursive: true,
    });

    try {
      const now = Date.now();

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
        );
      }

      /*
       * Older daily history.
       */
      for (let day = 2; day <= 20; day += 1) {
        createBackupFile(
          dir,

          `erp-auto-startup-day-${day}.db`,

          now - day * 24 * 60 * 60 * 1000,
        );
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
        );
      }

      const result = cleanupAutoBackups(dir);

      const files = fs.readdirSync(dir);

      expect(result.deleted).toBeGreaterThan(0);

      expect(files.length).toBeGreaterThan(24);

      expect(
        files.filter((file) => file.startsWith('erp-auto-manual-')).length,
      ).toBeLessThanOrEqual(10);

      expect(files.some((file) => file.includes('day-'))).toBe(true);
    } finally {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
      });
    }
  });

  it('self-heals a restored auto backup path that is not usable on this device', () => {
    const invalidPath = path.join(
      process.cwd(),
      `.test-invalid-auto-backup-${Date.now()}`,
    );

    /*
     * نعمل File بدل Folder.
     *
     * ده يحاكي إعدادًا مسترجعًا
     * من جهاز آخر لكنه غير صالح
     * على الجهاز الحالي.
     */
    fs.writeFileSync(invalidPath, 'not-a-directory', 'utf8');

    const db = getDb();

    db.prepare(
      `
      INSERT INTO app_settings (
        key,
        value
      )

      VALUES (
        'auto_backup_dir',
        ?
      )

      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value
      `,
    ).run(invalidPath);

    let resolvedDir = '';

    try {
      const info = getAutoBackupInfo();

      resolvedDir = info.dir;

      expect(resolvedDir).not.toBe(invalidPath);

      expect(fs.existsSync(resolvedDir)).toBe(true);

      expect(fs.statSync(resolvedDir).isDirectory()).toBe(true);

      const stored = db
        .prepare(
          `
          SELECT value
          FROM app_settings
          WHERE key = 'auto_backup_dir'
          `,
        )
        .get() as {
        value: string;
      };

      /*
       * مش مجرد fallback مؤقت:
       * نصحح الإعداد نفسه حتى لا
       * تتكرر المشكلة في كل تشغيل.
       */
      expect(stored.value).toBe(resolvedDir);
    } finally {
      db.prepare(
        `
        DELETE FROM app_settings
        WHERE key = 'auto_backup_dir'
        `,
      ).run();

      fs.rmSync(invalidPath, {
        force: true,
      });

      if (resolvedDir) {
        fs.rmSync(resolvedDir, {
          recursive: true,
          force: true,
        });
      }
    }
  });
});
