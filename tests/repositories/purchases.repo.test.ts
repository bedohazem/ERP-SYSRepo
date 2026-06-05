import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode
} from '../../src/main/database/repositories/product.repo';
import {
  createPurchaseInvoice,
  getPurchaseInvoice,
  recordSupplierPayment,
  getSupplierStatement
} from '../../src/main/database/repositories/purchases.repo';

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
        opening_qty: openingQty
      }
    ]
  });

  const variant = getVariantByBarcode('PURCHASE001') as PurchaseVariantTestRow | undefined;

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
      `
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
      `
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
      `
    )
    .get(supplierId) as { total_purchased: number };

  return Number(row.total_purchased || 0);
}

function getCashMovementTotal(direction: 'in' | 'out') {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT IFNULL(SUM(amount), 0) AS total
      FROM cash_movements
      WHERE direction = ?
      `
    )
    .get(direction) as { total: number };

  return Number(row.total || 0);
}

function getStockByBarcode(barcode: string) {
  const variant = getVariantByBarcode(barcode) as PurchaseVariantTestRow | undefined;

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
      `
    )
    .get(supplierId) as { count: number };

  return Number(row.count || 0);
}

describe('purchases repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('rejects missing supplier_id', () => {
    const variant = seedPurchaseProduct();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: 0,
        paid_amount: 0,
        items: [
          {
            variant_id: variant.variant_id,
            quantity: 1,
            unit_cost: 100
          }
        ]
      })
    ).toThrow('اختار المورد');
  });

  it('rejects purchase without items', () => {
    const supplierId = createTestSupplier();

    expect(() =>
      createPurchaseInvoice({
        supplier_id: supplierId,
        paid_amount: 0,
        items: []
      })
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
            unit_cost: 100
          }
        ]
      })
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
            unit_cost: 100
          }
        ]
      })
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
            unit_cost: 0
          }
        ]
      })
    ).toThrow('سعر شراء غير صحيح');
  });

  it('creates a fully paid purchase and increases stock', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    expect(getStockByBarcode('PURCHASE001')).toBe(0);

    const result = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 500,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100
        }
      ]
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

  it('creates a partial purchase and increases supplier balance', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const result = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 200,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100
        }
      ]
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
          unit_cost: 100
        }
      ]
    });

    expect(result.total_amount).toBe(500);
    expect(result.paid_amount).toBe(0);
    expect(result.remaining_amount).toBe(500);
    expect(result.payment_status).toBe('unpaid');

    expect(getStockByBarcode('PURCHASE001')).toBe(5);
    expect(getSupplierBalance(supplierId)).toBe(500);
    expect(getCashMovementTotal('out')).toBe(0);
  });

  it('caps paid amount to total amount', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const result = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 700,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100
        }
      ]
    });

    expect(result.total_amount).toBe(500);
    expect(result.paid_amount).toBe(500);
    expect(result.remaining_amount).toBe(0);
    expect(result.payment_status).toBe('paid');
    expect(getCashMovementTotal('out')).toBe(500);
  });

  it('updates variant buy price to last purchase unit cost', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 0,
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 2,
          unit_cost: 130
        }
      ]
    });

    const updatedVariant = getVariantByBarcode('PURCHASE001') as PurchaseVariantTestRow;

    expect(updatedVariant.buy_price).toBe(130);
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
          unit_cost: 100
        }
      ]
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
      notes: 'Partial supplier payment'
    });

    expect(payment.ok).toBe(true);

    expect(getSupplierBalance(supplierId)).toBe(300);
    expect(getCashMovementTotal('out')).toBe(200);
    expect(getSupplierPaymentsCount(supplierId)).toBe(1);

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].amount).toBe(200);
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
          unit_cost: 100
        }
      ]
    });

    expect(getSupplierBalance(supplierId)).toBe(500);

    const payment = recordSupplierPayment({
      supplier_id: supplierId,
      purchase_id: purchase.purchaseId,
      amount: 500,
      payment_method: 'cash',
      notes: 'Full supplier payment'
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
        payment_method: 'cash'
      })
    ).toThrow();
  });

  it('rejects supplier payment for missing supplier', () => {
    expect(() =>
      recordSupplierPayment({
        supplier_id: 999999,
        amount: 100,
        payment_method: 'cash'
      })
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
          unit_cost: 100
        }
      ]
    });

    expect(getSupplierBalance(supplierId)).toBe(500);

    expect(() =>
      recordSupplierPayment({
        supplier_id: supplierId,
        amount: 700,
        payment_method: 'cash'
      })
    ).toThrow('قيمة الدفع أكبر من رصيد المورد');

    expect(getSupplierBalance(supplierId)).toBe(500);
    expect(getCashMovementTotal('out')).toBe(0);
  });

  it('returns supplier statement with purchases and payments', () => {
    const supplierId = createTestSupplier();
    const variant = seedPurchaseProduct();

    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      paid_amount: 100,
      payment_method: 'cash',
      items: [
        {
          variant_id: variant.variant_id,
          quantity: 5,
          unit_cost: 100
        }
      ]
    });

    recordSupplierPayment({
      supplier_id: supplierId,
      purchase_id: purchase.purchaseId,
      amount: 200,
      payment_method: 'cash',
      notes: 'Second payment'
    });

    const statement = getSupplierStatement(supplierId) as any;

    expect(statement.supplier.id).toBe(supplierId);
    expect(statement.purchases.length).toBeGreaterThanOrEqual(1);
    expect(statement.payments.length).toBeGreaterThanOrEqual(2);
    expect(getSupplierBalance(supplierId)).toBe(200);
  });
  
});