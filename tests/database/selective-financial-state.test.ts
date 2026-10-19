import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createCategory,
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

import { recordCustomerPayment } from '../../src/main/database/repositories/customers.repo';

import {
  listPurchaseInvoices,
  recordSupplierPayment,
} from '../../src/main/database/repositories/purchases.repo';

import { listSales } from '../../src/main/database/repositories/sales.repo';

import { resetDatabaseKeepingSelectiveData } from '../../src/main/database/selective-reset';

function ensureAdmin() {
  const db = getDb();

  const existing = db
    .prepare(
      `
      SELECT
        id,
        username

      FROM users

      WHERE
        role = 'admin'

        AND is_active = 1

      ORDER BY id ASC

      LIMIT 1
      `,
    )
    .get() as
    | {
        id: number;

        username: string;
      }
    | undefined;

  if (existing) {
    return existing;
  }

  const result = db
    .prepare(
      `
      INSERT INTO users (
        name,
        username,
        password,
        role,
        is_active,
        must_change_password
      )

      VALUES (
        'Financial State Admin',
        'financial-state-admin',
        'TEST-HASH',
        'admin',
        1,
        0
      )
      `,
    )
    .run();

  return {
    id: Number(result.lastInsertRowid),

    username: 'financial-state-admin',
  };
}

