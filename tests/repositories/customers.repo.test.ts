import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode
} from '../../src/main/database/repositories/product.repo';
import { createSale, getSaleReceipt } from '../../src/main/database/repositories/sales.repo';
import {
  adjustCustomerPoints,
  createCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomerHistory,
  getCustomers,
  getCustomerStatement,
  recordCustomerPayment,
  searchCustomers,
  updateCustomer
} from '../../src/main/database/repositories/customers.repo';

type CustomerTestRow = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  points_balance: number;
  total_spent: number;
  balance: number;
  is_active: number;
  sales_count: number;
  last_sale_at: string | null;
};

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
    name: 'Customer Sale Product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'CUSTOMER001',
        size: 'M',
        color: 'Black',
        buy_price: 100,
        sell_price: 150,
        min_stock: 5,
        opening_qty: 20
      }
    ]
  });

  const variant = getVariantByBarcode('CUSTOMER001') as SaleVariantTestRow | undefined;

  if (!variant) {
    throw new Error('Failed to seed customer test product variant');
  }

  return variant;
}

function createTestCustomer(phone = '01000000000') {
  return createCustomer({
    name: 'Test Customer',
    phone,
    email: 'customer@test.com',
    address: 'Cairo',
    notes: 'Test notes'
  }) as CustomerTestRow;
}

