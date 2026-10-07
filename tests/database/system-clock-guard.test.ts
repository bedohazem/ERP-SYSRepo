import { afterEach, describe, expect, it, vi } from 'vitest';

describe('system clock guard', () => {
  afterEach(async () => {
    process.env.ERP_SYSTEM_CLOCK_TEST_BYPASS = '1';

    vi.restoreAllMocks();

    vi.resetModules();

    const { closeDb } = await import('../../src/main/database/db');

    closeDb();
  });

  it('detects clock rollback across application restart', async () => {
    delete process.env.ERP_SYSTEM_CLOCK_TEST_BYPASS;

    const firstTime = Date.parse('2026-10-07T12:00:00.000Z');

    vi.spyOn(Date, 'now').mockReturnValue(firstTime);

    vi.resetModules();

    let dbModule = await import('../../src/main/database/db');

    let clockGuard = await import('../../src/main/database/system-clock-guard');

    const db = dbModule.getDb();

    db.prepare(
      `
          DELETE FROM app_settings

          WHERE key =
            'system_clock_last_seen_epoch_ms'
          `,
    ).run();

    clockGuard.confirmSystemClockReference();

    const savedReference = db
      .prepare(
        `
            SELECT value

            FROM app_settings

            WHERE key =
              'system_clock_last_seen_epoch_ms'

            LIMIT 1
            `,
      )
      .get() as
      | {
          value: string;
        }
      | undefined;

    expect(Number(savedReference?.value)).toBe(firstTime);

    dbModule.closeDb();

    /*
     * نحاكي إغلاق البرنامج،
     * رجوع ساعة Windows للخلف
     * 10 دقائق، ثم تشغيله من جديد.
     */
    vi.restoreAllMocks();

    vi.spyOn(Date, 'now').mockReturnValue(firstTime - 10 * 60 * 1000);

    vi.resetModules();

    dbModule = await import('../../src/main/database/db');

    clockGuard = await import('../../src/main/database/system-clock-guard');

    dbModule.getDb();

    expect(() => clockGuard.assertSystemClockStable()).toThrow(
      'ساعة الجهاز أقدم من آخر وقت مسجل في النظام',
    );
  });
});