describe('selective financial state', () => {
  beforeEach(() => {
    closeDb();

    getDb();

    resetDatabaseData();
  }, 30_000);

  it('keeps open financial state without restoring operational history', () => {
    const db = getDb();

    const admin = ensureAdmin();

    const category = createCategory({
      name: 'Financial Keep Category',

      description: null,
    });

    createProduct({
      name: 'Financial Keep Product',

      category_id: category.id,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'FIN-KEEP-001',

          size: 'M',

          color: 'Black',

          buy_price: 50,

          sell_price: 100,

          min_stock: 1,

          opening_qty: 4,
        },
      ],
    });

    const variant = getVariantByBarcode('FIN-KEEP-001');

    expect(variant).toBeTruthy();

    const customerResult = db
      .prepare(
        `
            INSERT INTO customers (
              name,
              phone,
              balance,
              total_spent
            )

            VALUES (
              'Financial Customer',
              '01030000001',
              300,
              300
            )
            `,
      )
      .run();

    const customerId = Number(customerResult.lastInsertRowid);

    db.prepare(
      `
          INSERT INTO sales (
            type,
            customer_id,
            user_id,
            business_date,

            sub_total,
            grand_total,

            paid,
            remaining_amount,

            payment_status,
            payment_method,

            due_date,

            notes
          )

          VALUES (
            'sale',
            ?,
            ?,
            '2026-09-01',

            300,
            300,

            0,
            300,

            'unpaid',
            'owner_bank',

            '2026-10-01',

            'Old sale history'
          )
          `,
    ).run(customerId, admin.id);

    const supplierResult = db
      .prepare(
        `
            INSERT INTO suppliers (
              name,
              phone,
              balance,
              total_purchased
            )

            VALUES (
              'Financial Supplier',
              '01030000002',
              500,
              500
            )
            `,
      )
      .run();

    const supplierId = Number(supplierResult.lastInsertRowid);

    db.prepare(
      `
          INSERT INTO purchase_invoices (
            supplier_id,

            total_amount,
            sub_total,

            paid_amount,
            remaining_amount,

            payment_status,
            payment_method,

            status,

            business_date,
            due_date,

            notes
          )

          VALUES (
            ?,

            500,
            500,

            0,
            500,

            'unpaid',
            'owner_bank',

            'active',

            '2026-09-05',
            '2026-10-05',

            'Old purchase history'
          )
          `,
    ).run(supplierId);

    db.prepare(
      `
          INSERT INTO store_liabilities (
            party_name,
            title,
            category,

            total_amount,
            paid_amount,
            remaining_amount,

            status,

            due_date,

            notes,

            created_by,
            business_date
          )

          VALUES (
            'Landlord',
            'Rent Balance',
            'rent',

            700,
            250,
            450,

            'open',

            '2026-10-10',

            'Old liability',

            ?,
            '2026-09-10'
          )
          `,
    ).run(admin.id);

    db.prepare(
      `
          INSERT INTO cash_movements (
            type,
            amount,
            direction,
            payment_method,
            reference_type,
            notes,
            created_by,
            business_date
          )

          VALUES
            (
              'deposit',
              1000,
              'in',
              'owner_bank',
              'manual',
              'Old bank balance',
              ?,
              '2026-09-01'
            ),

            (
              'deposit',
              200,
              'in',
              'store_cash',
              'manual',
              'Old drawer balance',
              ?,
              '2026-09-01'
            )
          `,
    ).run(admin.id, admin.id);

    const orderResult = db
      .prepare(
        `
            INSERT INTO purchase_orders (
              supplier_id,
              status,
              notes,
              created_by,
              ordered_by,
              ordered_at
            )

            VALUES (
              ?,
              'ordered',
              'Keep this order',
              ?,
              ?,
              CURRENT_TIMESTAMP
            )
            `,
      )
      .run(supplierId, admin.id, admin.id);

    const orderId = Number(orderResult.lastInsertRowid);

    db.prepare(
      `
          INSERT INTO purchase_order_items (
            purchase_order_id,
            variant_id,
            product_name,
            barcode,
            size,
            color,
            quantity,
            unit_cost,
            line_total
          )

          VALUES (
            ?,
            ?,
            'Financial Keep Product',
            'FIN-KEEP-001',
            'M',
            'Black',
            3,
            55,
            165
          )
          `,
    ).run(orderId, variant!.variant_id);

    resetDatabaseKeepingSelectiveData({
      sections: [
        'customer_open_debts',
        'supplier_open_dues',
        'open_liabilities',
        'account_opening_balances',
        'open_purchase_orders',
      ],

      actorId: admin.id,

      appVersion: 'financial-state-test',
    });

    const restoredCustomer = db
      .prepare(
        `
            SELECT
              id,
              balance,
              total_spent

            FROM customers

            WHERE name =
              'Financial Customer'

            LIMIT 1
            `,
      )
      .get() as {
      id: number;

      balance: number;

      total_spent: number;
    };

    expect(restoredCustomer).toBeTruthy();

    expect(Number(restoredCustomer.balance)).toBe(300);

    expect(Number(restoredCustomer.total_spent)).toBe(0);

    const openingSale = db
      .prepare(
        `
            SELECT
              type,
              grand_total,
              remaining_amount,
              payment_status,
              due_date

            FROM sales

            WHERE customer_id = ?

            LIMIT 1
            `,
      )
      .get(restoredCustomer.id) as {
      type: string;

      grand_total: number;

      remaining_amount: number;

      payment_status: string;

      due_date: string;
    };

    expect(openingSale).toMatchObject({
      type: 'opening_balance',

      grand_total: 300,

      remaining_amount: 300,

      payment_status: 'unpaid',

      due_date: '2026-10-01',
    });

    /*
     * الرصيد الافتتاحي لا يظهر
     * كمبيعات جديدة.
     */
    expect(
      listSales({
        limit: 100,
        offset: 0,
        actor_id: admin.id,
      }).total,
    ).toBe(0);

    const restoredSupplier = db
      .prepare(
        `
            SELECT
              id,
              balance,
              total_purchased

            FROM suppliers

            WHERE name =
              'Financial Supplier'

            LIMIT 1
            `,
      )
      .get() as {
      id: number;

      balance: number;

      total_purchased: number;
    };

    expect(Number(restoredSupplier.balance)).toBe(500);

    expect(Number(restoredSupplier.total_purchased)).toBe(0);

    const openingPurchase = db
      .prepare(
        `
            SELECT
              status,
              total_amount,
              remaining_amount,
              payment_status,
              due_date

            FROM purchase_invoices

            WHERE supplier_id = ?

            LIMIT 1
            `,
      )
      .get(restoredSupplier.id) as {
      status: string;

      total_amount: number;

      remaining_amount: number;

      payment_status: string;

      due_date: string;
    };

    expect(openingPurchase).toMatchObject({
      status: 'opening_balance',

      total_amount: 500,

      remaining_amount: 500,

      payment_status: 'unpaid',

      due_date: '2026-10-05',
    });

    /*
     * الرصيد الافتتاحي للمورد
     * لا يظهر كفاتورة شراء جديدة.
     */
    expect(
      listPurchaseInvoices({
        limit: 100,
        offset: 0,
      }).total,
    ).toBe(0);

    const liability = db
      .prepare(
        `
            SELECT
              total_amount,
              paid_amount,
              remaining_amount,
              status

            FROM store_liabilities

            WHERE title =
              'Rent Balance'

            LIMIT 1
            `,
      )
      .get() as {
      total_amount: number;

      paid_amount: number;

      remaining_amount: number;

      status: string;
    };

    expect(liability).toMatchObject({
      total_amount: 450,

      paid_amount: 0,

      remaining_amount: 450,

      status: 'open',
    });

    function accountBalance(account: string) {
      const row = db
        .prepare(
          `
              SELECT
                IFNULL(
                  SUM(
                    CASE
                      WHEN direction =
                        'in'
                      THEN amount

                      WHEN direction =
                        'out'
                      THEN -amount

                      ELSE 0
                    END
                  ),
                  0
                ) AS balance

              FROM cash_movements

              WHERE
                payment_method = ?

                AND cancelled_at
                  IS NULL
              `,
        )
        .get(account) as {
        balance: number;
      };

      return Number(row.balance || 0);
    }

    expect(accountBalance('owner_bank')).toBe(1000);

    expect(accountBalance('store_cash')).toBe(200);

    const restoredOrder = db
      .prepare(
        `
            SELECT
              id,
              status,
              supplier_id

            FROM purchase_orders

            WHERE notes =
              'Keep this order'

            LIMIT 1
            `,
      )
      .get() as {
      id: number;

      status: string;

      supplier_id: number;
    };

    expect(restoredOrder.status).toBe('ordered');

    expect(restoredOrder.supplier_id).toBe(restoredSupplier.id);

    expect(
      (
        db
          .prepare(
            `
              SELECT COUNT(*) AS count

              FROM purchase_order_items

              WHERE purchase_order_id = ?
              `,
          )
          .get(restoredOrder.id) as {
          count: number;
        }
      ).count,
    ).toBe(1);

    /*
     * أهم جزء:
     * الأرصدة الافتتاحية قابلة
     * للسداد بنفس الـPayment Engine.
     */
    recordCustomerPayment({
      customer_id: restoredCustomer.id,

      amount: 100,

      payment_method: 'owner_bank',

      actor_id: admin.id,
    });

    expect(
      Number(
        (
          db
            .prepare(
              `
                SELECT balance

                FROM customers

                WHERE id = ?
                `,
            )
            .get(restoredCustomer.id) as {
            balance: number;
          }
        ).balance,
      ),
    ).toBe(200);

    expect(
      Number(
        (
          db
            .prepare(
              `
                SELECT remaining_amount

                FROM sales

                WHERE
                  customer_id = ?

                  AND type =
                    'opening_balance'

                LIMIT 1
                `,
            )
            .get(restoredCustomer.id) as {
            remaining_amount: number;
          }
        ).remaining_amount,
      ),
    ).toBe(200);

    recordSupplierPayment({
      supplier_id: restoredSupplier.id,

      amount: 200,

      payment_method: 'owner_bank',

      actor_id: admin.id,
    });

    expect(
      Number(
        (
          db
            .prepare(
              `
                SELECT balance

                FROM suppliers

                WHERE id = ?
                `,
            )
            .get(restoredSupplier.id) as {
            balance: number;
          }
        ).balance,
      ),
    ).toBe(300);

    expect(
      Number(
        (
          db
            .prepare(
              `
                SELECT remaining_amount

                FROM purchase_invoices

                WHERE
                  supplier_id = ?

                  AND status =
                    'opening_balance'

                LIMIT 1
                `,
            )
            .get(restoredSupplier.id) as {
            remaining_amount: number;
          }
        ).remaining_amount,
      ),
    ).toBe(300);

    /*
     * Bank:
     * 1000 Opening
     * +100 Customer
     * -200 Supplier
     * = 900
     */
    expect(accountBalance('owner_bank')).toBe(900);

    expect(
      db
        .prepare(
          `
            PRAGMA foreign_key_check
            `,
        )
        .all(),
    ).toEqual([]);
  }, 30_000);
});
