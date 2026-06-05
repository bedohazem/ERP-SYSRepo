import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import { createProduct, getVariantByBarcode } from '../../src/main/database/repositories/product.repo';
import {
  createSale,
  createSaleReturn,
  getSaleReceipt
} from '../../src/main/database/repositories/sales.repo';

type SaleVariantTestRow = {
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

function seedProduct() {
  createProduct({
    name: 'Sales Test Product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'SALE001',
        size: 'M',
        color: 'Black',
        buy_price: 100,
        sell_price: 150,
        min_stock: 5,
        opening_qty: 10
      }
    ]
  });

  const variant = getVariantByBarcode('SALE001') as SaleVariantTestRow | undefined;

  if (!variant) {
    throw new Error('Failed to seed test product variant');
  }

  return variant;
}

function getCashMovementCount() {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM cash_movements`).get() as {
    count: number;
  };

  return row.count;
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

  return row.total;
}

function createTestCustomer() {
  const db = getDb();

  const result = db
    .prepare(
      `
      INSERT INTO customers (name, phone, email, address, notes)
      VALUES (?, ?, ?, ?, ?)
      `
    )
    .run('Test Customer', '01000000000', null, null, null);

  return Number(result.lastInsertRowid);
}

function getCustomerBalance(customerId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(customerId) as { balance: number };

  return Number(row.balance || 0);
}

function getCustomerPoints(customerId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT points_balance
      FROM customers
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(customerId) as { points_balance: number };

  return Number(row.points_balance || 0);
}

function getLoyaltyTransactionsCount(customerId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM loyalty_transactions
      WHERE customer_id = ?
      `
    )
    .get(customerId) as { count: number };

  return Number(row.count || 0);
}

function setCustomerPoints(customerId: number, points: number) {
  const db = getDb();

  db.prepare(
    `
    UPDATE customers
    SET points_balance = ?
    WHERE id = ?
    `
  ).run(points, customerId);
}

function getStockByBarcode(barcode: string) {
  const variant = getVariantByBarcode(barcode) as SaleVariantTestRow | undefined;

  if (!variant) {
    throw new Error(`Variant not found for barcode: ${barcode}`);
  }

  return Number(variant.stock || 0);
}

