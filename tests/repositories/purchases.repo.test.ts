import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  recordSupplierPayment,
  cancelPurchaseInvoice,
  cancelSupplierPaymentBatch,
  getSupplierPaymentBatchAccess,
  updateSupplierPaymentBatch,
  listPurchaseInvoices,
  getSupplierStatement,
  createPurchaseReturn,
  cancelPurchaseReturn,
  updatePurchaseReturn,
  updatePurchaseInvoice,
  getPurchaseReturn,
} from '../../src/main/database/repositories/purchases.repo';

import {
  closeCashShift,
  getOpenCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo';

type PurchaseVariantTestRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
  buy_price: number;
  stock: number;
  min_stock: number;
  is_active: number;
};

function seedStoreCashBalance() {
  const db = getDb();

  db.prepare(
    `
    INSERT INTO cash_movements (
      type,
      amount,
      direction,
      payment_method,
      reference_id,
      reference_type,
      notes,
      created_by
    )
    VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)
    `,
  ).run(
    'deposit',
    1000000,
    'in',
    'store_cash',
    'test_seed',
    'Test opening cash balance',
  );
}

function seedPurchaseProduct(openingQty = 0) {
  createProduct({
    name: 'Purchase Test Product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'PURCHASE001',
        size: 'M',
        color: 'Black',
        buy_price: 100,
        sell_price: 150,
        min_stock: 5,
        opening_qty: openingQty,
      },
    ],
  });

  const variant = getVariantByBarcode('PURCHASE001') as
    PurchaseVariantTestRow | undefined;

  if (!variant) {
    throw new Error('Failed to seed purchase test product variant');
  }

  return variant;
}

function createTestSupplier() {
  const db = getDb();

  const result = db
    .prepare(
      `
      INSERT INTO suppliers (name, phone, email, address, notes)
      VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run('Test Supplier', '01111111111', null, null, null);

  return Number(result.lastInsertRowid);
}

function getSupplierBalance(supplierId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT balance
      FROM suppliers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(supplierId) as { balance: number };

  return Number(row.balance || 0);
}

function getSupplierTotalPurchased(supplierId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT total_purchased
      FROM suppliers
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(supplierId) as { total_purchased: number };

  return Number(row.total_purchased || 0);
}

function getVariantCostState(barcode: string) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT
        pv.buy_price,
        pv.average_cost,
        pv.inventory_value,

        IFNULL(
          SUM(
            CASE
              WHEN sm.type = 'in'
                THEN sm.quantity

              WHEN sm.type = 'out'
                THEN -sm.quantity

              ELSE 0
            END
          ),
          0
        ) AS stock

      FROM product_variants pv

      LEFT JOIN stock_movements sm
        ON sm.variant_id =
           pv.id

      WHERE pv.barcode = ?

      GROUP BY pv.id

      LIMIT 1
      `,
    )
    .get(barcode) as {
    buy_price: number;
    average_cost: number;
    inventory_value: number;
    stock: number;
  };
}

function getCashMovementTotal(direction: 'in' | 'out') {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT IFNULL(SUM(amount), 0) AS total
      FROM cash_movements
      WHERE direction = ?
      `,
    )
    .get(direction) as { total: number };

  return Number(row.total || 0);
}

function getStockByBarcode(barcode: string) {
  const variant = getVariantByBarcode(barcode) as
    PurchaseVariantTestRow | undefined;

  if (!variant) {
    throw new Error(`Variant not found for barcode: ${barcode}`);
  }

  return Number(variant.stock || 0);
}

function getSupplierPaymentsCount(supplierId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM supplier_payments
      WHERE supplier_id = ?
      `,
    )
    .get(supplierId) as { count: number };

  return Number(row.count || 0);
}

