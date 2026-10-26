import { beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';

import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';

import { createSupplier } from '../../src/main/database/repositories/suppliers.repo';

import { createSale } from '../../src/main/database/repositories/sales.repo';

import { getVariantStock } from '../../src/main/database/repositories/inventory.repo';

import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

import {
  createPurchaseOrder,
  getPurchaseOrder,
  getSmartReorderSuggestions,
  receivePurchaseOrder,
  listPurchaseOrders,
  updatePurchaseOrder,
} from '../../src/main/database/repositories/purchase-orders.repo';

function seedVariant(input: {
  name: string;
  barcode: string;
  openingQty: number;
  minStock: number;
  buyPrice?: number;
  sellPrice?: number;
}) {
  createProduct({
    name: input.name,

    category_id: null,

    image_path: null,

    description: null,

    variants: [
      {
        barcode: input.barcode,

        size: 'M',

        color: 'Black',

        buy_price: input.buyPrice ?? 100,

        sell_price: input.sellPrice ?? 150,

        min_stock: input.minStock,

        opening_qty: input.openingQty,
      },
    ],
  });

  const variant = getVariantByBarcode(input.barcode) as any;

  if (!variant) {
    throw new Error('Failed to seed variant');
  }

  return variant;
}

describe('purchase orders repository', () => {
  beforeEach(() => {
    closeDb();

    getDb();

    resetDatabaseData();

    openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    });
  }, 30_000);

  it('builds smart reorder suggestions from stock and recent demand', () => {
    const mover = seedVariant({
      name: 'Fast Mover',

      barcode: 'PO-FAST',

      openingQty: 10,

      minStock: 2,
    });

    seedVariant({
      name: 'Low No Sales',

      barcode: 'PO-LOW',

      openingQty: 1,

      minStock: 5,
    });

    createSale({
      user_id: 1,

      sub_total: 900,

      discount_value: 0,

      grand_total: 900,

      paid: 900,

      change_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: mover.variant_id,

          product_name: mover.product_name,

          barcode: mover.barcode,

          size: mover.size,

          color: mover.color,

          quantity: 6,

          unit_price: 150,
        },
      ],
    });

    const rows = getSmartReorderSuggestions({
      targetDays: 30,
    });

    const fast = rows.find((row) => row.variant_id === mover.variant_id);

    const low = rows.find((row) => row.barcode === 'PO-LOW');

    expect(fast).toBeTruthy();

    expect(fast?.current_stock).toBe(4);

    expect(fast?.sold_units_30d).toBe(6);

    expect(fast?.target_stock).toBe(8);

    expect(fast?.suggested_quantity).toBe(4);

    expect(low).toBeTruthy();

    expect(low?.suggested_quantity).toBe(4);

    expect(low?.reason).toBe('low');
  });

  it('converts purchase order into real purchase invoice and stock', () => {
    const supplier = createSupplier({
      name: 'PO Supplier',

      phone: '01055551111',
    }) as any;

    const variant = seedVariant({
      name: 'PO Product',

      barcode: 'PO-RECEIVE',

      openingQty: 0,

      minStock: 2,

      buyPrice: 80,
    });

    const order = createPurchaseOrder({
      supplier_id: supplier.id,

      actor_id: 1,

      notes: 'Smart reorder',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 90,
        },
      ],
    });

    expect(order.status).toBe('draft');

    expect(getVariantStock(variant.variant_id)).toBe(0);

    const received = receivePurchaseOrder({
      purchase_order_id: order.purchase_order_id,

      actor_id: 1,

      paid_amount: 0,
    });

    expect(received.purchaseId).toBeGreaterThan(0);

    expect(received.total_amount).toBe(450);

    expect(getVariantStock(variant.variant_id)).toBe(5);

    const snapshot = getPurchaseOrder(order.purchase_order_id);

    expect(snapshot.order.status).toBe('received');

    expect(Number(snapshot.order.purchase_id)).toBe(received.purchaseId);

    const db = getDb();

    const supplierRow = db
      .prepare(
        `
            SELECT
              balance

            FROM suppliers

            WHERE id = ?
            `,
      )
      .get(supplier.id) as {
      balance: number;
    };

    expect(Number(supplierRow.balance)).toBe(450);
  });

  it('stores purchase order costs at cent precision', () => {
    const supplier = createSupplier({
      name: 'Rounded PO Supplier',
    }) as any;

    const variant = seedVariant({
      name: 'Rounded PO Product',

      barcode: 'PO-ROUND-MONEY',

      openingQty: 0,

      minStock: 1,

      buyPrice: 80,
    });

    const order = createPurchaseOrder({
      supplier_id: supplier.id,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 90.5,
        },
      ],
    });

    const snapshot = getPurchaseOrder(order.purchase_order_id) as any;

    expect(snapshot.items[0].unit_cost).toBe(90.5);

    expect(snapshot.items[0].line_total).toBe(181);
  });

  it('paginates purchase orders', () => {
    const supplier = createSupplier({
      name: 'Paged PO Supplier',
    }) as any;

    const variant = seedVariant({
      name: 'Paged PO Product',
      barcode: 'PO-PAGED',
      openingQty: 0,
      minStock: 1,
      buyPrice: 50,
    });

    for (let index = 1; index <= 5; index += 1) {
      createPurchaseOrder({
        supplier_id: supplier.id,

        actor_id: 1,

        notes: `Order ${index}`,

        items: [
          {
            variant_id: variant.variant_id,

            quantity: 1,

            unit_cost: 50,
          },
        ],
      });
    }

    const firstPage = listPurchaseOrders({
      limit: 2,
      offset: 0,
    });

    const secondPage = listPurchaseOrders({
      limit: 2,
      offset: 2,
    });

    const firstRows = firstPage.rows as Array<{
      id: number;
    }>;

    const secondRows = secondPage.rows as Array<{
      id: number;
    }>;

    expect(firstPage.total).toBe(5);

    expect(firstRows).toHaveLength(2);

    expect(secondRows).toHaveLength(2);

    expect(firstRows[0].id).toBeGreaterThan(firstRows[1].id);
  });

  it('preserves cent-accurate purchase order totals when unit cost has extra decimals', () => {
    const supplier = createSupplier({
      name: 'Cent Accurate PO Supplier',
    }) as any;

    const variant = seedVariant({
      name: 'Cent Accurate PO Product',

      barcode: 'PO-CENT-PRECISION',

      openingQty: 0,

      minStock: 1,

      buyPrice: 80,
    });

    const order = createPurchaseOrder({
      supplier_id: supplier.id,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 12,

          unit_cost: 155.8333333333,
        },
      ],
    });

    expect(order.total_amount).toBe(1870);

    const snapshot = getPurchaseOrder(order.purchase_order_id) as any;

    expect(Number(snapshot.items[0].unit_cost)).toBe(155.83);

    expect(Number(snapshot.items[0].line_total)).toBe(1870);

    /*
     * فتح المسودة وحفظها بدون تغيير
     * لازم لا يحول 1870 إلى 1869.96.
     */
    const updated = updatePurchaseOrder({
      purchase_order_id: order.purchase_order_id,

      supplier_id: supplier.id,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: Number(snapshot.items[0].quantity),

          unit_cost: Number(snapshot.items[0].unit_cost),
        },
      ],
    }) as any;

    expect(Number(updated.items[0].unit_cost)).toBe(155.83);

    expect(Number(updated.items[0].line_total)).toBe(1870);

    const received = receivePurchaseOrder({
      purchase_order_id: order.purchase_order_id,

      actor_id: 1,

      paid_amount: 0,
    });

    expect(received.exact_total_amount).toBe(1870);

    expect(received.total_amount).toBe(1870);

    expect(getVariantStock(variant.variant_id)).toBe(12);
  });

  it('settles purchase order reception with whole cash and exact invoice value', () => {
    const db = getDb();

    db.prepare(
      `
    INSERT INTO cash_movements (
      type,
      amount,
      direction,
      payment_method,
      reference_type,
      created_by
    )

    VALUES (
      'deposit',
      2000,
      'in',
      'store_cash',
      'test_seed',
      1
    )
    `,
    ).run();

    const supplier = createSupplier({
      name: 'Purchase Order Settlement Supplier',
    }) as any;

    const variant = seedVariant({
      name: 'Purchase Order Settlement Product',

      barcode: 'PO-SETTLEMENT',

      openingQty: 0,

      minStock: 1,

      buyPrice: 100,
    });

    const order = createPurchaseOrder({
      supplier_id: supplier.id,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 981.75,
        },
      ],
    });

    const received = receivePurchaseOrder({
      purchase_order_id: order.purchase_order_id,

      actor_id: 1,

      paid_amount: 982,

      settle_full_balance: true,

      payment_method: 'store_cash',
    });

    expect(received.total_amount).toBe(981.75);

    expect(received.paid_amount).toBe(981.75);

    expect(received.cash_amount).toBe(982);

    expect(received.rounding_adjustment).toBe(0.25);

    expect(received.remaining_amount).toBe(0);

    expect(received.settle_full_balance).toBe(true);

    const invoice = db
      .prepare(
        `
      SELECT
        settle_full_balance,
        remaining_amount

      FROM purchase_invoices

      WHERE id = ?
      `,
      )
      .get(received.purchaseId) as any;

    expect(Number(invoice.settle_full_balance)).toBe(1);

    expect(Number(invoice.remaining_amount)).toBe(0);

    const movement = db
      .prepare(
        `
      SELECT amount

      FROM cash_movements

      WHERE
        reference_type =
          'purchase_invoice'

        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
      )
      .get(received.purchaseId) as any;

    expect(Number(movement.amount)).toBe(982);
  });
});