function createPartialSale(customerId: number, paid = 100) {
  const variant = seedProduct();

  return createSale({
    user_id: 1,
    customer_id: customerId,
    sub_total: 300,
    discount_value: 0,
    grand_total: 300,
    change_amount: 0,
    payment_method: 'cash',
    paid,
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

function getCustomerPaymentsCount(customerId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM customer_payments
      WHERE customer_id = ?
      `
    )
    .get(customerId) as { count: number };

  return Number(row.count || 0);
}

describe('customers repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('creates a customer', () => {
    const customer = createCustomer({
      name: '  Ahmed Ali  ',
      phone: ' 01012345678 ',
      email: ' ahmed@test.com ',
      address: ' Cairo ',
      notes: ' VIP '
    }) as CustomerTestRow;

    expect(customer.id).toBeGreaterThan(0);
    expect(customer.name).toBe('Ahmed Ali');
    expect(customer.phone).toBe('01012345678');
    expect(customer.email).toBe('ahmed@test.com');
    expect(customer.address).toBe('Cairo');
    expect(customer.notes).toBe('VIP');
    expect(customer.is_active).toBe(1);
  });

  it('rejects empty customer name', () => {
    expect(() =>
      createCustomer({
        name: '   ',
        phone: '01011111111'
      })
    ).toThrow('اسم العميل مطلوب');
  });

  it('rejects duplicate customer phone', () => {
    createCustomer({
      name: 'First Customer',
      phone: '01022222222'
    });

    expect(() =>
      createCustomer({
        name: 'Second Customer',
        phone: '01022222222'
      })
    ).toThrow();
  });

  it('lists active customers only', () => {
    const customer1 = createCustomer({
      name: 'Active Customer',
      phone: '01033333333'
    }) as CustomerTestRow;

    const customer2 = createCustomer({
      name: 'Deleted Customer',
      phone: '01044444444'
    }) as CustomerTestRow;

    deleteCustomer(customer2.id);

    const customers = getCustomers() as CustomerTestRow[];

    expect(customers.some((customer) => customer.id === customer1.id)).toBe(true);
    expect(customers.some((customer) => customer.id === customer2.id)).toBe(false);
  });

  it('searches customers by name phone and email', () => {
    createCustomer({
      name: 'Mohamed Search',
      phone: '01055555555',
      email: 'search@test.com'
    });

    expect(searchCustomers('Mohamed') as CustomerTestRow[]).toHaveLength(1);
    expect(searchCustomers('010555') as CustomerTestRow[]).toHaveLength(1);
    expect(searchCustomers('search@test') as CustomerTestRow[]).toHaveLength(1);
  });

  it('updates a customer', () => {
    const customer = createTestCustomer();

    const updated = updateCustomer({
      id: customer.id,
      name: 'Updated Customer',
      phone: '01066666666',
      email: 'updated@test.com',
      address: 'Alex',
      notes: 'Updated notes'
    }) as CustomerTestRow;

    expect(updated.id).toBe(customer.id);
    expect(updated.name).toBe('Updated Customer');
    expect(updated.phone).toBe('01066666666');
    expect(updated.email).toBe('updated@test.com');
    expect(updated.address).toBe('Alex');
    expect(updated.notes).toBe('Updated notes');
  });

  it('rejects updating customer with empty name', () => {
    const customer = createTestCustomer();

    expect(() =>
      updateCustomer({
        id: customer.id,
        name: '   ',
        phone: customer.phone
      })
    ).toThrow('اسم العميل مطلوب');
  });

  it('soft deletes a customer', () => {
    const customer = createTestCustomer();

    const result = deleteCustomer(customer.id);

    expect(result.ok).toBe(true);

    const deleted = getCustomerById(customer.id) as CustomerTestRow;
    expect(deleted.is_active).toBe(0);

    const customers = getCustomers() as CustomerTestRow[];
    expect(customers.some((item) => item.id === customer.id)).toBe(false);
  });

  it('adjusts customer loyalty points', () => {
    const customer = createTestCustomer();

    const updated = adjustCustomerPoints({
      customer_id: customer.id,
      points: 10,
      notes: 'Manual points adjustment'
    }) as CustomerTestRow;

    expect(updated.points_balance).toBe(10);

    const history = getCustomerHistory(customer.id) as any;

    expect(history.customer.id).toBe(customer.id);
    expect(history.loyalty).toHaveLength(1);
    expect(history.loyalty[0].type).toBe('adjust');
    expect(history.loyalty[0].points).toBe(10);
  });

  it('rejects points adjustment with zero points', () => {
    const customer = createTestCustomer();

    expect(() =>
      adjustCustomerPoints({
        customer_id: customer.id,
        points: 0
      })
    ).toThrow('عدد النقاط مطلوب');
  });

  it('records customer payment for a specific sale and reduces balance', () => {
    const customer = createTestCustomer();
    const sale = createPartialSale(customer.id, 100);

    expect(sale.remaining_amount).toBe(200);

    const beforePaymentCustomer = getCustomerById(customer.id) as CustomerTestRow;
    expect(beforePaymentCustomer.balance).toBe(200);
    expect(getCashMovementTotal('in')).toBe(100);

    const payment = recordCustomerPayment({
      customer_id: customer.id,
      sale_id: sale.saleId,
      amount: 150,
      payment_method: 'cash',
      notes: 'Payment on specific sale'
    });

    expect(payment.ok).toBe(true);
    expect(payment.paid_amount).toBe(150);
    expect(payment.allocations).toHaveLength(1);
    expect(payment.allocations[0].sale_id).toBe(sale.saleId);
    expect(payment.allocations[0].amount).toBe(150);

    const afterPaymentCustomer = getCustomerById(customer.id) as CustomerTestRow;
    expect(afterPaymentCustomer.balance).toBe(50);

    const receipt = getSaleReceipt(sale.saleId) as any;
    expect(receipt.sale.paid).toBe(250);
    expect(receipt.sale.remaining_amount).toBe(50);
    expect(receipt.sale.payment_status).toBe('partial');

    expect(getCustomerPaymentsCount(customer.id)).toBe(1);
    expect(getCashMovementTotal('in')).toBe(250);
  });

  it('caps customer payment to sale remaining amount', () => {
    const customer = createTestCustomer();
    const sale = createPartialSale(customer.id, 100);

    const payment = recordCustomerPayment({
      customer_id: customer.id,
      sale_id: sale.saleId,
      amount: 500,
      payment_method: 'cash'
    });

    expect(payment.ok).toBe(true);
    expect(payment.paid_amount).toBe(200);

    const updatedCustomer = getCustomerById(customer.id) as CustomerTestRow;
    expect(updatedCustomer.balance).toBe(0);

    const receipt = getSaleReceipt(sale.saleId) as any;
    expect(receipt.sale.paid).toBe(300);
    expect(receipt.sale.remaining_amount).toBe(0);
    expect(receipt.sale.payment_status).toBe('paid');
  });

  it('records general customer payment and allocates to oldest open sales', () => {
    const customer = createTestCustomer();
    const firstSale = createPartialSale(customer.id, 100);

    const variant = getVariantByBarcode('CUSTOMER001') as SaleVariantTestRow;

    const secondSale = createSale({
      user_id: 1,
      customer_id: customer.id,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
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
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    const customerBeforePayment = getCustomerById(customer.id) as CustomerTestRow;
    expect(customerBeforePayment.balance).toBe(500);

    const payment = recordCustomerPayment({
      customer_id: customer.id,
      amount: 350,
      payment_method: 'cash',
      notes: 'General customer payment'
    });

    expect(payment.ok).toBe(true);
    expect(payment.paid_amount).toBe(350);
    expect(payment.allocations).toHaveLength(2);
    expect(payment.allocations[0]).toEqual({
      sale_id: firstSale.saleId,
      amount: 200
    });
    expect(payment.allocations[1]).toEqual({
      sale_id: secondSale.saleId,
      amount: 150
    });

    const firstReceipt = getSaleReceipt(firstSale.saleId) as any;
    const secondReceipt = getSaleReceipt(secondSale.saleId) as any;

    expect(firstReceipt.sale.remaining_amount).toBe(0);
    expect(firstReceipt.sale.payment_status).toBe('paid');

    expect(secondReceipt.sale.remaining_amount).toBe(150);
    expect(secondReceipt.sale.payment_status).toBe('partial');

    const customerAfterPayment = getCustomerById(customer.id) as CustomerTestRow;
    expect(customerAfterPayment.balance).toBe(150);
  });

  it('rejects customer payment with invalid amount', () => {
    const customer = createTestCustomer();

    expect(() =>
      recordCustomerPayment({
        customer_id: customer.id,
        amount: 0,
        payment_method: 'cash'
      })
    ).toThrow();
  });

  it('rejects customer payment for missing customer', () => {
    expect(() =>
      recordCustomerPayment({
        customer_id: 999999,
        amount: 100,
        payment_method: 'cash'
      })
    ).toThrow('العميل غير موجود');
  });

  it('rejects customer payment when customer has no balance', () => {
    const customer = createTestCustomer();

    expect(() =>
      recordCustomerPayment({
        customer_id: customer.id,
        amount: 100,
        payment_method: 'cash'
      })
    ).toThrow('لا يوجد رصيد مستحق على العميل');
  });

  it('returns customer statement summary', () => {
    const customer = createTestCustomer();
    const sale = createPartialSale(customer.id, 100);

    recordCustomerPayment({
      customer_id: customer.id,
      sale_id: sale.saleId,
      amount: 50,
      payment_method: 'cash'
    });

    const statement = getCustomerStatement(customer.id) as any;

    expect(statement.customer.id).toBe(customer.id);
    expect(statement.sales).toHaveLength(1);
    expect(statement.payments).toHaveLength(1);
    expect(statement.entries.length).toBeGreaterThanOrEqual(3);
    expect(statement.summary.total_sales).toBe(300);
    expect(statement.summary.total_paid).toBe(150);
    expect(statement.summary.balance).toBe(150);
    expect(statement.summary.open_sales).toBe(1);
  });
});