import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createHeldSale,
  deleteHeldSale,
  getHeldSale,
  listHeldSales,
} from '../../src/main/database/repositories/held-sales.repo';

function createCashier(username: string) {
  const db = getDb();

  return Number(
    db
      .prepare(
        `
      INSERT INTO users (
        name,
        username,
        password,
        role,
        is_active
      )

      VALUES (
        ?,
        ?,
        'test-password',
        'cashier',
        1
      )
      `,
      )
      .run(username, username).lastInsertRowid,
  );
}

function createVariant() {
  const db = getDb();

  const productId = Number(
    db
      .prepare(
        `
        INSERT INTO products (
          name,
          is_active
        )

        VALUES (
          'Held Product',
          1
        )
        `,
      )
      .run().lastInsertRowid,
  );

  const variantId = Number(
    db
      .prepare(
        `
        INSERT INTO product_variants (
          product_id,
          barcode,
          size,
          color,
          buy_price,
          sell_price,
          min_stock,
          is_active
        )

        VALUES (
          ?,
          'HELD-001',
          'M',
          'Black',
          50,
          100,
          2,
          1
        )
        `,
      )
      .run(productId).lastInsertRowid,
  );

  return {
    productId,
    variantId,
  };
}

describe('held sales repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('holds a sale without affecting accounting or stock', () => {
    const db = getDb();

    const cashierId = createCashier('held_cashier');

    const { variantId } = createVariant();

    const beforeSales = Number(
      (
        db
          .prepare(
            `
                SELECT COUNT(*)
                  AS count
                FROM sales
                `,
          )
          .get() as {
          count: number;
        }
      ).count,
    );

    const beforeMovements = Number(
      (
        db
          .prepare(
            `
                SELECT COUNT(*)
                  AS count
                FROM stock_movements
                `,
          )
          .get() as {
          count: number;
        }
      ).count,
    );

    const beforeCash = Number(
      (
        db
          .prepare(
            `
                SELECT COUNT(*)
                  AS count
                FROM cash_movements
                `,
          )
          .get() as {
          count: number;
        }
      ).count,
    );

    const held = createHeldSale({
      user_id: cashierId,

      title: 'عميل منتظر',

      discount_type: 'percent',

      discount_value: 10,

      notes: 'يرجع بعد قليل',

      items: [
        {
          variant_id: variantId,

          quantity: 2,
        },
      ],
    });

    expect(held.heldSaleId).toBeGreaterThan(0);

    expect(
      (
        db
          .prepare(
            `
              SELECT COUNT(*)
                AS count
              FROM sales
              `,
          )
          .get() as {
          count: number;
        }
      ).count,
    ).toBe(beforeSales);

    expect(
      (
        db
          .prepare(
            `
              SELECT COUNT(*)
                AS count
              FROM stock_movements
              `,
          )
          .get() as {
          count: number;
        }
      ).count,
    ).toBe(beforeMovements);

    expect(
      (
        db
          .prepare(
            `
              SELECT COUNT(*)
                AS count
              FROM cash_movements
              `,
          )
          .get() as {
          count: number;
        }
      ).count,
    ).toBe(beforeCash);

    const saved = getHeldSale({
      held_sale_id: held.heldSaleId,

      actor_id: cashierId,

      is_admin: false,
    });

    expect(saved.title).toBe('عميل منتظر');

    expect(saved.items).toHaveLength(1);

    expect(Number(saved.items[0].quantity)).toBe(2);

    expect(Number(saved.items[0].sell_price)).toBe(100);

    db.prepare(
      `
          UPDATE product_variants

          SET sell_price = 120

          WHERE id = ?
          `,
    ).run(variantId);

    const refreshed = getHeldSale({
      held_sale_id: held.heldSaleId,

      actor_id: cashierId,

      is_admin: false,
    });

    expect(Number(refreshed.items[0].sell_price)).toBe(120);
  });

  it('keeps cashier holds private while admin can access them', () => {
    const cashierA = createCashier('cashier_a');

    const cashierB = createCashier('cashier_b');

    const { variantId } = createVariant();

    const held = createHeldSale({
      user_id: cashierA,

      items: [
        {
          variant_id: variantId,

          quantity: 1,
        },
      ],
    });

    expect(
      listHeldSales({
        actor_id: cashierA,

        is_admin: false,
      }),
    ).toHaveLength(1);

    expect(
      listHeldSales({
        actor_id: cashierB,

        is_admin: false,
      }),
    ).toHaveLength(0);

    expect(() =>
      getHeldSale({
        held_sale_id: held.heldSaleId,

        actor_id: cashierB,

        is_admin: false,
      }),
    ).toThrow('غير موجودة أو غير متاحة');

    const adminView = getHeldSale({
      held_sale_id: held.heldSaleId,

      actor_id: 1,

      is_admin: true,
    });

    expect(Number(adminView.user_id)).toBe(cashierA);

    expect(() =>
      deleteHeldSale({
        held_sale_id: held.heldSaleId,

        actor_id: cashierB,

        is_admin: false,
      }),
    ).toThrow('غير موجودة أو غير متاحة');

    const deleted = deleteHeldSale({
      held_sale_id: held.heldSaleId,

      actor_id: 1,

      is_admin: true,
    });

    expect(deleted.success).toBe(true);

    expect(
      listHeldSales({
        actor_id: 1,

        is_admin: true,
      }),
    ).toHaveLength(0);
  });
});
