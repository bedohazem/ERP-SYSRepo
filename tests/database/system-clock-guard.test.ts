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

  it('blocks creating another shift after a one-month runtime clock jump', async () => {
    delete process.env.ERP_SYSTEM_CLOCK_TEST_BYPASS;

    const firstTime = Date.parse('2026-10-07T12:00:00.000Z');

    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(firstTime);

    vi.resetModules();

    const dbModule = await import('../../src/main/database/db');

    const cashShifts =
      await import('../../src/main/database/repositories/cash-shifts.repo');

    const db = dbModule.getDb();

    dbModule.resetDatabaseData();

    const firstShift = cashShifts.openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });

    cashShifts.closeCashShift({
      shift_id: firstShift.id,

      closing_counted_amount: 0,

      left_for_next_shift: 0,

      closed_by: 1,
    });

    const before = db
      .prepare(
        `
          SELECT
            COUNT(*) AS count

          FROM cash_shifts
          `,
      )
      .get() as {
      count: number;
    };

    /*
     * البرنامج ما زال مفتوحًا
     * ثم Windows اتقدم شهر.
     */
    dateNowSpy.mockReturnValue(firstTime + 31 * 24 * 60 * 60 * 1000);

    expect(() =>
      cashShifts.openCashShift({
        opening_counted_amount: 0,

        opened_by: 1,
      }),
    ).toThrow(
      'تم اكتشاف تغيير غير طبيعي في ساعة أو تاريخ الجهاز أثناء تشغيل البرنامج',
    );

    const after = db
      .prepare(
        `
          SELECT
            COUNT(*) AS count

          FROM cash_shifts
          `,
      )
      .get() as {
      count: number;
    };

    /*
     * أهم Assertion:
     * لم يتم إنشاء شفت جديد.
     */
    expect(after.count).toBe(before.count);
  });

  it.each([
    {
      label: 'future',
      offsetMs: 31 * 24 * 60 * 60 * 1000,
    },

    {
      label: 'past',
      offsetMs: -31 * 24 * 60 * 60 * 1000,
    },
  ])(
    'blocks opening a shift immediately after a $label runtime clock jump',
    async ({ offsetMs }) => {
      delete process.env.ERP_SYSTEM_CLOCK_TEST_BYPASS;

      const firstTime = Date.parse('2026-10-08T01:00:00.000Z');

      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(firstTime);

      vi.resetModules();

      const dbModule = await import('../../src/main/database/db');

      const cashShifts =
        await import('../../src/main/database/repositories/cash-shifts.repo');

      const db = dbModule.getDb();

      dbModule.resetDatabaseData();

      const firstShift = cashShifts.openCashShift({
        opening_counted_amount: 0,

        opened_by: 1,
      });

      cashShifts.closeCashShift({
        shift_id: firstShift.id,

        closing_counted_amount: 0,

        left_for_next_shift: 0,

        closed_by: 1,
      });

      const before = db
        .prepare(
          `
        SELECT
          COUNT(*) AS count

        FROM cash_shifts
        `,
        )
        .get() as {
        count: number;
      };

      dateNowSpy.mockReturnValue(firstTime + offsetMs);

      /*
       * مجرد فتح Popup نفسه
       * لازم يتمنع.
       */
      expect(() => cashShifts.getCashShiftOpeningPreview()).toThrow(
        'تم اكتشاف تغيير غير طبيعي في ساعة أو تاريخ الجهاز أثناء تشغيل البرنامج',
      );

      /*
       * وحتى لو حاول تجاوز
       * الـPreview وفتح مباشرة.
       */
      expect(() =>
        cashShifts.openCashShift({
          opening_counted_amount: 0,

          opened_by: 1,
        }),
      ).toThrow(
        'تم اكتشاف تغيير غير طبيعي في ساعة أو تاريخ الجهاز أثناء تشغيل البرنامج',
      );

      const after = db
        .prepare(
          `
        SELECT
          COUNT(*) AS count

        FROM cash_shifts
        `,
        )
        .get() as {
        count: number;
      };

      expect(after.count).toBe(before.count);
    },
  );

  it('blocks shift opening after Windows reports a system time change', async () => {
    delete process.env.ERP_SYSTEM_CLOCK_TEST_BYPASS;

    vi.resetModules();

    const dbModule = await import('../../src/main/database/db');

    const clockGuard =
      await import('../../src/main/database/system-clock-guard');

    const cashShifts =
      await import('../../src/main/database/repositories/cash-shifts.repo');

    const db = dbModule.getDb();

    dbModule.resetDatabaseData();

    const firstShift = cashShifts.openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });

    cashShifts.closeCashShift({
      shift_id: firstShift.id,

      closing_counted_amount: 0,

      left_for_next_shift: 0,

      closed_by: 1,
    });

    const before = db
      .prepare(
        `
        SELECT
          COUNT(*) AS count

        FROM cash_shifts
        `,
      )
      .get() as {
      count: number;
    };

    /*
     * نحاكي WM_TIMECHANGE
     * الذي استقبله Main Process.
     */
    clockGuard.markSystemClockChangedByWindows();

    expect(() => cashShifts.getCashShiftOpeningPreview()).toThrow(
      'تم اكتشاف تغيير في تاريخ أو وقت Windows أثناء تشغيل البرنامج',
    );

    expect(() =>
      cashShifts.openCashShift({
        opening_counted_amount: 0,

        opened_by: 1,
      }),
    ).toThrow('تم اكتشاف تغيير في تاريخ أو وقت Windows أثناء تشغيل البرنامج');

    const after = db
      .prepare(
        `
        SELECT
          COUNT(*) AS count

        FROM cash_shifts
        `,
      )
      .get() as {
      count: number;
    };

    expect(after.count).toBe(before.count);
  });

  it('keeps an open shift unchanged and blocks closing it after Windows time changes', async () => {
    delete process.env.ERP_SYSTEM_CLOCK_TEST_BYPASS;

    vi.resetModules();

    const dbModule = await import('../../src/main/database/db');

    const clockGuard =
      await import('../../src/main/database/system-clock-guard');

    const cashShifts =
      await import('../../src/main/database/repositories/cash-shifts.repo');

    const db = dbModule.getDb();

    dbModule.resetDatabaseData();

    const shift = cashShifts.openCashShift({
      opening_counted_amount: 100,

      opened_by: 1,
    });

    const originalBusinessDate = shift.business_date;

    clockGuard.markSystemClockChangedByWindows();

    expect(() => cashShifts.getCashShiftExpectedBalance(shift.id)).toThrow(
      'تم اكتشاف تغيير في تاريخ أو وقت Windows أثناء تشغيل البرنامج',
    );

    expect(() =>
      cashShifts.closeCashShift({
        shift_id: shift.id,

        closing_counted_amount: 100,

        left_for_next_shift: 100,

        closed_by: 1,
      }),
    ).toThrow('تم اكتشاف تغيير في تاريخ أو وقت Windows أثناء تشغيل البرنامج');

    const storedShift = db
      .prepare(
        `
        SELECT
          status,
          business_date,
          closed_at

        FROM cash_shifts

        WHERE id = ?
        `,
      )
      .get(shift.id) as {
      status: string;

      business_date: string;

      closed_at: string | null;
    };

    expect(storedShift.status).toBe('open');

    expect(storedShift.business_date).toBe(originalBusinessDate);

    expect(storedShift.closed_at).toBeNull();
  });
});