describe('sales repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('rejects missing user_id', () => {
    const variant = seedProduct();

    expect(() =>
      createSale({
        user_id: 0,
        customer_id: null,
        sub_total: 150,
        discount_value: 0,
        grand_total: 150,
        change_amount: 0,
        payment_method: 'cash',
        paid: 150,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 1,
            unit_price: 150
          }
        ]
      })
    ).toThrow('User ID is required');
  });

  it('rejects sale without items', () => {
    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 0,
        discount_value: 0,
        grand_total: 0,
        change_amount: 0,
        payment_method: 'cash',
        paid: 0,
        items: []
      })
    ).toThrow('Sale items are required');
  });

  it('rejects item quantity less than or equal zero', () => {
    const variant = seedProduct();

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 0,
        discount_value: 0,
        grand_total: 0,
        change_amount: 0,
        payment_method: 'cash',
        paid: 0,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 0,
            unit_price: 150
          }
        ]
      })
    ).toThrow('كمية غير صحيحة');
  });

  it('rejects sale quantity greater than available stock', () => {
    const variant = seedProduct();

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 1650,
        discount_value: 0,
        grand_total: 1650,
        change_amount: 0,
        payment_method: 'cash',
        paid: 1650,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 11,
            unit_price: 150
          }
        ]
      })
    ).toThrow('المخزون غير كافي');
  });

  it('creates a fully paid cash sale', () => {
    const variant = seedProduct();

    const result = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(result.saleId).toBeGreaterThan(0);
    expect(result.grand_total).toBe(300);
    expect(result.paid_amount).toBe(300);
    expect(result.remaining_amount).toBe(0);
    expect(result.payment_status).toBe('paid');

    const receipt = getSaleReceipt(result.saleId) as any;

    expect(receipt.sale.id).toBe(result.saleId);
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0].quantity).toBe(2);
    expect(receipt.items[0].line_total).toBe(300);
  });

  it('decreases stock after sale', () => {
    const variant = seedProduct();

    createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    const updatedVariant = getVariantByBarcode('SALE001') as SaleVariantTestRow | undefined;

    expect(updatedVariant?.stock).toBe(8);
  });

  it('creates cash movement for paid sale amount', () => {
    const variant = seedProduct();

    expect(getCashMovementCount()).toBe(0);

    createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(getCashMovementCount()).toBe(1);
    expect(getCashMovementTotal('in')).toBe(300);
  });

  it('rejects credit sale without customer', () => {
    const variant = seedProduct();

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: null,
        sub_total: 300,
        discount_value: 0,
        grand_total: 300,
        change_amount: 0,
        payment_method: 'cash',
        paid: 100,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 2,
            unit_price: 150
          }
        ]
      })
    ).toThrow('لا يمكن البيع آجل بدون اختيار عميل');
  });

  it('creates a partial sale with customer and increases customer balance', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    const result = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 100,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(result.saleId).toBeGreaterThan(0);
    expect(result.grand_total).toBe(300);
    expect(result.paid_amount).toBe(100);
    expect(result.remaining_amount).toBe(200);
    expect(result.payment_status).toBe('partial');

    expect(getCustomerBalance(customerId)).toBe(200);
    expect(getCashMovementTotal('in')).toBe(100);
  });

  it('caps paid amount to grand total when customer pays more than total', () => {
    const variant = seedProduct();

    const result = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 200,
      payment_method: 'cash',
      paid: 500,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(result.grand_total).toBe(300);
    expect(result.paid_amount).toBe(300);
    expect(result.remaining_amount).toBe(0);
    expect(result.payment_status).toBe('paid');

    expect(getCashMovementTotal('in')).toBe(300);

    const receipt = getSaleReceipt(result.saleId) as any;

    expect(receipt.sale.paid).toBe(300);
    expect(receipt.sale.change_amount).toBe(200);
  });

  it('calculates grand total from subtotal and discount value', () => {
    const variant = seedProduct();

    const result = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 50,
      grand_total: 9999,
      change_amount: 0,
      payment_method: 'cash',
      paid: 250,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(result.grand_total).toBe(250);
    expect(result.paid_amount).toBe(250);
    expect(result.remaining_amount).toBe(0);
    expect(result.payment_status).toBe('paid');

    const receipt = getSaleReceipt(result.saleId) as any;

    expect(receipt.sale.sub_total).toBe(300);
    expect(receipt.sale.discount_value).toBe(50);
    expect(receipt.sale.grand_total).toBe(250);
  });

  it('earns loyalty points for customer sale', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    const result = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(result.loyalty_points_earned).toBe(3);
    expect(result.loyalty_points_redeemed).toBe(0);
    expect(result.loyalty_discount_value).toBe(0);

    expect(getCustomerPoints(customerId)).toBe(3);
    expect(getLoyaltyTransactionsCount(customerId)).toBe(1);
  });

  it('redeems loyalty points and applies loyalty discount', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    setCustomerPoints(customerId, 10);

    const result = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 295,
      loyalty_points_redeemed: 5,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(result.loyalty_points_redeemed).toBe(5);
    expect(result.loyalty_discount_value).toBe(5);
    expect(result.grand_total).toBe(295);
    expect(result.paid_amount).toBe(295);
    expect(result.remaining_amount).toBe(0);
    expect(result.payment_status).toBe('paid');

    expect(result.loyalty_points_earned).toBe(2);
    expect(getCustomerPoints(customerId)).toBe(7);
    expect(getLoyaltyTransactionsCount(customerId)).toBe(2);

    const receipt = getSaleReceipt(result.saleId) as any;

    expect(receipt.sale.loyalty_points_redeemed).toBe(5);
    expect(receipt.sale.loyalty_discount_value).toBe(5);
    expect(receipt.sale.grand_total).toBe(295);
  });

  it('rejects redeeming more loyalty points than customer balance', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    setCustomerPoints(customerId, 3);

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: customerId,
        sub_total: 300,
        discount_value: 0,
        grand_total: 300,
        change_amount: 0,
        payment_method: 'cash',
        paid: 300,
        loyalty_points_redeemed: 5,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 2,
            unit_price: 150
          }
        ]
      })
    ).toThrow('رصيد نقاط العميل غير كافي');

    expect(getCustomerPoints(customerId)).toBe(3);
  });

  it('rejects redeeming loyalty points for missing customer', () => {
    const variant = seedProduct();

    expect(() =>
      createSale({
        user_id: 1,
        customer_id: 999999,
        sub_total: 300,
        discount_value: 0,
        grand_total: 300,
        change_amount: 0,
        payment_method: 'cash',
        paid: 300,
        loyalty_points_redeemed: 1,
        items: [
          {
            variant_id: variant.variant_id,
            product_name: variant.product_name,
            barcode: variant.barcode,
            size: variant.size,
            color: variant.color,
            quantity: 2,
            unit_price: 150
          }
        ]
      })
    ).toThrow('العميل غير موجود');
  });

  it('creates a sale return for a fully paid sale and restores stock with cash refund', () => {
    const variant = seedProduct();

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(getStockByBarcode('SALE001')).toBe(8);
    expect(getCashMovementTotal('in')).toBe(300);

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Customer returned one item',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1
        }
      ]
    });

    expect(saleReturn.returnId).toBeGreaterThan(0);
    expect(saleReturn.return_value).toBe(150);
    expect(saleReturn.refundAmount).toBe(150);
    expect(saleReturn.debt_reduction_amount).toBe(0);

    expect(getStockByBarcode('SALE001')).toBe(9);
    expect(getCashMovementTotal('out')).toBe(150);
  });

  it('reduces customer debt before cash refund when returning from partial sale', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 100,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(sale.remaining_amount).toBe(200);
    expect(sale.payment_status).toBe('partial');
    expect(getCustomerBalance(customerId)).toBe(200);
    expect(getStockByBarcode('SALE001')).toBe(8);
    expect(getCashMovementTotal('in')).toBe(100);
    expect(getCashMovementTotal('out')).toBe(0);

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return from partial sale',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1
        }
      ]
    });

    expect(saleReturn.return_value).toBe(150);
    expect(saleReturn.debt_reduction_amount).toBe(150);
    expect(saleReturn.refundAmount).toBe(0);

    expect(getCustomerBalance(customerId)).toBe(50);
    expect(getStockByBarcode('SALE001')).toBe(9);
    expect(getCashMovementTotal('out')).toBe(0);

    const updatedReceipt = getSaleReceipt(sale.saleId) as any;

    expect(updatedReceipt.sale.remaining_amount).toBe(50);
    expect(updatedReceipt.sale.payment_status).toBe('partial');
  });
  
  it('reduces full customer debt then refunds remaining cash on return', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 200,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(sale.remaining_amount).toBe(100);
    expect(sale.payment_status).toBe('partial');
    expect(getCustomerBalance(customerId)).toBe(100);
    expect(getCashMovementTotal('in')).toBe(200);
    expect(getCashMovementTotal('out')).toBe(0);

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return exceeds remaining debt',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1
        }
      ]
    });

    expect(saleReturn.return_value).toBe(150);
    expect(saleReturn.debt_reduction_amount).toBe(100);
    expect(saleReturn.refundAmount).toBe(50);

    expect(getCustomerBalance(customerId)).toBe(0);
    expect(getStockByBarcode('SALE001')).toBe(9);
    expect(getCashMovementTotal('out')).toBe(50);

    const updatedReceipt = getSaleReceipt(sale.saleId) as any;

    expect(updatedReceipt.sale.remaining_amount).toBe(0);
    expect(updatedReceipt.sale.payment_status).toBe('paid');
  });

  it('rejects returning quantity greater than sold quantity', () => {
    const variant = seedProduct();

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    expect(() =>
      createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        reason: 'Invalid return quantity',
        items: [
          {
            sale_item_id: saleItemId,
            variant_id: variant.variant_id,
            quantity: 3
          }
        ]
      })
    ).toThrow('الكمية المطلوبة أكبر من المتاح للمرتجع');

    expect(getStockByBarcode('SALE001')).toBe(8);
    expect(getCashMovementTotal('out')).toBe(0);
  });

  it('rejects returning more than remaining returnable quantity after previous return', () => {
    const variant = seedProduct();

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    const firstReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'First return',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1
        }
      ]
    });

    expect(firstReturn.return_value).toBe(150);
    expect(getStockByBarcode('SALE001')).toBe(9);
    expect(getCashMovementTotal('out')).toBe(150);

    expect(() =>
      createSaleReturn({
        original_sale_id: sale.saleId,
        user_id: 1,
        reason: 'Second invalid return',
        items: [
          {
            sale_item_id: saleItemId,
            variant_id: variant.variant_id,
            quantity: 2
          }
        ]
      })
    ).toThrow('الكمية المطلوبة أكبر من المتاح للمرتجع');

    expect(getStockByBarcode('SALE001')).toBe(9);
    expect(getCashMovementTotal('out')).toBe(150);
  });

  it('calculates sale return value proportionally when original sale has discount', () => {
    const variant = seedProduct();

    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 300,
      discount_value: 60,
      grand_total: 9999,
      change_amount: 0,
      payment_method: 'cash',
      paid: 240,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(sale.grand_total).toBe(240);
    expect(getCashMovementTotal('in')).toBe(240);

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return with discount',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1
        }
      ]
    });

    expect(saleReturn.return_value).toBe(120);
    expect(saleReturn.refundAmount).toBe(120);
    expect(saleReturn.debt_reduction_amount).toBe(0);

    expect(getCashMovementTotal('out')).toBe(120);
    expect(getStockByBarcode('SALE001')).toBe(9);
  });

  it('calculates sale return value proportionally when original sale has loyalty discount', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    setCustomerPoints(customerId, 10);

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 9999,
      change_amount: 0,
      payment_method: 'cash',
      paid: 294,
      loyalty_points_redeemed: 6,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(sale.grand_total).toBe(294);
    expect(sale.loyalty_points_redeemed).toBe(6);
    expect(sale.loyalty_discount_value).toBe(6);
    expect(getCashMovementTotal('in')).toBe(294);

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return with loyalty discount',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1
        }
      ]
    });

    expect(saleReturn.return_value).toBe(147);
    expect(saleReturn.refundAmount).toBe(147);
    expect(saleReturn.debt_reduction_amount).toBe(0);

    expect(getCashMovementTotal('out')).toBe(147);
    expect(getStockByBarcode('SALE001')).toBe(9);
  }); 
  
  it('reverses earned loyalty points proportionally on sale return', () => {
    const variant = seedProduct();
    const customerId = createTestCustomer();

    const sale = createSale({
      user_id: 1,
      customer_id: customerId,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'cash',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(sale.loyalty_points_earned).toBe(3);
    expect(getCustomerPoints(customerId)).toBe(3);

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Return should reverse points',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1
        }
      ]
    });

    expect(saleReturn.return_value).toBe(150);
    expect(saleReturn.loyalty_points_reversed).toBe(1);

    expect(getCustomerPoints(customerId)).toBe(2);
  });  


});