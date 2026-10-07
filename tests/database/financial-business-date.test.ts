import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

import { resolveFinancialBusinessDate } from '../../src/main/database/financial-business-date';

import { getLocalBusinessDate } from '../../src/main/database/system-clock-guard';

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);

  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

describe('financial business date', () => {
  beforeEach(() => {
    closeDb();

    getDb();

    resetDatabaseData();
  });

  it('requires the first shift before no-shift financial operations', () => {
    expect(() => resolveFinancialBusinessDate(null)).toThrow(
      'يجب فتح أول شفت في النظام',
    );
  });

  it('uses the current date when it matches the latest shift date', () => {
    openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });

    expect(resolveFinancialBusinessDate(null)).toBe(getLocalBusinessDate());
  });

  it('allows the day immediately after the latest shift', () => {
    const db = getDb();

    const shift = openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });

    const currentDate = getLocalBusinessDate();

    const yesterday = addDays(currentDate, -1);

    db.prepare(
      `
          UPDATE cash_shifts

          SET business_date = ?

          WHERE id = ?
          `,
    ).run(yesterday, shift.id);

    expect(resolveFinancialBusinessDate(null)).toBe(currentDate);
  });

  it('blocks a date older than the latest shift', () => {
    const db = getDb();

    const shift = openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });

    const tomorrow = addDays(getLocalBusinessDate(), 1);

    db.prepare(
      `
          UPDATE cash_shifts

          SET business_date = ?

          WHERE id = ?
          `,
    ).run(tomorrow, shift.id);

    expect(() => resolveFinancialBusinessDate(null)).toThrow('أقدم من آخر شفت');
  });

  it('blocks a forward jump greater than one day', () => {
    const db = getDb();

    const shift = openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });

    const oldDate = addDays(getLocalBusinessDate(), -3);

    db.prepare(
      `
          UPDATE cash_shifts

          SET business_date = ?

          WHERE id = ?
          `,
    ).run(oldDate, shift.id);

    expect(() => resolveFinancialBusinessDate(null)).toThrow(
      'افتح شفتًا جديدًا أولًا لتأكيد التاريخ',
    );
  });

  it('always uses the shift snapshot for a shift-bound operation', () => {
    const shift = openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });

    expect(resolveFinancialBusinessDate(shift.id)).toBe(shift.business_date);
  });
});
