import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createSalesperson,
  getSalespersonById,
  listSalespeople,
  setSalespersonActive,
  updateSalesperson,
  getSalespeoplePerformance,
  setSalespersonMonthlyTarget,
} from '../../src/main/database/repositories/salespeople.repo';

describe('salespeople repository', () => {
  beforeEach(() => {
    closeDb();

    getDb();

    resetDatabaseData();
  });

  it('creates and lists active salespeople', () => {
    const first = createSalesperson('محمد');

    const second = createSalesperson('أحمد');

    expect(first.id).toBeGreaterThan(0);

    expect(second.id).toBeGreaterThan(0);

    const rows = listSalespeople({
      active_only: true,
    });

    expect(rows).toHaveLength(2);

    expect(rows.every((row) => row.is_active === 1)).toBe(true);
  });

  it('prevents duplicate names case insensitively', () => {
    createSalesperson('Seller One');

    expect(() => createSalesperson('seller one')).toThrow(
      'اسم البائع مستخدم بالفعل',
    );
  });

  it('updates salesperson name', () => {
    const salesperson = createSalesperson('محمد');

    const updated = updateSalesperson(salesperson.id, 'محمود');

    expect(updated.name).toBe('محمود');

    expect(getSalespersonById(salesperson.id)?.name).toBe('محمود');
  });

  it('deactivates salesperson without deleting history', () => {
    const salesperson = createSalesperson('أحمد');

    const updated = setSalespersonActive(salesperson.id, false);

    expect(updated.is_active).toBe(0);

    expect(
      listSalespeople({
        active_only: true,
      }),
    ).toHaveLength(0);

    expect(listSalespeople()).toHaveLength(1);
  });

  it('calculates monthly salesperson target from sales returns and exchanges', () => {
    const db = getDb();

    const salesperson = createSalesperson('Target Seller');

    setSalespersonMonthlyTarget({
      salesperson_id: salesperson.id,

      month: '2026-10',

      target_amount: 1000,
    });

    const saleResult = db
      .prepare(
        `
            INSERT INTO sales (
              type,
              user_id,
              salesperson_id,
              salesperson_name,
              business_date,
              sub_total,
              grand_total,
              paid,
              payment_method
            )

            VALUES (
              'sale',
              1,
              ?,
              ?,
              '2026-10-05',
              1000,
              1000,
              1000,
              'cash'
            )
            `,
      )
      .run(salesperson.id, salesperson.name);

    const saleId = Number(saleResult.lastInsertRowid);

    db.prepare(
      `
          INSERT INTO sale_returns (
            original_sale_id,
            user_id,
            refund_amount,
            created_at
          )

          VALUES (
            ?,
            1,
            200,
            '2026-10-10 12:00:00'
          )
          `,
    ).run(saleId);

    db.prepare(
      `
          INSERT INTO sale_exchanges (
            original_sale_id,
            user_id,
            promotion_group_id,
            difference_amount,
            business_date
          )

          VALUES (
            ?,
            1,
            'test-group',
            50,
            '2026-10-15'
          )
          `,
    ).run(saleId);

    const performance = getSalespeoplePerformance('2026-10');

    const row = performance.find((item) => item.id === salesperson.id);

    expect(row).toBeTruthy();

    expect(row?.target_amount).toBe(1000);

    expect(row?.sales_count).toBe(1);

    expect(row?.sales_total).toBe(1000);

    expect(row?.returns_total).toBe(200);

    expect(row?.exchange_adjustment).toBe(50);

    expect(row?.net_sales).toBe(850);

    expect(row?.achievement_percent).toBe(85);

    expect(row?.remaining_target).toBe(150);
  });
});