describe('purchases repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    });
    seedStoreCashBalance();
  }, 30_000);

  it('preserves purchase payable cents without settlement', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 45.5,
        },
      ],
    });

    expect(purchase.exact_total_amount).toBe(45.5);
    expect(purchase.total_amount).toBe(45.5);
    expect(purchase.rounding_adjustment).toBe(0);
    expect(purchase.remaining_amount).toBe(45.5);

    expect(getSupplierBalance(supplierId)).toBe(45.5);

    const state = getVariantCostState('PURCHASE001');

    expect(Number(state.buy_price)).toBe(45.5);
    expect(Number(state.average_cost)).toBe(45.5);
    expect(Number(state.inventory_value)).toBe(45.5);
  });

  it('preserves purchase payable below half a pound', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 45.49,
        },
      ],
    });

    expect(purchase.exact_total_amount).toBe(45.49);
    expect(purchase.total_amount).toBe(45.49);
    expect(purchase.rounding_adjustment).toBe(0);
    expect(purchase.remaining_amount).toBe(45.49);

    expect(getSupplierBalance(supplierId)).toBe(45.49);

    const state = getVariantCostState('PURCHASE001');

    expect(Number(state.inventory_value)).toBe(45.49);
  });

  it('preserves fractional purchase cost in inventory valuation', () => {
    createProduct({
      name: 'Fractional Cost Product',

      category_id: null,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'PURCHASE-FRACTIONAL-COST',

          size: 'M',

          color: 'Black',

          buy_price: 20.5,

          sell_price: 100,

          min_stock: 1,

          opening_qty: 3,
        },
      ],
    });

    const state = getVariantCostState('PURCHASE-FRACTIONAL-COST');

    expect(Number(state.buy_price)).toBe(20.5);

    expect(Number(state.average_cost)).toBe(20.5);

    expect(Number(state.inventory_value)).toBe(61.5);

    expect(Number(state.stock)).toBe(3);
  });

  it('rejects missing supplier_id', () => {
    const variant = seedPurchaseProduct();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: 0,
        paid_amount: 0,
        actor_id: 1,
        items: [
          {
            variant_id: variant.variant_id,
            quantity: 1,
            unit_cost: 100,
          },
        ],
      }),
    ).toThrow('اختار المورد');
  });

  it('rejects purchase without items', () => {
    const supplierId = createTestSupplier();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: supplierId,
        paid_amount: 0,
        items: [],
      }),
    ).toThrow('لا توجد أصناف في فاتورة الشراء');
  });

  it('rejects missing supplier', () => {
    const variant = seedPurchaseProduct();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: 999999,
        paid_amount: 0,
        items: [
          {
            variant_id: variant.variant_id,
            quantity: 1,
            unit_cost: 100,
          },
        ],
      }),
    ).toThrow('المورد غير موجود');
  });

  it('rejects invalid item quantity', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: supplierId,
        paid_amount: 0,
        items: [
          {
            variant_id: variant.variant_id,
            quantity: 0,
            unit_cost: 100,
          },
        ],
      }),
    ).toThrow('كمية غير صحيحة');
  });

  it('rejects invalid unit cost', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: supplierId,
        paid_amount: 0,
        items: [
          {
            variant_id: variant.variant_id,
            quantity: 1,
            unit_cost: 0,
          },
        ],
      }),
    ).toThrow('سعر شراء غير صحيح');
  });

  it('creates a fully paid purchase and increases stock', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    expect(getStockByBarcode('PURCHASE001')).toBe(0);

    const result = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 500,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    expect(result.purchaseId).toBeGreaterThan(0);
    expect(result.total_amount).toBe(500);
    expect(result.paid_amount).toBe(500);
    expect(result.remaining_amount).toBe(0);
    expect(result.payment_status).toBe('paid');

    expect(getStockByBarcode('PURCHASE001')).toBe(5);
    expect(getSupplierBalance(supplierId)).toBe(0);
    expect(getSupplierTotalPurchased(supplierId)).toBe(500);
    expect(getCashMovementTotal('out')).toBe(500);

    const invoice = getPurchaseInvoice(result.purchaseId) as any;

    expect(invoice.purchase.id).toBe(result.purchaseId);
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].quantity).toBe(5);
    expect(invoice.items[0].unit_cost).toBe(100);
    expect(invoice.items[0].line_total).toBe(500);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].amount).toBe(500);
  });

  it('records whole-pound cash separately from exact purchase settlement', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const result = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,

      paid_amount: 2101,
      settle_full_balance: true,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 2100.69,
        },
      ],
    });

    expect(result.exact_total_amount).toBe(2100.69);

    /*
     * أصل الفاتورة لا يتقرب.
     */
    expect(result.total_amount).toBe(2100.69);

    /*
     * الكاش 2101
     * المحاسبي 2100.69
     */
    expect(result.rounding_adjustment).toBe(0.31);

    expect(result.paid_amount).toBe(2100.69);
    expect(result.remaining_amount).toBe(0);

    const invoice = getPurchaseInvoice(result.purchaseId) as any;

    expect(invoice.items[0].unit_cost).toBe(2100.69);
    expect(invoice.items[0].line_total).toBe(2100.69);

    expect(Number(invoice.purchase.total_amount)).toBe(2100.69);
    expect(Number(invoice.purchase.exact_total_amount)).toBe(2100.69);
    expect(Number(invoice.purchase.rounding_adjustment)).toBe(0.31);

    expect(getSupplierTotalPurchased(supplierId)).toBe(2100.69);

    /*
     * الخارج الحقيقي من الحساب.
     */
    expect(getCashMovementTotal('out')).toBe(2101);
  });

  it('preserves exact supplier debt across partial purchase returns', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 2,
          unit_cost: 22.75,
        },
      ],
    });

    expect(purchase.exact_total_amount).toBe(45.5);
    expect(purchase.total_amount).toBe(45.5);
    expect(purchase.rounding_adjustment).toBe(0);

    expect(getSupplierBalance(supplierId)).toBe(45.5);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseItemId = Number(invoice.items[0].id);

    const firstReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,
      actor_id: 1,
      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,
          quantity: 1,
        },
      ],
    });

    expect(firstReturn.exact_total_amount).toBe(22.75);
    expect(firstReturn.total_amount).toBe(22.75);
    expect(firstReturn.rounding_adjustment).toBe(0);
    expect(firstReturn.debt_reduction_amount).toBe(22.75);

    expect(getSupplierBalance(supplierId)).toBe(22.75);

    let currentInvoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(currentInvoice.purchase.remaining_amount)).toBe(22.75);

    const secondReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,
      actor_id: 1,
      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,
          quantity: 1,
        },
      ],
    });

    expect(secondReturn.exact_total_amount).toBe(22.75);
    expect(secondReturn.total_amount).toBe(22.75);
    expect(secondReturn.rounding_adjustment).toBe(0);

    expect(getSupplierBalance(supplierId)).toBe(0);

    currentInvoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(currentInvoice.purchase.remaining_amount)).toBe(0);

    const state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(0);
    expect(Number(state.inventory_value)).toBe(0);
  });

  it('keeps supplier cents open until full settlement is explicit', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 45.5,
        },
      ],
    });

    expect(purchase.total_amount).toBe(45.5);
    expect(getSupplierBalance(supplierId)).toBe(45.5);

    /*
     * دفع 45 فقط:
     * الـ50 قرش تظل مديونية.
     */
    const partialPayment = recordSupplierPayment({
      supplier_id: supplierId,
      purchase_id: purchase.purchaseId,

      amount: 45,

      payment_method: 'store_cash',
      actor_id: 1,
    });

    expect(partialPayment.paid_amount).toBe(45);
    expect(partialPayment.cash_amount).toBe(45);
    expect(partialPayment.rounding_adjustment).toBe(0);

    expect(partialPayment.allocations[0].amount).toBe(45);

    expect(getSupplierBalance(supplierId)).toBe(0.5);

    let invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.paid_amount)).toBe(45);
    expect(Number(invoice.purchase.remaining_amount)).toBe(0.5);
    expect(invoice.purchase.payment_status).toBe('partial');

    /*
     * الآن نختار صراحة تسوية
     * آخر 50 قرش بجنيه كامل.
     */
    const finalSettlement = recordSupplierPayment({
      supplier_id: supplierId,
      purchase_id: purchase.purchaseId,

      amount: 1,

      settle_full_balance: true,

      payment_method: 'store_cash',
      actor_id: 1,
    });

    expect(finalSettlement.paid_amount).toBe(0.5);
    expect(finalSettlement.cash_amount).toBe(1);
    expect(finalSettlement.rounding_adjustment).toBe(0.5);

    expect(finalSettlement.allocations[0].amount).toBe(0.5);

    expect(getSupplierBalance(supplierId)).toBe(0);

    invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.paid_amount)).toBe(45.5);
    expect(Number(invoice.purchase.remaining_amount)).toBe(0);
    expect(invoice.purchase.payment_status).toBe('paid');
  });

  it('restores fractional purchase rounding correctly when cancelling a purchase return', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 22.75,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;
    const restoredInvoice = getPurchaseInvoice(purchase.purchaseId) as any;
    const purchaseReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: Number(invoice.items[0].id),

          quantity: 1,
        },
      ],
    });

    expect(purchaseReturn.exact_total_amount).toBe(22.75);

    expect(purchaseReturn.total_amount).toBe(22.75);

    expect(purchaseReturn.rounding_adjustment).toBe(0);

    expect(getSupplierBalance(supplierId)).toBe(22.75);

    cancelPurchaseReturn({
      return_id: purchaseReturn.return_id,

      reason: 'Undo fractional return',

      actor_id: 1,
    });

    expect(getSupplierBalance(supplierId)).toBe(45.5);

    expect(getSupplierTotalPurchased(supplierId)).toBe(45.5);

    expect(Number(restoredInvoice.purchase.remaining_amount)).toBe(45.5);

    expect(Number(restoredInvoice.items[0].returned_quantity)).toBe(0);

    const state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(2);

    expect(Number(state.inventory_value)).toBe(45.5);
  });

  it('recalculates settlement safely when updating a fractional purchase return', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 3,

          unit_cost: 15.5,
        },
      ],
    });

    /*
     * 3 × 15.5 = 46.5
     * والمستحق يظل 46.5
     */
    expect(purchase.total_amount).toBe(46.5);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseItemId = Number(invoice.items[0].id);

    const firstReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 1,
        },
      ],
    });

    /*
     * قبل المرتجع = 47
     * المتبقي الدقيق = 31
     * المستحق الجديد = 31
     *
     * إذن تسوية المرتجع = 16
     */
    expect(firstReturn.exact_total_amount).toBe(15.5);

    expect(firstReturn.total_amount).toBe(15.5);

    expect(firstReturn.rounding_adjustment).toBe(0);

    const updated = updatePurchaseReturn({
      return_id: firstReturn.return_id,

      actor_id: 1,

      reason: 'Correct fractional return quantity',

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 2,
        },
      ],
    });

    expect(updated.edited).toBe(true);

    /*
     * المرتجع الجديد:
     * 2 × 15.5 = 31
     *
     * المتبقي:
     * 15.5 → مستحق 16
     *
     * 47 - 16 = 31
     */
    expect(updated.exact_total_amount).toBe(31);

    expect(updated.total_amount).toBe(31);

    expect(getSupplierBalance(supplierId)).toBe(15.5);

    const currentInvoice = getPurchaseInvoice(purchase.purchaseId) as any;
    expect(Number(currentInvoice.purchase.remaining_amount)).toBe(15.5);

    expect(Number(currentInvoice.items[0].returned_quantity)).toBe(2);

    const state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(1);

    expect(Number(state.inventory_value)).toBe(15.5);
  });

  it('preserves fractional previous buy price through purchase edit and cancellation', () => {
    const supplierId = createTestSupplier();

    createProduct({
      name: 'Fractional Previous Cost',

      category_id: null,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'FRACTIONAL-PREVIOUS-COST',

          size: 'M',

          color: 'Black',

          buy_price: 20.5,

          sell_price: 100,

          min_stock: 1,

          opening_qty: 0,
        },
      ],
    });

    const variant = getVariantByBarcode(
      'FRACTIONAL-PREVIOUS-COST',
    ) as PurchaseVariantTestRow;

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 30.25,
        },
      ],
    });

    expect(
      (
        getVariantByBarcode(
          'FRACTIONAL-PREVIOUS-COST',
        ) as PurchaseVariantTestRow
      ).buy_price,
    ).toBe(30.25);

    updatePurchaseInvoice({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      reason: 'Correct fractional cost',

      supplier_id: supplierId,

      sub_total: 31.75,

      discount_type: 'amount',

      discount_input: 0,

      discount_value: 0,

      paid_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 31.75,
        },
      ],
    });

    expect(
      (
        getVariantByBarcode(
          'FRACTIONAL-PREVIOUS-COST',
        ) as PurchaseVariantTestRow
      ).buy_price,
    ).toBe(31.75);

    cancelPurchaseInvoice({
      purchase_id: purchase.purchaseId,

      reason: 'Cancel corrected purchase',

      actor_id: 1,
    });

    expect(
      (
        getVariantByBarcode(
          'FRACTIONAL-PREVIOUS-COST',
        ) as PurchaseVariantTestRow
      ).buy_price,
    ).toBe(20.5);
  });

  it('preserves supplier credit and reverses actual settled cash when cancelling a purchase', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    /*
     * فاتورة أولى مدفوعة بالكامل.
     */
    const firstPurchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,

      paid_amount: 100,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 100,
        },
      ],
    });

    const firstInvoice = getPurchaseInvoice(firstPurchase.purchaseId) as any;

    /*
     * رجعنا البضاعة كرَصيد عند المورد.
     * بما إن الفاتورة مدفوعة:
     * المورد بقى مديون لينا 100.
     */
    createPurchaseReturn({
      purchase_id: firstPurchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: Number(firstInvoice.items[0].id),

          quantity: 1,
        },
      ],
    });

    expect(getSupplierBalance(supplierId)).toBe(-100);

    /*
     * فاتورة جديدة:
     * القيمة المحاسبية = 981.75
     * الكاش الحقيقي = 982
     */
    const settledPurchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 982,

      settle_full_balance: true,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 981.75,
        },
      ],
    });

    expect(settledPurchase.total_amount).toBe(981.75);

    expect(settledPurchase.paid_amount).toBe(981.75);

    expect(settledPurchase.rounding_adjustment).toBe(0.25);

    /*
     * الفاتورة مدفوعة،
     * لذلك رصيد المورد الدائن القديم
     * يظل كما هو.
     */
    expect(getSupplierBalance(supplierId)).toBe(-100);

    const cancelled = cancelPurchaseInvoice({
      purchase_id: settledPurchase.purchaseId,

      reason: 'Test settled purchase cancellation',

      actor_id: 1,
    });

    /*
     * المحاسبي = 981.75
     * الكاش المرتجع فعليًا = 982
     */
    expect(cancelled.reversed_paid).toBe(981.75);

    expect(cancelled.reversed_cash).toBe(982);

    /*
     * ممنوع إلغاء رصيد المورد السالب.
     */
    expect(cancelled.supplier_balance).toBe(-100);

    expect(getSupplierBalance(supplierId)).toBe(-100);

    const reverseMovement = getDb()
      .prepare(
        `
      SELECT *
      FROM cash_movements

      WHERE
        reference_type =
          'purchase_cancel'

        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
      )
      .get(settledPurchase.purchaseId) as any;

    expect(reverseMovement.direction).toBe('in');

    expect(Number(reverseMovement.amount)).toBe(982);

    expect(getSupplierTotalPurchased(supplierId)).toBe(0);
  });

  it('does not double count legacy purchase rounding when cancelling an invoice', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    /*
     * ننشئ فاتورة مدفوعة 444
     * ثم نحول سجلها لشكل النظام القديم:
     *
     * exact = 443.75
     * total = 444
     * paid = 444
     * adjustment = +0.25
     *
     * في النظام القديم paid نفسه
     * كان يمثل الكاش الحقيقي.
     */
    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 444,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 444,
        },
      ],
    });

    getDb()
      .prepare(
        `
      UPDATE purchase_invoices

      SET
        total_amount = 444,
        exact_total_amount = 443.75,
        rounding_adjustment = 0.25,
        paid_amount = 444,
        remaining_amount = 0,
        payment_status = 'paid'

      WHERE id = ?
      `,
      )
      .run(purchase.purchaseId);

    const cancelled = cancelPurchaseInvoice({
      purchase_id: purchase.purchaseId,

      reason: 'Legacy rounding cancellation test',

      actor_id: 1,
    });

    /*
     * ممنوع:
     * 444 + 0.25 = 444.25
     *
     * الصحيح:
     * الكاش القديم كان 444 بالفعل.
     */
    expect(cancelled.reversed_paid).toBe(444);

    expect(cancelled.reversed_cash).toBe(444);

    const reverseMovement = getDb()
      .prepare(
        `
      SELECT *
      FROM cash_movements

      WHERE
        reference_type = 'purchase_cancel'
        AND reference_id = ?

      ORDER BY id DESC

      LIMIT 1
      `,
      )
      .get(purchase.purchaseId) as any;

    expect(reverseMovement.direction).toBe('in');

    expect(Number(reverseMovement.amount)).toBe(444);
  });

  it('persists explicit full settlement intent even when rounding adjustment is zero', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    /*
     * هنا مفيش فرق قروش:
     *
     * الفاتورة = 100
     * الكاش = 100
     * فرق التسوية = 0
     *
     * ومع ذلك المستخدم اختار
     * "تسوية كامل الفاتورة" صراحة.
     */
    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 100,

      settle_full_balance: true,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 100,
        },
      ],
    });

    expect(purchase.total_amount).toBe(100);

    expect(purchase.paid_amount).toBe(100);

    expect(purchase.remaining_amount).toBe(0);

    expect(purchase.rounding_adjustment).toBe(0);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    /*
     * المهم:
     * النية محفوظة صراحة،
     * ومش بنستنتجها من فرق التقريب.
     */
    expect(Number(invoice.purchase.settle_full_balance)).toBe(1);

    expect(Number(invoice.purchase.rounding_adjustment)).toBe(0);

    expect(Number(invoice.purchase.remaining_amount)).toBe(0);

    expect(invoice.purchase.payment_status).toBe('paid');
  });

  it('settles a sub-half-pound purchase with zero cash and no zero-value cash movement', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    /*
     * 0.40 لأقرب جنيه = 0.
     *
     * المستخدم اختار التسوية صراحة،
     * لذلك:
     *
     * محاسبيًا نقفل 0.40
     * كاش فعلي = 0
     * فرق التسوية = -0.40
     */
    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      settle_full_balance: true,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 0.4,
        },
      ],
    });

    expect(purchase.total_amount).toBe(0.4);

    expect(purchase.paid_amount).toBe(0.4);

    expect(purchase.remaining_amount).toBe(0);

    expect(purchase.rounding_adjustment).toBe(-0.4);

    expect(getSupplierBalance(supplierId)).toBe(0);

    /*
     * فيه قيد محاسبي على المورد.
     */
    expect(getSupplierPaymentsCount(supplierId)).toBe(1);

    /*
     * لكن مفيش كاش خرج فعليًا.
     */
    const cashMovementCount = getDb()
      .prepare(
        `
      SELECT COUNT(*) AS count

      FROM cash_movements

      WHERE
        reference_type =
          'purchase_invoice'

        AND reference_id = ?
      `,
      )
      .get(purchase.purchaseId) as {
      count: number;
    };

    expect(Number(cashMovementCount.count)).toBe(0);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.settle_full_balance)).toBe(1);

    expect(Number(invoice.purchase.remaining_amount)).toBe(0);
  });

  it('supports zero-cash full settlement when editing a sub-half-pound purchase', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    /*
     * نبدأ الفاتورة غير مدفوعة.
     */
    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 0.4,
        },
      ],
    });

    expect(getSupplierBalance(supplierId)).toBe(0.4);

    expect(getSupplierPaymentsCount(supplierId)).toBe(0);

    /*
     * أثناء التعديل نختار
     * تسوية كامل الفاتورة.
     *
     * أقرب جنيه لـ0.40 = صفر.
     */
    const edited = updatePurchaseInvoice({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      reason: 'Settle small purchase',

      supplier_id: supplierId,

      sub_total: 0.4,

      discount_type: 'amount',

      discount_input: 0,

      discount_value: 0,

      paid_amount: 0,

      settle_full_balance: true,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 0.4,
        },
      ],
    });

    expect(edited.total_amount).toBe(0.4);

    expect(edited.paid_amount).toBe(0.4);

    expect(edited.remaining_amount).toBe(0);

    expect(edited.rounding_adjustment).toBe(-0.4);

    expect(getSupplierBalance(supplierId)).toBe(0);

    expect(getSupplierPaymentsCount(supplierId)).toBe(1);

    const cashMovementCount = getDb()
      .prepare(
        `
      SELECT COUNT(*) AS count

      FROM cash_movements

      WHERE
        reference_type =
          'purchase_invoice'

        AND reference_id = ?
      `,
      )
      .get(purchase.purchaseId) as {
      count: number;
    };

    /*
     * ممنوع إنشاء حركة كاش بقيمة صفر.
     */
    expect(Number(cashMovementCount.count)).toBe(0);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.settle_full_balance)).toBe(1);

    expect(Number(invoice.purchase.rounding_adjustment)).toBe(-0.4);

    expect(invoice.purchase.payment_status).toBe('paid');
  });

  it('does not infer settlement rounding from legacy fractional purchase details', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 443.75,
        },
      ],
    });

    getDb()
      .prepare(
        `
      UPDATE purchase_invoices

      SET
        total_amount = 443.75,

        exact_total_amount =
          443.75,

        rounding_adjustment = 0

      WHERE id = ?
      `,
      )
      .run(purchase.purchaseId);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.effective_exact_total_amount)).toBe(443.75);

    expect(Number(invoice.purchase.effective_rounding_adjustment)).toBe(0);

    expect(Number(invoice.purchase.settlement_total_amount)).toBe(443.75);
  });

  it('creates a partial purchase and increases supplier balance', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const result = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 200,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    expect(result.total_amount).toBe(500);
    expect(result.paid_amount).toBe(200);
    expect(result.remaining_amount).toBe(300);
    expect(result.payment_status).toBe('partial');

    expect(getStockByBarcode('PURCHASE001')).toBe(5);
    expect(getSupplierBalance(supplierId)).toBe(300);
    expect(getSupplierTotalPurchased(supplierId)).toBe(500);
    expect(getCashMovementTotal('out')).toBe(200);
  });

  it('creates an unpaid purchase and does not create cash movement', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const result = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    expect(result.total_amount).toBe(500);
    expect(result.paid_amount).toBe(0);
    expect(result.remaining_amount).toBe(500);
    expect(result.payment_status).toBe('unpaid');

    expect(getStockByBarcode('PURCHASE001')).toBe(5);
    expect(getSupplierBalance(supplierId)).toBe(500);
    expect(getCashMovementTotal('out')).toBe(0);
  });

  it('rejects purchase overpayment without explicit settlement', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: supplierId,

        actor_id: 1,

        paid_amount: 700,

        payment_method: 'cash',

        items: [
          {
            variant_id: variant.variant_id,

            quantity: 5,

            unit_cost: 100,
          },
        ],
      }),
    ).toThrow('المبلغ المدفوع أكبر من المستحق');

    /*
     * العملية كلها Transaction:
     * لا فاتورة ولا مخزون ولا كاش.
     */
    expect(getStockByBarcode('PURCHASE001')).toBe(0);

    expect(getSupplierBalance(supplierId)).toBe(0);

    expect(getCashMovementTotal('out')).toBe(0);
  });

  it('keeps last purchase price separately and calculates moving weighted average cost', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct(10);

    expect(getVariantCostState('PURCHASE001')).toMatchObject({
      buy_price: 100,
      average_cost: 100,
      inventory_value: 1000,
    });

    createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 10,

          unit_cost: 200,
        },
      ],
    });

    const costState = getVariantCostState('PURCHASE001');

    /*
     * 10 × 100
     * +
     * 10 × 200
     * =
     * 3000 / 20
     * =
     * 150
     */
    expect(Number(costState.buy_price)).toBe(200);

    expect(Number(costState.average_cost)).toBe(150);

    expect(Number(costState.inventory_value)).toBe(3000);
  });

  it('restores variant buy price after cancelling the latest purchase', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    expect(variant.buy_price).toBe(100);

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 2,
          unit_cost: 130,
        },
      ],
    });

    const afterPurchase = getVariantByBarcode(
      'PURCHASE001',
    ) as PurchaseVariantTestRow;

    expect(afterPurchase.buy_price).toBe(130);

    cancelPurchaseInvoice({
      purchase_id: purchase.purchaseId,
      reason: 'Test purchase cancellation',
      actor_id: 1,
    });

    const afterCancellation = getVariantByBarcode(
      'PURCHASE001',
    ) as PurchaseVariantTestRow;

    expect(afterCancellation.buy_price).toBe(100);
  });

  it('keeps the latest active purchase cost when cancelling an older purchase', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const firstPurchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 2,
          unit_cost: 130,
        },
      ],
    });

    const secondPurchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 2,
          unit_cost: 160,
        },
      ],
    });

    expect(
      (getVariantByBarcode('PURCHASE001') as PurchaseVariantTestRow).buy_price,
    ).toBe(160);

    cancelPurchaseInvoice({
      purchase_id: firstPurchase.purchaseId,
      reason: 'Cancel older purchase',
      actor_id: 1,
    });

    expect(
      (getVariantByBarcode('PURCHASE001') as PurchaseVariantTestRow).buy_price,
    ).toBe(160);

    cancelPurchaseInvoice({
      purchase_id: secondPurchase.purchaseId,
      reason: 'Cancel latest purchase',
      actor_id: 1,
    });

    expect(
      (getVariantByBarcode('PURCHASE001') as PurchaseVariantTestRow).buy_price,
    ).toBe(100);
  });

  it('records supplier payment and reduces supplier balance', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    expect(purchase.total_amount).toBe(500);
    expect(purchase.remaining_amount).toBe(500);
    expect(getSupplierBalance(supplierId)).toBe(500);
    expect(getCashMovementTotal('out')).toBe(0);
    expect(getSupplierPaymentsCount(supplierId)).toBe(0);

    const payment = recordSupplierPayment({
      supplier_id: supplierId,
      purchase_id: purchase.purchaseId,
      amount: 200,
      payment_method: 'cash',
      actor_id: 1,
      notes: 'Partial supplier payment',
    });

    expect(payment.ok).toBe(true);

    expect(getSupplierBalance(supplierId)).toBe(300);
    expect(getCashMovementTotal('out')).toBe(200);
    expect(getSupplierPaymentsCount(supplierId)).toBe(1);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].amount).toBe(200);
  });

  it('cancels latest supplier payment and restores supplier debt', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,
      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    const payment = recordSupplierPayment({
      supplier_id: supplierId,

      purchase_id: purchase.purchaseId,

      amount: 200,

      payment_method: 'cash',

      actor_id: 1,
    });

    const access = getSupplierPaymentBatchAccess(payment.payment_batch_id, 1);

    expect(access.requires_admin_password).toBe(false);

    const result = cancelSupplierPaymentBatch({
      batch_id: payment.payment_batch_id,

      reason: 'Wrong amount',

      actor_id: 1,
    });

    expect(result.success).toBe(true);

    expect(result.cancelled_amount).toBe(200);

    expect(getSupplierBalance(supplierId)).toBe(500);

    const statement = getSupplierStatement(supplierId, 1) as any;

    expect(statement.summary.total_paid).toBe(0);

    const cancelledEntries = statement.entries.filter(
      (entry: any) =>
        Number(entry.batch_id) === Number(payment.payment_batch_id),
    );

    expect(cancelledEntries).toHaveLength(1);

    expect(cancelledEntries[0].credit).toBe(0);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(invoice.purchase.paid_amount).toBe(0);

    expect(invoice.purchase.remaining_amount).toBe(500);

    expect(invoice.purchase.payment_status).toBe('unpaid');

    const db = getDb();

    const batch = db
      .prepare(
        `
      SELECT *
      FROM supplier_payment_batches
      WHERE id = ?
      `,
      )
      .get(payment.payment_batch_id) as any;

    expect(batch.cancelled_at).toBeTruthy();

    const movement = db
      .prepare(
        `
      SELECT *

      FROM cash_movements

      WHERE type =
        'supplier_payment'

        AND reference_type =
          'supplier_payment'

        AND reference_id = ?

      LIMIT 1
      `,
      )
      .get(payment.payment_batch_id) as any;

    expect(movement.cancelled_at).toBeNull();

    const reverseMovement = db
      .prepare(
        `
        SELECT *
        FROM cash_movements

        WHERE reference_type =
          'supplier_payment_cancel'

          AND reference_id = ?

        ORDER BY id DESC
        LIMIT 1
        `,
      )
      .get(payment.payment_batch_id) as any;

    expect(reverseMovement).toBeTruthy();
    expect(reverseMovement.direction).toBe('in');
    expect(Number(reverseMovement.amount)).toBe(200);
  });

  it('updates latest supplier payment and replaces its financial effects', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 100,
        },
      ],
    });

    const payment = recordSupplierPayment({
      supplier_id: supplierId,

      purchase_id: purchase.purchaseId,

      amount: 200,

      payment_method: 'cash',

      actor_id: 1,
    });

    expect(getSupplierBalance(supplierId)).toBe(300);

    const result = updateSupplierPaymentBatch({
      batch_id: payment.payment_batch_id,

      amount: 75,

      payment_method: 'cash',

      notes: 'Corrected supplier payment',

      actor_id: 1,
    });

    expect(result.success).toBe(true);

    expect(result.old_amount).toBe(200);

    expect(result.new_amount).toBe(75);

    expect(result.batch_id).not.toBe(payment.payment_batch_id);

    expect(getSupplierBalance(supplierId)).toBe(425);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(invoice.purchase.paid_amount).toBe(75);

    expect(invoice.purchase.remaining_amount).toBe(425);

    expect(invoice.purchase.payment_status).toBe('partial');

    const db = getDb();

    const oldBatch = db
      .prepare(
        `
      SELECT *

      FROM supplier_payment_batches

      WHERE id = ?
      `,
      )
      .get(payment.payment_batch_id) as any;

    expect(oldBatch.cancelled_at).toBeTruthy();

    expect(Number(oldBatch.replacement_batch_id)).toBe(result.batch_id);

    const newBatch = db
      .prepare(
        `
      SELECT *

      FROM supplier_payment_batches

      WHERE id = ?
      `,
      )
      .get(result.batch_id) as any;

    expect(Number(newBatch.amount)).toBe(75);

    expect(newBatch.cancelled_at).toBeNull();

    expect(newBatch.created_at).toBe(oldBatch.created_at);

    expect(Number(newBatch.created_by)).toBe(Number(oldBatch.created_by));

    const oldCashMovement = db
      .prepare(
        `
      SELECT *

      FROM cash_movements

      WHERE reference_type =
        'supplier_payment'

        AND reference_id = ?

      LIMIT 1
      `,
      )
      .get(payment.payment_batch_id) as any;

    expect(oldCashMovement.cancelled_at).toBeNull();

    const reverseMovement = db
      .prepare(
        `
        SELECT *
        FROM cash_movements

        WHERE reference_type =
          'supplier_payment_update_reverse'

          AND reference_id = ?

        ORDER BY id DESC
        LIMIT 1
        `,
      )
      .get(payment.payment_batch_id) as any;

    expect(reverseMovement).toBeTruthy();
    expect(reverseMovement.direction).toBe('in');
    expect(Number(reverseMovement.amount)).toBe(200);

    const newCashMovement = db
      .prepare(
        `
      SELECT *

      FROM cash_movements

      WHERE reference_type =
        'supplier_payment'

        AND reference_id = ?

      LIMIT 1
      `,
      )
      .get(result.batch_id) as any;

    expect(newCashMovement.cancelled_at).toBeNull();

    expect(Number(newCashMovement.amount)).toBe(75);
  });

  it('blocks cancelling older supplier payment when a newer active payment exists', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    const firstPayment = recordSupplierPayment({
      supplier_id: supplierId,

      purchase_id: purchase.purchaseId,

      amount: 100,

      payment_method: 'cash',

      actor_id: 1,
    });

    recordSupplierPayment({
      supplier_id: supplierId,

      purchase_id: purchase.purchaseId,

      amount: 100,

      payment_method: 'cash',

      actor_id: 1,
    });

    expect(() =>
      cancelSupplierPaymentBatch({
        batch_id: firstPayment.payment_batch_id,

        reason: 'Old payment',

        actor_id: 1,
      }),
    ).toThrow('لا يمكن تعديل أو إلغاء الدفعة لوجود دفعة أحدث للمورد');
  });

  it('blocks supplier payment mutation when a newer invoice-time payment exists', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const firstPurchase = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    const manualPayment = recordSupplierPayment({
      supplier_id: supplierId,

      purchase_id: firstPurchase.purchaseId,

      amount: 100,

      payment_method: 'cash',

      actor_id: 1,
    });

    createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 50,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 100,
        },
      ],
    });

    expect(() =>
      cancelSupplierPaymentBatch({
        batch_id: manualPayment.payment_batch_id,

        reason: 'Old payment',

        actor_id: 1,
      }),
    ).toThrow('لا يمكن تعديل أو إلغاء الدفعة لوجود دفعة أحدث للمورد');
  });

  it('blocks purchase cancellation when legacy manual supplier payment exists', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    const db = getDb();

    db.prepare(
      `
    INSERT INTO supplier_payments (
      supplier_id,
      purchase_id,
      amount,
      payment_method,
      notes
    )
    VALUES (?, ?, ?, ?, ?)
    `,
    ).run(
      supplierId,
      purchase.purchaseId,
      100,
      'cash',
      'Legacy manual supplier payment',
    );

    expect(() =>
      cancelPurchaseInvoice({
        purchase_id: purchase.purchaseId,
        reason: 'Cancel test',
        actor_id: 1,
      }),
    ).toThrow('لا يمكن إلغاء فاتورة الشراء لأنها تحتوي على دفعة مورد لاحقة');
  });

  it('records full supplier payment and clears supplier balance', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    expect(getSupplierBalance(supplierId)).toBe(500);

    const payment = recordSupplierPayment({
      supplier_id: supplierId,
      purchase_id: purchase.purchaseId,
      amount: 500,
      payment_method: 'cash',
      actor_id: 1,
      notes: 'Full supplier payment',
    });

    expect(payment.ok).toBe(true);

    expect(getSupplierBalance(supplierId)).toBe(0);
    expect(getCashMovementTotal('out')).toBe(500);
    expect(getSupplierPaymentsCount(supplierId)).toBe(1);
  });

  it('rejects supplier payment with invalid amount', () => {
    const supplierId = createTestSupplier();

    expect(() =>
      recordSupplierPayment({
        supplier_id: supplierId,
        amount: 0,
        payment_method: 'cash',
        actor_id: 1,
      }),
    ).toThrow();
  });

  it('rejects supplier payment for missing supplier', () => {
    expect(() =>
      recordSupplierPayment({
        supplier_id: 999999,
        amount: 100,
        payment_method: 'cash',
        actor_id: 1,
      }),
    ).toThrow('المورد غير موجود');
  });

  it('rejects supplier payment greater than supplier balance', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    expect(getSupplierBalance(supplierId)).toBe(500);

    expect(() =>
      recordSupplierPayment({
        supplier_id: supplierId,
        amount: 700,
        payment_method: 'cash',
        actor_id: 1,
      }),
    ).toThrow('قيمة الدفع أكبر من المديونية المحددة');

    expect(getSupplierBalance(supplierId)).toBe(500);
    expect(getCashMovementTotal('out')).toBe(0);
  });

  it('returns supplier statement with purchases and payments', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 100,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100,
        },
      ],
    });

    recordSupplierPayment({
      supplier_id: supplierId,
      purchase_id: purchase.purchaseId,
      actor_id: 1,
      amount: 200,
      payment_method: 'cash',
      notes: 'Second payment',
    });

    const statement = getSupplierStatement(supplierId) as any;

    expect(statement.supplier.id).toBe(supplierId);
    expect(statement.purchases.length).toBeGreaterThanOrEqual(1);
    expect(statement.payments.length).toBeGreaterThanOrEqual(2);
    expect(getSupplierBalance(supplierId)).toBe(200);
  });

  it('filters purchase invoices by payment state', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const paid = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 100,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 100,
        },
      ],
    });

    const partial = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 50,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 100,
        },
      ],
    });

    const unpaid = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,
          quantity: 1,
          unit_cost: 100,
        },
      ],
    });

    const paidResult = listPurchaseInvoices({
      payment_filter: 'paid',
    }) as any;

    expect(paidResult.rows.map((row: any) => row.id)).toEqual([
      paid.purchaseId,
    ]);

    const unpaidResult = listPurchaseInvoices({
      payment_filter: 'unpaid',
    }) as any;

    const unpaidIds = unpaidResult.rows.map((row: any) => row.id);

    expect(unpaidIds).toContain(partial.purchaseId);

    expect(unpaidIds).toContain(unpaid.purchaseId);

    expect(unpaidIds).not.toContain(paid.purchaseId);
  });

  it('keeps purchase and supplier cash history immutable across shifts', () => {
    const db = getDb();

    /*
     * جهز درج بـ1000 عن طريق
     * إغلاق الشفت الحالي وفتح واحد
     * بالجرد الفعلي.
     */
    const firstOpen = getOpenCashShift()!;

    closeCashShift({
      shift_id: firstOpen.id,
      closing_counted_amount: 0,
      left_for_next_shift: 0,
      closed_by: 1,
    });

    const shift1 = openCashShift({
      opening_counted_amount: 1000,
      opened_by: 1,
    });

    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      actor_id: 1,

      supplier_id: supplierId,

      paid_amount: 200,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 150,
        },
      ],
    });

    expect(purchase.shift_id).toBe(shift1.id);

    const purchaseMovement = db
      .prepare(
        `
      SELECT *
      FROM cash_movements
      WHERE reference_type =
        'purchase_invoice'
        AND reference_id = ?
      LIMIT 1
    `,
      )
      .get(purchase.purchaseId) as any;

    expect(Number(purchaseMovement.shift_id)).toBe(shift1.id);

    closeCashShift({
      shift_id: shift1.id,
      closing_counted_amount: 800,
      left_for_next_shift: 800,
      closed_by: 1,
    });

    const shift2 = openCashShift({
      opening_counted_amount: 800,
      opened_by: 1,
    });

    const cancelled = cancelPurchaseInvoice({
      purchase_id: purchase.purchaseId,

      reason: 'إلغاء في شفت جديد',

      actor_id: 1,
    });

    expect(cancelled.cancelled_shift_id).toBe(shift2.id);

    const cancelledPurchaseRow = db
      .prepare(
        `
    SELECT
      cancelled_by,
      cancelled_shift_id,
      cancel_reason

    FROM purchase_invoices

    WHERE id = ?
    `,
      )
      .get(purchase.purchaseId) as any;

    expect(Number(cancelledPurchaseRow.cancelled_by)).toBe(1);

    expect(Number(cancelledPurchaseRow.cancelled_shift_id)).toBe(shift2.id);

    expect(cancelledPurchaseRow.cancel_reason).toBe('إلغاء في شفت جديد');

    /*
     * حركة الدفع الأصلية لا تلغى.
     */
    const originalAfterCancel = db
      .prepare(
        `
      SELECT
        cancelled_at,
        shift_id
      FROM cash_movements
      WHERE id = ?
    `,
      )
      .get(purchaseMovement.id) as any;

    expect(originalAfterCancel.cancelled_at).toBeNull();

    expect(Number(originalAfterCancel.shift_id)).toBe(shift1.id);

    const reverse = db
      .prepare(
        `
      SELECT *
      FROM cash_movements
      WHERE reference_type =
        'purchase_cancel'
        AND reference_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
      )
      .get(purchase.purchaseId) as any;

    expect(reverse.direction).toBe('in');

    expect(Number(reverse.amount)).toBe(200);

    expect(Number(reverse.shift_id)).toBe(shift2.id);
  });

  it('updates purchase invoice in place and preserves its creation identity', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 100,
        },
      ],
    });

    const before = getPurchaseInvoice(purchase.purchaseId) as any;

    const result = updatePurchaseInvoice({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      reason: 'Correct purchase invoice',

      supplier_id: supplierId,

      sub_total: 360,

      discount_type: 'amount',

      discount_input: 0,

      discount_value: 0,

      paid_amount: 60,

      payment_method: 'store_cash',

      notes: 'Corrected purchase',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 3,

          unit_cost: 120,
        },
      ],
    });

    expect(result.ok).toBe(true);

    expect(result.purchase_id).toBe(purchase.purchaseId);

    const after = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(after.purchase.id).toBe(before.purchase.id);

    expect(after.purchase.created_at).toBe(before.purchase.created_at);

    expect(Number(after.purchase.total_amount)).toBe(360);

    expect(Number(after.purchase.paid_amount)).toBe(60);

    expect(Number(after.purchase.remaining_amount)).toBe(300);

    expect(after.purchase.payment_status).toBe('partial');

    expect(after.items).toHaveLength(1);

    expect(Number(after.items[0].quantity)).toBe(3);

    expect(Number(after.items[0].unit_cost)).toBe(120);

    expect(getStockByBarcode('PURCHASE001')).toBe(3);

    expect(getSupplierTotalPurchased(supplierId)).toBe(360);

    expect(getSupplierBalance(supplierId)).toBe(300);

    expect(
      (getVariantByBarcode('PURCHASE001') as PurchaseVariantTestRow).buy_price,
    ).toBe(120);

    const editedCostState = getVariantCostState('PURCHASE001');

    expect(Number(editedCostState.average_cost)).toBe(120);

    expect(Number(editedCostState.inventory_value)).toBe(360);
  });

  it('recalculates weighted average when correcting a purchase cost', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct(10);

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 10,

          unit_cost: 200,
        },
      ],
    });

    expect(getVariantCostState('PURCHASE001')).toMatchObject({
      buy_price: 200,
      average_cost: 150,
      inventory_value: 3000,
    });

    updatePurchaseInvoice({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      reason: 'Correct purchase cost',

      supplier_id: supplierId,

      sub_total: 2200,

      discount_type: 'amount',

      discount_input: 0,

      discount_value: 0,

      paid_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 10,

          unit_cost: 220,
        },
      ],
    });

    const costState = getVariantCostState('PURCHASE001');

    expect(Number(costState.buy_price)).toBe(220);

    expect(Number(costState.average_cost)).toBe(160);

    expect(Number(costState.inventory_value)).toBe(3200);
  });

  it('removes purchase returns at their purchase cost and restores the same value on cancellation', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct(10);

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 10,

          unit_cost: 200,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: Number(invoice.items[0].id),

          quantity: 2,
        },
      ],
    });

    let state = getVariantCostState('PURCHASE001');

    /*
     * قبل المرتجع:
     * 10×100 + 10×200 = 3000
     *
     * رجعنا للمورد:
     * 2×200 = 400
     */
    expect(Number(state.stock)).toBe(18);

    expect(Number(state.inventory_value)).toBe(2600);

    expect(Number(state.average_cost)).toBe(144.44);

    cancelPurchaseReturn({
      return_id: purchaseReturn.return_id,

      reason: 'Undo return',

      actor_id: 1,
    });

    state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(20);

    expect(Number(state.inventory_value)).toBe(3000);

    expect(Number(state.average_cost)).toBe(150);
  });

  it('corrects a purchase after part of its stock was sold without changing historical sale cost', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 10,

          unit_cost: 100,
        },
      ],
    });

    /*
     * نحاكي إن 5 قطع خرجت
     * بالفعل بتكلفتها التاريخية.
     */
    const db = getDb();

    db.prepare(
      `
    INSERT INTO stock_movements (
      variant_id,
      type,
      quantity,
      unit_cost,
      cost_value,
      reference_id,
      reference_type,
      notes
    )

    VALUES (
      ?,
      'out',
      5,
      100,
      500,
      NULL,
      'test_sale_snapshot',
      'Test historical sale'
    )
    `,
    ).run(variant.variant_id);

    db.prepare(
      `
    UPDATE product_variants

    SET
      average_cost = 100,
      inventory_value = 500

    WHERE id = ?
    `,
    ).run(variant.variant_id);

    updatePurchaseInvoice({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      reason: 'Correct historical purchase price',

      supplier_id: supplierId,

      sub_total: 1200,

      discount_type: 'amount',

      discount_input: 0,

      discount_value: 0,

      paid_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 10,

          unit_cost: 120,
        },
      ],
    });

    const state = getVariantCostState('PURCHASE001');

    /*
     * إجمالي تكلفة الشراء الصحيحة = 1200
     * COGS التاريخي المثبت = 500
     *
     * إذن قيمة المخزون الباقي = 700
     * وعدده = 5
     *
     * المتوسط الحالي = 140
     */
    expect(Number(state.stock)).toBe(5);

    expect(Number(state.inventory_value)).toBe(700);

    expect(Number(state.average_cost)).toBe(140);

    expect(Number(state.buy_price)).toBe(120);
  });

  it('blocks purchase edit after supplier payment history exists', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 100,
        },
      ],
    });

    recordSupplierPayment({
      supplier_id: supplierId,

      purchase_id: purchase.purchaseId,

      amount: 100,

      payment_method: 'store_cash',

      actor_id: 1,
    });

    expect(() =>
      updatePurchaseInvoice({
        purchase_id: purchase.purchaseId,

        actor_id: 1,

        reason: 'Should fail',

        supplier_id: supplierId,

        sub_total: 500,

        discount_type: 'amount',

        discount_input: 0,

        discount_value: 0,

        paid_amount: 0,

        payment_method: 'store_cash',

        items: [
          {
            variant_id: variant.variant_id,

            quantity: 5,

            unit_cost: 100,
          },
        ],
      }),
    ).toThrow('سجل دفعات مورد لاحقة');
  });

  it('cancels purchase return and restores stock supplier debt and invoice state', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 100,
        },
      ],
    });

    const purchaseReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: Number(
            (getPurchaseInvoice(purchase.purchaseId) as any).items[0].id,
          ),

          quantity: 2,
        },
      ],
    });

    expect(getStockByBarcode('PURCHASE001')).toBe(3);

    expect(getSupplierBalance(supplierId)).toBe(300);

    const cancelled = cancelPurchaseReturn({
      return_id: purchaseReturn.return_id,

      reason: 'Wrong purchase return',

      actor_id: 1,
    });

    expect(cancelled.ok).toBe(true);

    expect(getStockByBarcode('PURCHASE001')).toBe(5);

    expect(getSupplierBalance(supplierId)).toBe(500);

    expect(getSupplierTotalPurchased(supplierId)).toBe(500);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.remaining_amount)).toBe(500);

    expect(invoice.purchase.payment_status).toBe('unpaid');

    expect(Number(invoice.items[0].returned_quantity)).toBe(0);

    expect(Number(invoice.items[0].returnable_quantity)).toBe(5);

    const oldReturn = getPurchaseReturn(purchaseReturn.return_id) as any;

    expect(oldReturn.return.cancelled_at).toBeTruthy();
  });

  it('requires LIFO cancellation for purchase returns', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 100,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseItemId = Number(invoice.items[0].id);

    const firstReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 1,
        },
      ],
    });

    const secondReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 1,
        },
      ],
    });

    expect(() =>
      cancelPurchaseReturn({
        return_id: firstReturn.return_id,

        actor_id: 1,
      }),
    ).toThrow('آخر مرتجع شراء فعال');

    expect(() =>
      cancelPurchaseReturn({
        return_id: secondReturn.return_id,

        actor_id: 1,
      }),
    ).not.toThrow();
  });

  it('updates latest purchase return by cancelling it and creating a replacement', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 100,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseItemId = Number(invoice.items[0].id);

    const firstReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 1,
        },
      ],
    });

    const updated = updatePurchaseReturn({
      return_id: firstReturn.return_id,

      actor_id: 1,

      reason: 'Correct quantity',

      refund_mode: 'credit',

      notes: 'Corrected return',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 2,
        },
      ],
    });

    expect(updated.edited).toBe(true);

    expect(updated.return_id).not.toBe(firstReturn.return_id);

    const oldReturn = getPurchaseReturn(firstReturn.return_id) as any;

    expect(oldReturn.return.cancelled_at).toBeTruthy();

    expect(Number(oldReturn.return.replacement_return_id)).toBe(
      updated.return_id,
    );

    const currentInvoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(currentInvoice.items[0].returned_quantity)).toBe(2);

    expect(Number(currentInvoice.items[0].returnable_quantity)).toBe(3);

    expect(getStockByBarcode('PURCHASE001')).toBe(3);

    expect(getSupplierBalance(supplierId)).toBe(300);
  });

  it('blocks purchase edit even when its return history was cancelled', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 100,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: Number(invoice.items[0].id),

          quantity: 1,
        },
      ],
    });

    cancelPurchaseReturn({
      return_id: purchaseReturn.return_id,

      actor_id: 1,
    });

    expect(() =>
      updatePurchaseInvoice({
        purchase_id: purchase.purchaseId,

        actor_id: 1,

        reason: 'Should remain blocked',

        supplier_id: supplierId,

        sub_total: 200,

        discount_type: 'amount',

        discount_input: 0,

        discount_value: 0,

        paid_amount: 0,

        payment_method: 'store_cash',

        items: [
          {
            variant_id: variant.variant_id,

            quantity: 2,

            unit_cost: 100,
          },
        ],
      }),
    ).toThrow('سجل مرتجعات شراء سابق');
  });

  it('rejects duplicate variants in a purchase invoice', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: supplierId,

        paid_amount: 0,

        actor_id: 1,

        items: [
          {
            variant_id: variant.variant_id,

            quantity: 1,

            unit_cost: 100,
          },
          {
            variant_id: variant.variant_id,

            quantity: 1,

            unit_cost: 100,
          },
        ],
      }),
    ).toThrow('صنف مكرر');
  });

  it('rejects duplicate variants when editing a purchase invoice and keeps original state', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 100,
        },
      ],
    });

    const before = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(getStockByBarcode('PURCHASE001')).toBe(2);

    expect(getSupplierBalance(supplierId)).toBe(200);

    expect(() =>
      updatePurchaseInvoice({
        purchase_id: purchase.purchaseId,

        actor_id: 1,

        reason: 'Reject duplicate purchase lines',

        supplier_id: supplierId,

        sub_total: 300,

        discount_type: 'amount',

        discount_input: 0,

        discount_value: 0,

        paid_amount: 0,

        payment_method: 'store_cash',

        notes: 'Should not be saved',

        items: [
          {
            variant_id: variant.variant_id,

            quantity: 1,

            unit_cost: 150,
          },
          {
            variant_id: variant.variant_id,

            quantity: 1,

            unit_cost: 150,
          },
        ],
      }),
    ).toThrow('يوجد صنف مكرر أو غير صحيح داخل الفاتورة');

    const after = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(after.purchase.id).toBe(before.purchase.id);

    expect(after.purchase.created_at).toBe(before.purchase.created_at);

    expect(Number(after.purchase.total_amount)).toBe(200);

    expect(Number(after.purchase.paid_amount)).toBe(0);

    expect(Number(after.purchase.remaining_amount)).toBe(200);

    expect(after.purchase.payment_status).toBe('unpaid');

    expect(after.items).toHaveLength(1);

    expect(Number(after.items[0].quantity)).toBe(2);

    expect(Number(after.items[0].unit_cost)).toBe(100);

    expect(getStockByBarcode('PURCHASE001')).toBe(2);

    expect(getSupplierBalance(supplierId)).toBe(200);

    expect(getSupplierTotalPurchased(supplierId)).toBe(200);

    const costState = getVariantCostState('PURCHASE001');

    expect(Number(costState.buy_price)).toBe(100);

    expect(Number(costState.average_cost)).toBe(100);

    expect(Number(costState.inventory_value)).toBe(200);
  });

  it('rejects duplicate lines in the same purchase return', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      paid_amount: 0,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 100,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const itemId = Number(invoice.items[0].id);

    expect(() =>
      createPurchaseReturn({
        purchase_id: purchase.purchaseId,

        actor_id: 1,

        refund_mode: 'credit',

        items: [
          {
            purchase_item_id: itemId,

            quantity: 4,
          },
          {
            purchase_item_id: itemId,

            quantity: 4,
          },
        ],
      }),
    ).toThrow('مكرر');

    expect(getStockByBarcode('PURCHASE001')).toBe(5);
  });

  it('includes supplier aging in the statement', () => {
    const db = getDb();

    const supplierId = createTestSupplier();

    const insertPurchase = db.prepare(
      `
        INSERT INTO purchase_invoices (
          supplier_id,

          total_amount,

          remaining_amount,

          payment_status,

          business_date
        )

        VALUES (
          ?,
          ?,
          ?,
          'unpaid',
          date(
            'now',
            'localtime',
            ?
          )
        )
        `,
    );

    insertPurchase.run(supplierId, 150, 150, '-5 days');

    insertPurchase.run(supplierId, 250, 250, '-45 days');

    insertPurchase.run(supplierId, 350, 350, '-75 days');

    insertPurchase.run(supplierId, 450, 450, '-120 days');

    db.prepare(
      `
      UPDATE suppliers

      SET balance = 1200

      WHERE id = ?
      `,
    ).run(supplierId);

    const statement = getSupplierStatement(supplierId, 1) as any;

    expect(statement.summary.aging).toEqual({
      days_0_30: 150,

      days_31_60: 250,

      days_61_90: 350,

      days_90_plus: 450,

      total: 1200,
    });

    expect(statement.summary.balance).toBe(1200);
  });

  it('snapshots supplier credit terms into purchase due date', () => {
    const db = getDb();

    const variant = seedPurchaseProduct();

    const supplierId = createTestSupplier();

    db.prepare(
      `
      UPDATE suppliers

      SET credit_days = 45

      WHERE id = ?
      `,
    ).run(supplierId);

    const purchase = createPurchaseInvoice({
      actor_id: 1,

      supplier_id: supplierId,

      paid_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 100,
        },
      ],
    });

    const saved = db
      .prepare(
        `
        SELECT
          business_date,
          due_date

        FROM purchase_invoices

        WHERE id = ?
        `,
      )
      .get(purchase.purchaseId) as {
      business_date: string;
      due_date: string | null;
    };

    const expected = db
      .prepare(
        `
        SELECT
          date(
            ?,
            '+45 days'
          ) AS due_date
        `,
      )
      .get(saved.business_date) as {
      due_date: string;
    };

    expect(purchase.due_date).toBe(expected.due_date);

    expect(saved.due_date).toBe(expected.due_date);

    db.prepare(
      `
      UPDATE suppliers

      SET credit_days = 10

      WHERE id = ?
      `,
    ).run(supplierId);

    const edited = updatePurchaseInvoice({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      reason: 'Verify due date snapshot',

      supplier_id: supplierId,

      paid_amount: 0,

      sub_total: 100,

      discount_type: 'amount',

      discount_input: 0,

      discount_value: 0,

      payment_method: 'cash',

      notes: null,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 100,
        },
      ],
    });

    expect(edited.due_date).toBe(expected.due_date);

    const afterEdit = db
      .prepare(
        `
        SELECT due_date

        FROM purchase_invoices

        WHERE id = ?
        `,
      )
      .get(purchase.purchaseId) as {
      due_date: string | null;
    };

    expect(afterEdit.due_date).toBe(expected.due_date);
  });

  it('includes supplier due summary in statement', () => {
    const db = getDb();

    const supplierId = createTestSupplier();

    db.prepare(
      `
      INSERT INTO purchase_invoices (
        supplier_id,
        total_amount,
        remaining_amount,
        payment_status,
        business_date,
        due_date
      )

      VALUES (
        ?,
        250,
        250,
        'unpaid',
        date(
          'now',
          'localtime'
        ),
        date(
          'now',
          'localtime',
          '-2 days'
        )
      )
      `,
    ).run(supplierId);

    db.prepare(
      `
      UPDATE suppliers

      SET balance = 250

      WHERE id = ?
      `,
    ).run(supplierId);

    const statement = getSupplierStatement(supplierId, 1) as any;

    expect(statement.summary.due.overdue).toBe(250);

    expect(statement.summary.due.total_open).toBe(250);
  });

  it('uses group pricing as the source of truth and keeps invoice discount at cent precision', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      sub_total: 1090.83,

      discount_type: 'percent',

      discount_input: 10,

      discount_value: 109.08,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 7,

          /*
           * للعرض فقط.
           */
          unit_cost: 155.83,

          /*
           * الحقيقة:
           * 12 قطعة = 1870
           */
          pricing_base_quantity: 12,

          pricing_base_amount: 1870,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.sub_total)).toBe(1090.83);

    expect(Number(invoice.purchase.exact_total_amount)).toBe(981.75);

    expect(Number(invoice.purchase.total_amount)).toBe(981.75);

    expect(Number(invoice.purchase.rounding_adjustment)).toBe(0);

    expect(Number(invoice.items[0].pricing_base_quantity)).toBe(12);

    expect(Number(invoice.items[0].pricing_base_amount)).toBe(1870);

    /*
     * قيمة البند الحقيقية
     * بعد خصم الفاتورة.
     */
    expect(Number(invoice.items[0].line_total)).toBe(981.75);

    /*
     * متوسط الوحدة المعروض.
     */
    expect(Number(invoice.items[0].unit_cost)).toBe(140.25);

    const state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(7);

    expect(Number(state.inventory_value)).toBe(981.75);

    expect(Number(state.average_cost)).toBe(140.25);

    expect(Number(state.buy_price)).toBe(140.25);

    /*
     * الرصيد على المورد
     * يظل بالقيمة المحاسبية الدقيقة.
     */
    expect(getSupplierBalance(supplierId)).toBe(981.75);
  });

  it('allocates group-priced purchase returns cumulatively without losing cents', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 12,

          unit_cost: 155.83,

          pricing_base_quantity: 12,

          pricing_base_amount: 1870,
        },
      ],
    });

    expect(purchase.exact_total_amount).toBe(1870);

    expect(purchase.total_amount).toBe(1870);

    let invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseItemId = Number(invoice.items[0].id);

    expect(Number(invoice.items[0].line_total)).toBe(1870);

    let state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(12);

    expect(Number(state.inventory_value)).toBe(1870);

    const firstReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 7,
        },
      ],
    });

    expect(firstReturn.exact_total_amount).toBe(1090.83);

    expect(firstReturn.total_amount).toBe(1090.83);

    expect(firstReturn.rounding_adjustment).toBe(0);

    state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(5);

    expect(Number(state.inventory_value)).toBe(779.17);

    const secondReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 4,
        },
      ],
    });

    expect(secondReturn.exact_total_amount).toBe(623.34);

    expect(secondReturn.total_amount).toBe(623.34);

    expect(secondReturn.rounding_adjustment).toBe(0);

    state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(1);

    expect(Number(state.inventory_value)).toBe(155.83);

    const finalReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'credit',

      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 1,
        },
      ],
    });

    expect(finalReturn.exact_total_amount).toBe(155.83);

    expect(finalReturn.total_amount).toBe(155.83);

    expect(finalReturn.rounding_adjustment).toBe(0);

    expect(
      Number(
        (
          firstReturn.exact_total_amount +
          secondReturn.exact_total_amount +
          finalReturn.exact_total_amount
        ).toFixed(2),
      ),
    ).toBe(1870);

    state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(0);

    expect(Number(state.inventory_value)).toBe(0);

    expect(getSupplierBalance(supplierId)).toBe(0);

    expect(getSupplierTotalPurchased(supplierId)).toBe(0);

    invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.remaining_amount)).toBe(0);

    expect(Number(invoice.items[0].returned_quantity)).toBe(12);
  });

  it('rounds supplier cash refund independently and restores exact inventory value on cancellation', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 1870,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 12,

          unit_cost: 155.83,

          pricing_base_quantity: 12,

          pricing_base_amount: 1870,
        },
      ],
    });

    expect(purchase.exact_total_amount).toBe(1870);

    expect(purchase.total_amount).toBe(1870);

    expect(purchase.remaining_amount).toBe(0);

    expect(getSupplierBalance(supplierId)).toBe(0);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    const purchaseItemId = Number(invoice.items[0].id);

    const purchaseReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,

      actor_id: 1,

      refund_mode: 'cash',

      refund_payment_method: 'store_cash',
      cash_refund_amount: 156,

      settle_cash_refund: true,
      items: [
        {
          purchase_item_id: purchaseItemId,

          quantity: 1,
        },
      ],
    });

    /*
     * القيمة الحقيقية للمخزون = 155.83
     *
     * لكن المورد سيرد فعليًا = 156
     */
    expect(purchaseReturn.exact_total_amount).toBe(155.83);

    /*
     * قيمة المرتجع المحاسبية لا تتغير.
     */
    expect(purchaseReturn.total_amount).toBe(155.83);

    expect(purchaseReturn.rounding_adjustment).toBe(0.17);

    expect(purchaseReturn.debt_reduction_amount).toBe(0);

    expect(purchaseReturn.cash_refund_amount).toBe(156);

    let state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(11);

    expect(Number(state.inventory_value)).toBe(1714.17);

    cancelPurchaseReturn({
      return_id: purchaseReturn.return_id,

      reason: 'Restore exact group-priced return cost',

      actor_id: 1,
    });

    state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(12);

    expect(Number(state.inventory_value)).toBe(1870);

    expect(getSupplierBalance(supplierId)).toBe(0);

    const restoredInvoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(restoredInvoice.items[0].returned_quantity)).toBe(0);

    expect(Number(restoredInvoice.purchase.remaining_amount)).toBe(0);
  });

  it('preserves the exact purchase total when raw unit cost has more than two decimals', () => {
    const supplierId = createTestSupplier();

    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 12,

          unit_cost: 155.8333333333,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(Number(invoice.purchase.sub_total)).toBe(1870);

    expect(Number(invoice.purchase.exact_total_amount)).toBe(1870);

    expect(Number(invoice.purchase.total_amount)).toBe(1870);

    expect(Number(invoice.items[0].unit_cost)).toBe(155.83);

    expect(Number(invoice.items[0].line_total)).toBe(1870);

    const state = getVariantCostState('PURCHASE001');

    expect(Number(state.stock)).toBe(12);

    expect(Number(state.inventory_value)).toBe(1870);

    expect(Number(state.average_cost)).toBe(155.83);
  });
});
