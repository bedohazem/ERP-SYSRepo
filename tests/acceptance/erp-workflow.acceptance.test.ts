import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

import { getVariantStock } from '../../src/main/database/repositories/inventory.repo';

import { createCustomer } from '../../src/main/database/repositories/customers.repo';

import {
  createSale,
  createSaleReturn,
  getSaleReceipt,
} from '../../src/main/database/repositories/sales.repo';

import { createSupplier } from '../../src/main/database/repositories/suppliers.repo';

import { createPurchaseInvoice } from '../../src/main/database/repositories/purchases.repo';

import { createExpense } from '../../src/main/database/repositories/expense.repo';

import {
  createLiability,
  recordLiabilityPayment,
} from '../../src/main/database/repositories/liabilities.repo';

import { createCashMovement } from '../../src/main/database/repositories/cash.repo';

import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

import { getReportsSummary } from '../../src/main/database/repositories/reports.repo';

function getStoreCashBalance() {
  const row = getDb()
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN direction = 'in'
              THEN amount
              ELSE -amount
            END
          ),
          0
        ) AS balance

      FROM cash_movements

      WHERE
        payment_method = 'store_cash'
        AND cancelled_at IS NULL
      `,
    )
    .get() as {
    balance: number;
  };

  return Number(row.balance);
}

function getCustomerBalance(customerId: number) {
  const row = getDb()
    .prepare(
      `
      SELECT balance
      FROM customers
      WHERE id = ?
      `,
    )
    .get(customerId) as {
    balance: number;
  };

  return Number(row.balance);
}

function getSupplierBalance(supplierId: number) {
  const row = getDb()
    .prepare(
      `
      SELECT balance
      FROM suppliers
      WHERE id = ?
      `,
    )
    .get(supplierId) as {
    balance: number;
  };

  return Number(row.balance);
}

function getLiabilityRemaining(liabilityId: number) {
  const row = getDb()
    .prepare(
      `
      SELECT remaining_amount
      FROM store_liabilities
      WHERE id = ?
      `,
    )
    .get(liabilityId) as {
    remaining_amount: number;
  };

  return Number(row.remaining_amount);
}

describe('ERP financial acceptance invariants', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();

    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    });
  });

  it('keeps stock debt cash and profit reconciled across a full workflow', () => {
    createProduct({
      name: 'Acceptance Product',
      category_id: null,
      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'ACCEPTANCE-001',
          size: 'M',
          color: 'Black',

          buy_price: 40,
          sell_price: 100,

          min_stock: 1,
          opening_qty: 10,
        },
      ],
    });

    const variant = getVariantByBarcode('ACCEPTANCE-001')!;

    const customer = createCustomer({
      name: 'Acceptance Customer',
      phone: '01011112222',
    }) as any;

    const sale = createSale({
      user_id: 1,

      customer_id: Number(customer.id),

      sub_total: 200,
      discount_value: 0,
      grand_total: 200,

      paid: 200,
      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 2,

          unit_price: 100,
        },
      ],
    });

    const receipt = getSaleReceipt(sale.saleId) as any;

    /*
     * Immediately after the sale:
     * stock 10 - 2 = 8
     * customer is fully paid
     * store cash +200
     */
    expect(getVariantStock(variant.variant_id)).toBe(8);

    expect(getCustomerBalance(Number(customer.id))).toBe(0);

    expect(getStoreCashBalance()).toBe(200);

    createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      reason: 'Acceptance return',

      refund_payment_method: 'cash',

      items: [
        {
          sale_item_id: receipt.items[0].id,

          variant_id: variant.variant_id,

          quantity: 1,
        },
      ],
    });

    /*
     * Immediately after returning one unit:
     * stock 8 + 1 = 9
     * customer still owes nothing
     * store cash 200 - 100 refund = 100
     */
    expect(getVariantStock(variant.variant_id)).toBe(9);

    expect(getCustomerBalance(Number(customer.id))).toBe(0);

    expect(getStoreCashBalance()).toBe(100);

    const supplier = createSupplier({
      name: 'Acceptance Supplier',
    }) as any;

    createPurchaseInvoice({
      supplier_id: supplier.id,

      actor_id: 1,

      paid_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 3,

          unit_cost: 50,
        },
      ],
    });

    /*
     * Purchase is completely unpaid:
     * stock 9 + 3 = 12
     * supplier debt = 3 * 50 = 150
     * store cash must not change
     */
    expect(getVariantStock(variant.variant_id)).toBe(12);

    expect(getSupplierBalance(Number(supplier.id))).toBe(150);

    expect(getStoreCashBalance()).toBe(100);

    createExpense({
      title: 'Acceptance Expense',

      amount: 20,

      payment_method: 'cash',

      created_by: 1,
    });

    /*
     * Expense immediately leaves store cash.
     */
    expect(getStoreCashBalance()).toBe(80);

    const liability = createLiability({
      party_name: 'Acceptance Party',

      title: 'Acceptance Liability',

      total_amount: 100,

      paid_amount: 0,

      payment_method: 'cash',

      actor_id: 1,
    });

    /*
     * Creating an unpaid liability records the debt,
     * but must not move cash.
     */
    expect(getLiabilityRemaining(liability.liability_id)).toBe(100);

    expect(getStoreCashBalance()).toBe(80);

    recordLiabilityPayment({
      liability_id: liability.liability_id,

      amount: 30,

      payment_method: 'cash',

      actor_id: 1,
    });

    /*
     * Paying 30 reduces both the liability
     * and store cash immediately.
     */
    expect(getLiabilityRemaining(liability.liability_id)).toBe(70);

    expect(getStoreCashBalance()).toBe(50);

    const shift = getDb()
      .prepare(
        `
        SELECT id

        FROM cash_shifts

        WHERE status = 'open'

        LIMIT 1
        `,
      )
      .get() as {
      id: number;
    };

    createCashMovement({
      type: 'deposit',
      direction: 'in',

      amount: 25,

      payment_method: 'store_cash',

      reference_id: null,
      reference_type: 'manual',

      notes: 'Acceptance manual deposit',

      created_by: 1,

      shift_id: shift.id,
    });

    /*
     * Manual deposit is reflected immediately.
     */
    expect(getStoreCashBalance()).toBe(75);

    /*
     * Stock:
     * 10 opening
     * -2 sale
     * +1 return
     * +3 purchase
     * = 12
     */
    expect(getVariantStock(variant.variant_id)).toBe(12);

    expect(getCustomerBalance(Number(customer.id))).toBe(0);

    expect(getSupplierBalance(Number(supplier.id))).toBe(150);

    expect(getLiabilityRemaining(liability.liability_id)).toBe(70);

    expect(getStoreCashBalance()).toBe(75);

    const report = getReportsSummary();

    expect(report.summary.net_sales).toBe(100);

    expect(report.summary.total_returns).toBe(100);

    expect(report.summary.total_purchase_invoices).toBe(150);

    expect(report.summary.total_expenses).toBe(20);

    expect(report.summary.total_liability_payments).toBe(30);

    expect(report.summary.total_manual_deposits).toBe(25);

    /*
     * Net sold unit:
     * 100 sale - 40 historical cost
     * = 60 profit
     * -20 expense
     * = 40 final profit.
     *
     * Purchase/liability/manual deposit
     * are not profit deductions.
     */
    expect(report.summary.final_net_profit).toBe(40);

    expect(report.cashAccountsTotalBalance).toBe(75);
  });
});
