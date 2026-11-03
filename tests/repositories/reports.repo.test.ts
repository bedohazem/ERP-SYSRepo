import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import { getLocalBusinessDate } from '../../src/main/database/system-clock-guard';
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  cancelSaleInvoice,
  createSale,
  createSaleReturn,
  getSaleReceipt,
  updateSaleInvoice,
} from '../../src/main/database/repositories/sales.repo';
import {
  cancelExpense,
  createExpense,
  updateExpense,
} from '../../src/main/database/repositories/expense.repo';
import {
  createLiability,
  recordLiabilityPayment,
} from '../../src/main/database/repositories/liabilities.repo';
import {
  getAdminCashFlowAlerts,
  getCashierDashboardSummary,
  getReportsSummary,
  getAdminDashboardTodaySummary,
} from '../../src/main/database/repositories/reports.repo';

import {
  createPurchaseInvoice,
  createPurchaseReturn,
  getPurchaseInvoice,
} from '../../src/main/database/repositories/purchases.repo';

import { createSupplier } from '../../src/main/database/repositories/suppliers.repo';

import { createCashMovement } from '../../src/main/database/repositories/cash.repo';
import {
  closeCashShift,
  getCashShiftDetails,
  getOpenCashShift,
  openCashShift,
  listCashShiftVariances,
  resolveCashShiftVariance,
} from '../../src/main/database/repositories/cash-shifts.repo';
import { createUser } from '../../src/main/database/repositories/user.repo';
import {
  createSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo';
import {
  cancelCustomerPaymentBatch,
  recordCustomerPayment,
  updateCustomerPaymentBatch,
} from '../../src/main/database/repositories/customers.repo';

type ReportVariantTestRow = {
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

type CustomerTestRow = {
  id: number;
  name: string;
  phone: string | null;
};

type ReportPaymentMethodRow = {
  payment_method: string;
  count: number;
  total: number;
};

type ReportTopProductRow = {
  variant_id: number;
  product_name: string;
  size: string;
  color: string;
  net_quantity: number;
  net_total: number;
};

type ReportTopCustomerRow = {
  id: number;
  name: string;
  phone: string | null;
  sales_count: number;
  total_spent: number;
};

type ReportDailySaleRow = {
  day: string;
  total: number;
};

type ReportLowStockRow = {
  variant_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  min_stock: number;
  stock: number;
};

type ReportsSummaryTestResult = {
  summary: {
    sales_count: number;
    returns_count: number;
    gross_sales: number;
    total_returns: number;
    normal_discounts: number;
    loyalty_discounts: number;
    total_discounts: number;
    net_sales: number;
    gross_profit_before_discounts: number;
    net_profit_after_discounts: number;
    total_expenses: number;
    total_liability_payments: number;
    total_purchase_invoices: number;
    total_purchase_exact_amount: number;
    purchase_rounding_increase: number;
    purchase_rounding_decrease: number;
    purchase_rounding_net: number;
    total_manual_deposits: number;
    total_manual_withdrawals: number;
    final_net_profit: number;
    approved_opening_surplus: number;
    approved_opening_shortage: number;
    exchange_count: number;
    exchange_adjustment: number;
  };
  cashAccounts: Array<{
    payment_method: string;
    label: string;
    total_in: number;
    total_out: number;
    balance: number;
  }>;

  cashAccountsTotalBalance: number;
  cashierSales: Array<{
    user_id: number | null;

    cashier_name: string;

    sales_count: number;
    sales_total: number;

    returns_count: number;
    returns_total: number;

    exchange_count: number;

    exchange_adjustment: number;

    net_sales: number;
  }>;

  salespersonSales: Array<{
    salesperson_id: number | null;

    salesperson_name: string;

    sales_count: number;
    sales_total: number;

    returns_count: number;
    returns_total: number;

    exchange_count: number;
    exchange_adjustment: number;

    net_sales: number;
  }>;
  topProducts: ReportTopProductRow[];
  dailySales: ReportDailySaleRow[];
  paymentMethods: ReportPaymentMethodRow[];
  lowStock: ReportLowStockRow[];
  topCustomers: ReportTopCustomerRow[];
};

function seedReportProduct(options?: {
  name?: string;
  barcode?: string;
  openingQty?: number;
  minStock?: number;
  buyPrice?: number;
  sellPrice?: number;
}) {
  const barcode = options?.barcode ?? 'REPORT001';

  createProduct({
    name: options?.name ?? 'Report Product',
    category_id: null,
    image_path: null,
    description: null,
    variants: [
      {
        barcode,
        size: 'M',
        color: 'Black',
        buy_price: options?.buyPrice ?? 100,
        sell_price: options?.sellPrice ?? 150,
        min_stock: options?.minStock ?? 5,
        opening_qty: options?.openingQty ?? 20,
      },
    ],
  });

  const variant = getVariantByBarcode(barcode) as
    ReportVariantTestRow | undefined;

  if (!variant) {
    throw new Error(`Failed to seed report product: ${barcode}`);
  }

  return variant;
}

function createTestCustomer(name = 'Report Customer', phone = '01000000000') {
  const db = getDb();

  const result = db
    .prepare(
      `
      INSERT INTO customers (name, phone)
      VALUES (?, ?)
      `,
    )
    .run(name, phone);

  return {
    id: Number(result.lastInsertRowid),
    name,
    phone,
  } as CustomerTestRow;
}

describe('reports repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();

    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    });
  }, 30_000);

  it('builds admin cash-flow alerts from customer and supplier due dates', () => {
    const db = getDb();

    const customer = createTestCustomer('Cash Flow Customer', '01055559991');

    const supplier = createSupplier({
      name: 'Cash Flow Supplier',
      phone: '01155559991',
    }) as any;

    const dueDate = (modifier: string | null) => {
      if (modifier === null) {
        return null;
      }

      const row = db
        .prepare(
          `
          SELECT
            date(
              'now',
              'localtime',
              ?
            ) AS value
          `,
        )
        .get(modifier) as {
        value: string;
      };

      return row.value;
    };

    const insertSale = db.prepare(
      `
      INSERT INTO sales (
        type,
        customer_id,
        user_id,
        business_date,
        due_date,
        sub_total,
        grand_total,
        paid,
        remaining_amount,
        payment_status,
        payment_method
      )

      VALUES (
        'sale',
        ?,
        1,
        date(
          'now',
          'localtime'
        ),
        ?,
        ?,
        ?,
        0,
        ?,
        'unpaid',
        'store_cash'
      )
      `,
    );

    insertSale.run(customer.id, dueDate('-1 day'), 100, 100, 100);

    insertSale.run(customer.id, dueDate('+0 days'), 200, 200, 200);

    insertSale.run(customer.id, dueDate('+5 days'), 300, 300, 300);

    insertSale.run(customer.id, dueDate('+15 days'), 400, 400, 400);

    insertSale.run(customer.id, null, 500, 500, 500);

    const insertPurchase = db.prepare(
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
        ?,
        ?,
        'unpaid',
        date(
          'now',
          'localtime'
        ),
        ?
      )
      `,
    );

    insertPurchase.run(supplier.id, 80, 80, dueDate('-1 day'));

    insertPurchase.run(supplier.id, 90, 90, dueDate('+0 days'));

    insertPurchase.run(supplier.id, 110, 110, dueDate('+5 days'));

    insertPurchase.run(supplier.id, 130, 130, dueDate('+15 days'));

    insertPurchase.run(supplier.id, 120, 120, null);

    const alerts = getAdminCashFlowAlerts();

    expect(alerts.customers).toEqual({
      overdue: 100,
      due_today: 200,
      due_soon: 300,
      without_due_date: 500,
      total_open: 1500,
    });

    expect(alerts.suppliers).toEqual({
      overdue: 80,
      due_today: 90,
      due_soon: 110,
      without_due_date: 120,
      total_open: 530,
    });

    expect(alerts.near_term).toEqual({
      customer_receivables: 500,
      supplier_payables: 200,
      net: 300,
    });
  });

  it('returns empty summary when there is no business data', () => {
    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.sales_count).toBe(0);
    expect(report.summary.returns_count).toBe(0);
    expect(report.summary.gross_sales).toBe(0);
    expect(report.summary.total_returns).toBe(0);
    expect(report.summary.net_sales).toBe(0);
    expect(report.summary.gross_profit_before_discounts).toBe(0);
    expect(report.summary.net_profit_after_discounts).toBe(0);
    expect(report.summary.total_expenses).toBe(0);
    expect(report.summary.total_liability_payments).toBe(0);
    expect(report.summary.total_purchase_invoices).toBe(0);
    expect(report.cashierSales).toHaveLength(0);
    expect(report.summary.total_manual_deposits).toBe(0);

    expect(report.summary.total_manual_withdrawals).toBe(0);
    expect(report.summary.final_net_profit).toBe(0);

    expect(report.topProducts).toHaveLength(0);
    expect(report.dailySales).toHaveLength(0);
    expect(report.paymentMethods).toHaveLength(0);
    expect(report.topCustomers).toHaveLength(0);
  });

  it('separates store safe balance and reports total financial account balances', () => {
    createCashMovement({
      type: 'deposit',

      direction: 'in',

      amount: 100,

      payment_method: 'store_cash',

      reference_type: 'manual',

      created_by: 1,
    });

    createCashMovement({
      type: 'deposit',

      direction: 'in',

      amount: 250,

      payment_method: 'store_safe',

      reference_type: 'manual',

      created_by: 1,
    });

    createCashMovement({
      type: 'deposit',

      direction: 'in',

      amount: 300,

      payment_method: 'owner_bank',

      reference_type: 'manual',

      created_by: 1,
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    const storeCash = report.cashAccounts.find(
      (row) => row.payment_method === 'store_cash',
    );

    const storeSafe = report.cashAccounts.find(
      (row) => row.payment_method === 'store_safe',
    );

    const ownerBank = report.cashAccounts.find(
      (row) => row.payment_method === 'owner_bank',
    );

    expect(storeCash).toBeTruthy();

    expect(Number(storeCash?.balance)).toBe(100);

    expect(storeSafe).toBeTruthy();

    expect(storeSafe?.label).toBe('الخزنة الآمنة');

    expect(Number(storeSafe?.balance)).toBe(250);

    expect(ownerBank).toBeTruthy();

    expect(Number(ownerBank?.balance)).toBe(300);

    expect(report.cashAccountsTotalBalance).toBe(650);

    expect('cashTotalCapital' in report).toBe(false);
  });

  it('calculates sales profit discounts expenses and liability payments', () => {
    const variant = seedReportProduct({
      name: 'Report Shirt',
      barcode: 'REPORT-SHIRT',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150,
    });

    const customer = createTestCustomer();

    createSale({
      user_id: 1,
      customer_id: customer.id,
      sub_total: 300,
      discount_value: 20,
      grand_total: 280,
      change_amount: 0,
      payment_method: 'cash',
      paid: 280,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    });

    createExpense({
      title: 'Report Expense',
      amount: 30,
      payment_method: 'cash',
      created_by: 1,
    });

    const liability = createLiability({
      party_name: 'Report Party',
      title: 'Report Liability',
      total_amount: 100,
      paid_amount: 0,
      actor_id: 1,
    });

    recordLiabilityPayment({
      liability_id: liability.liability_id,
      amount: 40,
      payment_method: 'cash',
      actor_id: 1,
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.sales_count).toBe(1);
    expect(report.summary.returns_count).toBe(0);

    expect(report.summary.gross_sales).toBe(280);
    expect(report.summary.normal_discounts).toBe(20);
    expect(report.summary.loyalty_discounts).toBe(0);
    expect(report.summary.total_discounts).toBe(20);
    expect(report.summary.total_returns).toBe(0);
    expect(report.summary.net_sales).toBe(280);

    expect(report.summary.gross_profit_before_discounts).toBe(100);
    expect(report.summary.net_profit_after_discounts).toBe(80);

    expect(report.summary.total_expenses).toBe(30);
    expect(report.summary.total_liability_payments).toBe(40);
    expect(report.summary.final_net_profit).toBe(50);

    expect(report.paymentMethods).toHaveLength(1);
    expect(report.paymentMethods[0].payment_method).toBe('cash');
    expect(report.paymentMethods[0].count).toBe(1);
    expect(report.paymentMethods[0].total).toBe(280);

    expect(report.topProducts).toHaveLength(1);
    expect(report.topProducts[0].product_name).toBe('Report Shirt');
    expect(report.topProducts[0].net_quantity).toBe(2);
    expect(report.topProducts[0].net_total).toBe(300);

    expect(report.topCustomers).toHaveLength(1);
    expect(report.topCustomers[0].id).toBe(customer.id);
    expect(report.topCustomers[0].name).toBe('Report Customer');
    expect(report.topCustomers[0].sales_count).toBe(1);
    expect(report.topCustomers[0].total_spent).toBe(280);

    expect(report.dailySales.length).toBeGreaterThanOrEqual(1);
    expect(report.dailySales[0].total).toBe(280);
  });

  it('reports actual collections including later customer payments', () => {
    const variant = seedReportProduct({
      name: 'Collections Product',

      barcode: 'REPORT-COLLECTIONS',

      openingQty: 20,

      buyPrice: 100,

      sellPrice: 150,
    });

    const customer = createTestCustomer('Collections Customer', '01077779991');

    const sale = createSale({
      user_id: 1,

      customer_id: customer.id,

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

          unit_price: 150,
        },
      ],
    });

    recordCustomerPayment({
      customer_id: customer.id,

      sale_id: sale.saleId,

      amount: 200,

      payment_method: 'card',

      actor_id: 1,
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    const cash = report.paymentMethods.find(
      (row) => row.payment_method === 'cash',
    );

    const card = report.paymentMethods.find(
      (row) => row.payment_method === 'card',
    );

    expect(cash).toBeTruthy();
    expect(cash?.count).toBe(1);
    expect(cash?.total).toBe(100);

    expect(card).toBeTruthy();
    expect(card?.count).toBe(1);
    expect(card?.total).toBe(200);
  });

  it('subtracts returns from sales totals top products and customers', () => {
    const variant = seedReportProduct({
      name: 'Return Report Product',
      barcode: 'REPORT-RETURN',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150,
    });

    const customer = createTestCustomer('Return Customer', '01011111111');

    const sale = createSale({
      user_id: 1,
      customer_id: customer.id,
      sub_total: 300,
      discount_value: 0,
      grand_total: 300,
      change_amount: 0,
      payment_method: 'card',
      paid: 300,
      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 2,
          unit_price: 150,
        },
      ],
    });

    const receipt = getSaleReceipt(sale.saleId) as any;
    const saleItemId = receipt.items[0].id;

    createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Report return',
      items: [
        {
          sale_item_id: saleItemId,
          variant_id: variant.variant_id,
          quantity: 1,
        },
      ],
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.sales_count).toBe(1);
    expect(report.summary.returns_count).toBe(1);

    expect(report.summary.gross_sales).toBe(300);
    expect(report.summary.total_returns).toBe(150);
    expect(report.summary.net_sales).toBe(150);

    expect(report.summary.gross_profit_before_discounts).toBe(50);
    expect(report.summary.net_profit_after_discounts).toBe(50);

    expect(report.topProducts).toHaveLength(1);
    expect(report.topProducts[0].product_name).toBe('Return Report Product');
    expect(report.topProducts[0].net_quantity).toBe(1);
    expect(report.topProducts[0].net_total).toBe(150);

    expect(report.topCustomers).toHaveLength(1);
    expect(report.topCustomers[0].name).toBe('Return Customer');
    expect(report.topCustomers[0].sales_count).toBe(1);
    expect(report.topCustomers[0].total_spent).toBe(150);

    expect(report.dailySales.length).toBeGreaterThanOrEqual(1);
    expect(report.dailySales[0].total).toBe(150);
  });

  it('reports low stock items', () => {
    seedReportProduct({
      name: 'Low Stock Report Product',
      barcode: 'REPORT-LOW',
      openingQty: 3,
      minStock: 5,
      buyPrice: 100,
      sellPrice: 150,
    });

    seedReportProduct({
      name: 'Available Stock Report Product',
      barcode: 'REPORT-AVAILABLE',
      openingQty: 20,
      minStock: 5,
      buyPrice: 100,
      sellPrice: 150,
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.lowStock.some((item) => item.barcode === 'REPORT-LOW')).toBe(
      true,
    );
    expect(
      report.lowStock.some((item) => item.barcode === 'REPORT-AVAILABLE'),
    ).toBe(false);
  });

  it('filters reports by date range', () => {
    const variant = seedReportProduct({
      name: 'Date Filter Product',
      barcode: 'REPORT-DATE',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150,
    });

    const reportDate = getLocalBusinessDate();

    createSale({
      user_id: 1,
      business_date: reportDate,
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
          unit_price: 150,
        },
      ],
    });

    const todayReport = getReportsSummary({
      date_from: reportDate,
      date_to: reportDate,
    }) as ReportsSummaryTestResult;

    const futureReport = getReportsSummary({
      date_from: '2099-01-01',
      date_to: '2099-01-31',
    }) as ReportsSummaryTestResult;

    expect(todayReport.summary.sales_count).toBe(1);
    expect(todayReport.summary.gross_sales).toBe(150);

    expect(futureReport.summary.sales_count).toBe(0);
    expect(futureReport.summary.gross_sales).toBe(0);
    expect(futureReport.topProducts).toHaveLength(0);
    expect(futureReport.dailySales).toHaveLength(0);
  });

  it('reports purchase invoices and manual cash movements', () => {
    const variant = seedReportProduct({
      name: 'Purchase Report Product',

      barcode: 'REPORT-PURCHASE',

      openingQty: 0,

      buyPrice: 100,

      sellPrice: 150,
    });

    const supplier = createSupplier({
      name: 'Report Supplier',
    }) as any;

    createPurchaseInvoice({
      supplier_id: supplier.id,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 120,
        },
      ],
    });

    createCashMovement({
      type: 'deposit',

      direction: 'in',

      amount: 500,

      payment_method: 'store_cash',

      reference_type: 'manual',

      notes: 'Manual report deposit',

      created_by: 1,
    });

    createCashMovement({
      type: 'withdraw',

      direction: 'out',

      amount: 120,

      payment_method: 'store_cash',

      reference_type: 'manual',

      notes: 'Manual report withdrawal',

      created_by: 1,
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.total_purchase_invoices).toBe(240);

    expect(report.summary.total_manual_deposits).toBe(500);

    expect(report.summary.total_manual_withdrawals).toBe(120);
  });

  it('groups monthly sales by cashier', () => {
    const variant = seedReportProduct({
      name: 'Cashier Monthly Product',

      barcode: 'CASHIER-MONTHLY',

      openingQty: 50,

      buyPrice: 50,

      sellPrice: 100,
    });

    const secondUser = createUser(
      'Second Cashier',

      'second_cashier_report',

      'Report1234',

      /*
       * Admin هنا فقط لتسهيل
       * تشغيل الـrepository test
       * على نفس الشفت المفتوح.
       */
      'admin',
    );

    const firstSale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 100,
      discount_value: 0,
      grand_total: 100,

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

          quantity: 1,

          unit_price: 100,
        },
      ],
    });

    const secondSale = createSale({
      user_id: secondUser.id,

      customer_id: null,

      sub_total: 200,
      discount_value: 0,
      grand_total: 200,

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

          unit_price: 100,
        },
      ],
    });

    const db = getDb();

    db.prepare(
      `
      UPDATE cash_shifts

      SET
        opened_at = ?,

        business_date = ?

      WHERE id IN (
        SELECT shift_id

        FROM sales

        WHERE id IN (?, ?)
      )
      `,
    ).run(
      '2026-09-05 09:00:00',
      '2026-09-05',
      firstSale.saleId,
      secondSale.saleId,
    );

    const report = getReportsSummary({
      date_from: '2026-09-01',

      date_to: '2026-09-30',
    }) as ReportsSummaryTestResult;

    expect(report.cashierSales).toHaveLength(2);

    const first = report.cashierSales.find((row) => Number(row.user_id) === 1);

    const second = report.cashierSales.find(
      (row) => Number(row.user_id) === Number(secondUser.id),
    );

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    expect(first?.sales_count).toBe(1);

    expect(first?.sales_total).toBe(100);

    expect(first?.net_sales).toBe(100);

    expect(second?.sales_count).toBe(1);

    expect(second?.sales_total).toBe(200);

    expect(second?.net_sales).toBe(200);
  });

  it('merges legacy cashier sales with the linked salesperson row', () => {
    const variant = seedReportProduct({
      name: 'Legacy Seller Merge Product',
      barcode: 'LEGACY-SELLER-MERGE',
      openingQty: 20,
      buyPrice: 50,
      sellPrice: 100,
    });

    const legacySale = createSale({
      user_id: 1,
      customer_id: null,

      sub_total: 100,
      discount_value: 0,
      grand_total: 100,

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
          quantity: 1,
          unit_price: 100,
        },
      ],
    });

    createSale({
      user_id: 1,
      customer_id: null,

      sub_total: 200,
      discount_value: 0,
      grand_total: 200,

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
          unit_price: 100,
        },
      ],
    });

    const db = getDb();

    /*
     * نحول أول فاتورة لشكل البيانات القديمة
     * قبل إضافة نظام البائعين.
     */
    db.prepare(
      `
    UPDATE sales

    SET
      salesperson_id = NULL,
      salesperson_name = NULL

    WHERE id = ?
    `,
    ).run(legacySale.saleId);

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.salespersonSales).toHaveLength(1);

    const seller = report.salespersonSales[0];

    expect(seller.sales_count).toBe(2);
    expect(seller.sales_total).toBe(300);
    expect(seller.net_sales).toBe(300);
  });

  it('removes returned invoice discounts from the active shift dashboard even when another admin creates the return', () => {
    const variant = seedReportProduct({
      name: 'Cashier Discount Return',

      barcode: 'CASHIER-DISCOUNT-RETURN',

      openingQty: 20,

      buyPrice: 100,

      sellPrice: 200,
    });

    /*
     * beforeEach فتح شفت
     * المستخدم 1 بالفعل.
     */
    const sale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 200,

      discount_value: 50,

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

          unit_price: 200,
        },
      ],
    });

    const receipt = getSaleReceipt(sale.saleId) as any;

    /*
     * مستخدم Admin آخر
     * ينفذ المرتجع،
     * لكن العملية نفسها تحدث
     * داخل نفس الشفت المفتوح.
     */
    const secondAdmin = createUser(
      'Return Admin',

      'return_admin',

      'Report1234',

      'admin',
    );

    createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: secondAdmin.id,

      reason: 'Full dashboard return',

      items: [
        {
          sale_item_id: receipt.items[0].id,

          variant_id: variant.variant_id,

          quantity: 1,
        },
      ],
    });

    const dashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboard.sales.invoice_sales).toBe(150);

    expect(dashboard.sales.returns_total).toBe(150);

    expect(dashboard.sales.return_cash_refund).toBe(150);

    expect(dashboard.sales.return_debt_reduction).toBe(0);

    expect(dashboard.sales.net_sales).toBe(0);

    expect(dashboard.discounts.normal).toBe(0);

    expect(dashboard.discounts.total).toBe(0);

    expect(dashboard.sales.returns_count).toBe(1);
  });

  it('separates sale return debt reduction from cash refund on cashier dashboard', () => {
    const returnedVariant = seedReportProduct({
      name: 'Return Debt Product',

      barcode: 'RETURN-DEBT-300',

      openingQty: 10,

      buyPrice: 100,

      sellPrice: 300,
    });

    const keptVariant = seedReportProduct({
      name: 'Return Kept Product',

      barcode: 'RETURN-DEBT-200',

      openingQty: 10,

      buyPrice: 80,

      sellPrice: 200,
    });

    const customer = createTestCustomer(
      'Return Debt Customer',

      '01077778888',
    );

    /*
     * فاتورة 500:
     *
     * المدفوع = 300
     * المديونية = 200
     */
    const sale = createSale({
      user_id: 1,

      customer_id: customer.id,

      sub_total: 500,

      discount_value: 0,

      grand_total: 500,

      paid: 300,

      remaining_amount: 200,

      payment_status: 'partial',

      change_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: returnedVariant.variant_id,

          product_name: returnedVariant.product_name,

          barcode: returnedVariant.barcode,

          size: returnedVariant.size,

          color: returnedVariant.color,

          quantity: 1,

          unit_price: 300,
        },

        {
          variant_id: keptVariant.variant_id,

          product_name: keptVariant.product_name,

          barcode: keptVariant.barcode,

          size: keptVariant.size,

          color: keptVariant.color,

          quantity: 1,

          unit_price: 200,
        },
      ],
    });

    const receipt = getSaleReceipt(sale.saleId) as any;

    const returnedItem = receipt.items.find(
      (item: any) =>
        Number(item.variant_id) === Number(returnedVariant.variant_id),
    );

    expect(returnedItem).toBeTruthy();

    /*
     * نرجع الصنف قيمته 300.
     *
     * النظام لازم:
     * - يلغي المديونية 200 أولًا.
     * - ويرد للعميل كاش 100 فقط.
     */
    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      reason: 'Return with debt reduction',

      refund_payment_method: 'store_cash',

      items: [
        {
          sale_item_id: Number(returnedItem.id),

          variant_id: returnedVariant.variant_id,

          quantity: 1,
        },
      ],
    });

    expect(saleReturn.return_value).toBe(300);

    expect(saleReturn.debt_reduction_amount).toBe(200);

    expect(saleReturn.refundAmount).toBe(100);

    /*
     * الرئيسية لازم تعرض التقسيم
     * بشكل مستقل وواضح.
     */
    const dashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboard.sales.returns_count).toBe(1);

    expect(dashboard.sales.returns_total).toBe(300);

    expect(dashboard.sales.return_debt_reduction).toBe(200);

    expect(dashboard.sales.return_cash_refund).toBe(100);

    /*
     * بعد المرتجع:
     *
     * صافي البيع = 500 - 300 = 200
     * المديونية أصبحت صفر.
     * الصافي المحصل = 200.
     */
    expect(dashboard.sales.outstanding_debt_total).toBe(0);

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(0);

    expect(dashboard.sales.paid_sales_total).toBe(200);

    expect(dashboard.sales.net_sales).toBe(200);

    /*
     * ونتأكد إن الخارج من الدرج
     * هو 100 فقط، مش قيمة المرتجع كلها.
     */
    const db = getDb();

    const returnCashMovement = db
      .prepare(
        `
      SELECT
        amount,
        direction,
        payment_method,
        shift_id

      FROM cash_movements

      WHERE
        type = 'sale_return'

        AND reference_type = 'sale_return'

        AND reference_id = ?

      LIMIT 1
      `,
      )
      .get(saleReturn.returnId) as any;

    expect(returnCashMovement).toBeTruthy();

    expect(returnCashMovement.direction).toBe('out');

    expect(Number(returnCashMovement.amount)).toBe(100);

    expect(returnCashMovement.payment_method).toBe('store_cash');

    expect(Number(returnCashMovement.shift_id)).toBe(
      Number(saleReturn.shift_id),
    );
  });

  it('separates exchange invoice adjustment from cash refund when the sale has debt', () => {
    const oldVariant = seedReportProduct({
      name: 'Old Debt Exchange Product',

      barcode: 'REPORT-EX-DEBT-OLD',

      openingQty: 10,

      buyPrice: 200,

      sellPrice: 450,
    });

    const newVariant = seedReportProduct({
      name: 'New Debt Exchange Product',

      barcode: 'REPORT-EX-DEBT-NEW',

      openingQty: 10,

      buyPrice: 10,

      sellPrice: 20,
    });

    const customer = createTestCustomer(
      'Exchange Debt Customer',

      '01099999999',
    );

    const sale = createSale({
      user_id: 1,

      customer_id: customer.id,

      sub_total: 450,

      discount_value: 0,

      grand_total: 450,

      paid: 200,

      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: oldVariant.variant_id,

          product_name: oldVariant.product_name,

          barcode: oldVariant.barcode,

          size: oldVariant.size,

          color: oldVariant.color,

          quantity: 1,

          unit_price: 450,
        },
      ],
    });

    const state = getSaleExchangeState(sale.saleId);

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    );

    expect(regularGroup).toBeTruthy();

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      items: [
        {
          promotion_unit_id: Number(regularGroup!.units[0].id),

          new_variant_id: newVariant.variant_id,
        },
      ],
    });

    /*
     * قيمة الفاتورة نزلت
     * من 450 إلى 20.
     */
    expect(exchange.difference_amount).toBe(-430);

    /*
     * المديونية القديمة 250
     * يتم إلغاؤها أولًا.
     */
    expect(exchange.debt_reduction_amount).toBe(250);

    /*
     * العميل دفع 200،
     * وأخذ منتج بـ20،
     * إذن الرد النقدي 180.
     */
    expect(exchange.amount_to_refund).toBe(180);

    const db = getDb();

    const today = db
      .prepare(
        `
        SELECT
          date(
            'now',
            'localtime'
          ) AS day
        `,
      )
      .get() as {
      day: string;
    };

    const dashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboard.sales.invoice_sales).toBe(450);

    expect(dashboard.sales.exchange_adjustment).toBe(-430);

    expect(dashboard.sales.exchange_debt_reduction).toBe(250);

    expect(dashboard.sales.exchange_cash_refund).toBe(180);

    expect(dashboard.sales.exchange_cash_difference).toBe(-180);

    expect(dashboard.sales.net_sales).toBe(20);
  });

  it('shows customer payment total and counted shift opening on cashier dashboard', () => {
    const variant = seedReportProduct({
      name: 'Dashboard Payment Product',

      barcode: 'DASH-PAYMENT',

      openingQty: 20,

      buyPrice: 100,

      sellPrice: 500,
    });

    const customer = createTestCustomer(
      'Dashboard Payment Customer',

      '01088888888',
    );

    const sale = createSale({
      user_id: 1,

      customer_id: customer.id,

      sub_total: 500,

      discount_value: 0,

      grand_total: 500,

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

          quantity: 1,

          unit_price: 500,
        },
      ],
    });

    recordCustomerPayment({
      customer_id: customer.id,

      sale_id: sale.saleId,

      amount: 125,

      payment_method: 'cash',

      actor_id: 1,
    });

    const db = getDb();

    db.prepare(
      `
      UPDATE cash_shifts

      SET
        opening_counted_amount =
          350

      WHERE
        status = 'open'

        AND opened_by = 1
      `,
    ).run();

    const today = db
      .prepare(
        `
        SELECT
          date(
            'now',
            'localtime'
          ) AS day
        `,
      )
      .get() as {
      day: string;
    };

    const dashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboard.operations.customer_payments_count).toBe(1);

    expect(dashboard.operations.customer_payments_total).toBe(125);

    expect(dashboard.shift).toBeTruthy();

    expect(dashboard.shift?.opening_counted_amount).toBe(350);

    expect(dashboard.shift?.status).toBe('open');
  });

  it('resets the cashier dashboard when a new shift starts', () => {
    const variant = seedReportProduct({
      name: 'Shift Dashboard Product',

      barcode: 'SHIFT-DASHBOARD',

      openingQty: 20,

      buyPrice: 50,

      sellPrice: 100,
    });

    /*
     * beforeEach فتح بالفعل
     * الشفت الأول للمستخدم 1.
     */
    const firstShift = getOpenCashShift();

    expect(firstShift).toBeTruthy();

    createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 100,

      discount_value: 0,

      grand_total: 100,

      paid: 100,

      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 100,
        },
      ],
    });

    const firstDashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(firstDashboard.shift?.id).toBe(firstShift!.id);

    expect(firstDashboard.sales.invoice_sales).toBe(100);

    closeCashShift({
      shift_id: firstShift!.id,

      closing_counted_amount: 100,
      left_for_next_shift: 0,

      closed_by: 1,
    });

    const secondCashier = createUser(
      'Second Shift Cashier',

      'second_shift_cashier',

      'Report1234',

      /*
       * Admin في التست فقط
       * لتجنب قيود تشغيلية
       * ليست موضوع الاختبار.
       */
      'admin',
    );

    const secondShift = openCashShift({
      opening_counted_amount: 75,

      opened_by: secondCashier.id,
    });

    /*
     * بمجرد فتح شفت جديد:
     * Dashboard تبدأ من صفر.
     */
    const emptySecondDashboard = getCashierDashboardSummary({
      user_id: secondCashier.id,
    });

    expect(emptySecondDashboard.shift?.id).toBe(secondShift.id);

    expect(emptySecondDashboard.shift?.opening_counted_amount).toBe(75);

    expect(emptySecondDashboard.sales.invoice_sales).toBe(0);

    expect(emptySecondDashboard.sales.invoices_count).toBe(0);

    createSale({
      user_id: secondCashier.id,

      customer_id: null,

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

    const secondDashboard = getCashierDashboardSummary({
      user_id: secondCashier.id,
    });

    expect(secondDashboard.shift?.id).toBe(secondShift.id);

    expect(secondDashboard.sales.invoice_sales).toBe(200);

    expect(secondDashboard.sales.invoices_count).toBe(1);

    /*
     * مبيعات الشفت الأول
     * لم تنتقل للشفت الثاني.
     */
    expect(secondDashboard.sales.invoice_sales).not.toBe(300);

    /*
     * صاحب الشفت القديم لا يرى
     * بياناته القديمة في Dashboard
     * بعد انتهاء شفته.
     */
    const oldCashierDashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(oldCashierDashboard.shift).toBeNull();

    expect(oldCashierDashboard.sales.invoice_sales).toBe(0);
  });

  it('shows paid sales and outstanding debt for active shift invoices', () => {
    const variant = seedReportProduct({
      name: 'Shift Credit Sale',

      barcode: 'SHIFT-CREDIT-SALE',

      openingQty: 20,

      buyPrice: 100,

      sellPrice: 300,
    });

    const customer = createTestCustomer(
      'Credit Customer',

      '01077777777',
    );

    const sale = createSale({
      user_id: 1,

      customer_id: customer.id,

      sub_total: 300,

      discount_value: 0,

      grand_total: 300,

      paid: 150,

      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 300,
        },
      ],
    });

    let dashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboard.sales.invoice_sales).toBe(300);

    expect(dashboard.sales.paid_sales_total).toBe(150);

    expect(dashboard.sales.outstanding_debt_total).toBe(150);

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(1);

    /*
     * العميل دفع 50
     * أثناء نفس الشفت.
     */
    recordCustomerPayment({
      customer_id: customer.id,

      sale_id: sale.saleId,

      amount: 50,

      payment_method: 'cash',

      actor_id: 1,
    });

    dashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(dashboard.sales.paid_sales_total).toBe(200);

    expect(dashboard.sales.outstanding_debt_total).toBe(100);

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(1);
  });

  it('attributes admin non-cash and credit sales to the currently open cashier shift', () => {
    const currentShift = getOpenCashShift();

    expect(currentShift).toBeTruthy();

    closeCashShift({
      shift_id: currentShift!.id,

      closing_counted_amount: 0,

      left_for_next_shift: 0,

      closed_by: 1,
    });

    const cashier = createUser(
      'Shift Sales Cashier',

      'shift_sales_cashier',

      'Report1234',

      'cashier',
    );

    const cashierShift = openCashShift({
      opening_counted_amount: 0,

      opened_by: cashier.id,
    });

    const variant = seedReportProduct({
      name: 'Admin Shift Sale Product',

      barcode: 'ADMIN-SHIFT-SALE',

      openingQty: 10,

      buyPrice: 50,

      sellPrice: 300,
    });

    /*
     * الأدمن يبيع بوسيلة غير الكاش
     * أثناء شفت الكاشير.
     */
    const paidSale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 200,

      discount_value: 0,

      grand_total: 200,

      paid: 200,

      remaining_amount: 0,

      payment_status: 'paid',

      change_amount: 0,

      payment_method: 'owner_bank',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 200,
        },
      ],
    });

    expect(paidSale.shift_id).toBe(cashierShift.id);

    const customer = createTestCustomer(
      'Shift Credit Customer',

      '01066666666',
    );

    /*
     * الأدمن يسجل فاتورة آجل
     * أثناء نفس شفت الكاشير.
     */
    const creditSale = createSale({
      user_id: 1,

      customer_id: customer.id,

      sub_total: 300,

      discount_value: 0,

      grand_total: 300,

      paid: 0,

      remaining_amount: 300,

      payment_status: 'unpaid',

      change_amount: 0,

      payment_method: 'owner_bank',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 300,
        },
      ],
    });

    expect(creditSale.shift_id).toBe(cashierShift.id);

    /*
     * الرئيسية الخاصة بصاحب الشفت
     * ترى الفاتورتين حتى لو أنشأهما الأدمن.
     */
    const dashboard = getCashierDashboardSummary({
      user_id: cashier.id,
    });

    expect(dashboard.sales.invoices_count).toBe(2);

    expect(dashboard.sales.invoice_sales).toBe(500);

    expect(dashboard.sales.paid_sales_total).toBe(200);

    expect(dashboard.sales.outstanding_debt_total).toBe(300);

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(1);

    /*
     * تفاصيل الشفت تحتوي أيضًا
     * على فاتورة الآجل رغم عدم وجود
     * حركة نقدية لها.
     */
    const details = getCashShiftDetails(cashierShift.id);

    expect(details.sales).toHaveLength(2);

    expect(details.sales_summary.invoices_count).toBe(2);

    expect(details.sales_summary.invoice_sales).toBe(500);

    expect(details.sales_summary.paid_total).toBe(200);

    expect(details.sales_summary.remaining_total).toBe(300);

    const creditInvoice = details.sales.find(
      (sale: any) => Number(sale.id) === creditSale.saleId,
    );

    expect(creditInvoice).toBeTruthy();

    expect(Number(creditInvoice.remaining_amount)).toBe(300);

    expect(creditInvoice.payment_status).toBe('unpaid');
  });

  it('attributes every admin payment method and credit sale to the open cashier shift', () => {
    const currentShift = getOpenCashShift();

    expect(currentShift).toBeTruthy();

    closeCashShift({
      shift_id: currentShift!.id,

      closing_counted_amount: 0,

      left_for_next_shift: 0,

      closed_by: 1,
    });

    const cashier = createUser(
      'Payment Matrix Cashier',
      'payment_matrix_cashier',
      'Report1234',
      'cashier',
    );

    const shift = openCashShift({
      opening_counted_amount: 0,

      opened_by: cashier.id,
    });

    const variant = seedReportProduct({
      name: 'Payment Matrix Product',

      barcode: 'PAYMENT-MATRIX-PRODUCT',

      openingQty: 50,

      buyPrice: 40,

      sellPrice: 100,
    });

    const customer = createTestCustomer(
      'Payment Matrix Customer',
      '01055554444',
    );

    const paymentMethods = [
      'store_cash',
      'owner_cash',
      'owner_bank',
      'owner_vodafone',
      'fawry_machine',
      'store_safe',
    ];

    const createdSaleIds: number[] = [];

    /*
     * بيع مسدد بالكامل بكل حساب مالي.
     */
    for (const paymentMethod of paymentMethods) {
      const sale = createSale({
        user_id: 1,

        customer_id: null,

        sub_total: 100,

        discount_value: 0,

        grand_total: 100,

        paid: 100,

        remaining_amount: 0,

        payment_status: 'paid',

        change_amount: 0,

        payment_method: paymentMethod,

        items: [
          {
            variant_id: variant.variant_id,

            product_name: variant.product_name,

            barcode: variant.barcode,

            size: variant.size,

            color: variant.color,

            quantity: 1,

            unit_price: 100,
          },
        ],
      });

      expect(sale.shift_id).toBe(shift.id);

      createdSaleIds.push(sale.saleId);
    }

    /*
     * بيع آجل بالكامل بكل حساب مالي.
     *
     * حتى لو المدفوع صفر، الفاتورة نفسها
     * لازم تفضل منسوبة للشفت المفتوح.
     */
    for (const paymentMethod of paymentMethods) {
      const sale = createSale({
        user_id: 1,

        customer_id: customer.id,

        sub_total: 80,

        discount_value: 0,

        grand_total: 80,

        paid: 0,

        remaining_amount: 80,

        payment_status: 'unpaid',

        change_amount: 0,

        payment_method: paymentMethod,

        items: [
          {
            variant_id: variant.variant_id,

            product_name: variant.product_name,

            barcode: variant.barcode,

            size: variant.size,

            color: variant.color,

            quantity: 1,

            unit_price: 80,
          },
        ],
      });

      expect(sale.shift_id).toBe(shift.id);

      createdSaleIds.push(sale.saleId);
    }

    /*
     * دفع متعدد.
     */
    const splitSale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 100,

      discount_value: 0,

      grand_total: 100,

      paid: 100,

      remaining_amount: 0,

      payment_status: 'paid',

      change_amount: 0,

      payment_method: 'split',

      payments: [
        {
          payment_method: 'owner_bank',

          amount: 40,
        },

        {
          payment_method: 'owner_vodafone',

          amount: 60,
        },
      ],

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 100,
        },
      ],
    });

    expect(splitSale.shift_id).toBe(shift.id);

    createdSaleIds.push(splitSale.saleId);

    /*
     * كل الفواتير فعليًا مربوطة
     * بشفت الكاشير رغم أن منفذها الأدمن.
     */
    const db = getDb();

    const storedSales = db
      .prepare(
        `
      SELECT
        id,
        user_id,
        shift_id,
        payment_status,
        payment_method,
        remaining_amount

      FROM sales

      WHERE id IN (
        ${createdSaleIds.map(() => '?').join(', ')}
      )

      ORDER BY id ASC
      `,
      )
      .all(...createdSaleIds) as any[];

    expect(storedSales).toHaveLength(13);

    expect(
      storedSales.every(
        (sale) =>
          Number(sale.user_id) === 1 && Number(sale.shift_id) === shift.id,
      ),
    ).toBe(true);

    const paidInvoices = storedSales.filter(
      (sale) => sale.payment_status === 'paid',
    );

    const unpaidInvoices = storedSales.filter(
      (sale) => sale.payment_status === 'unpaid',
    );

    expect(paidInvoices).toHaveLength(7);

    expect(unpaidInvoices).toHaveLength(6);

    expect(
      unpaidInvoices.every((sale) => Number(sale.remaining_amount) === 80),
    ).toBe(true);

    /*
     * الرئيسية.
     *
     * 6 مسدد × 100 = 600
     * + دفع متعدد = 100
     * + 6 آجل × 80 = 480
     *
     * الإجمالي = 1180
     * المحصل = 700
     * الآجل = 480
     */
    const dashboard = getCashierDashboardSummary({
      user_id: cashier.id,
    });

    expect(dashboard.shift?.id).toBe(shift.id);

    expect(dashboard.sales.invoices_count).toBe(13);

    expect(dashboard.sales.cancelled_invoices_count).toBe(0);

    expect(dashboard.sales.invoice_sales).toBe(1180);

    expect(dashboard.sales.paid_sales_total).toBe(700);

    expect(dashboard.sales.outstanding_debt_total).toBe(480);

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(6);

    expect(dashboard.sales.net_sales).toBe(1180);

    /*
     * تفاصيل الشفت لازم تطابق الرئيسية.
     */
    const details = getCashShiftDetails(shift.id);

    expect(details.sales).toHaveLength(13);

    expect(details.sales_summary.invoices_count).toBe(13);

    expect(details.sales_summary.active_invoices_count).toBe(13);

    expect(details.sales_summary.cancelled_invoices_count).toBe(0);

    expect(details.sales_summary.invoice_sales).toBe(1180);

    expect(details.sales_summary.net_sales).toBe(1180);

    expect(details.sales_summary.paid_total).toBe(700);

    expect(details.sales_summary.remaining_total).toBe(480);

    /*
     * أهم مقارنة مباشرة:
     * الرئيسية = تفاصيل الشفت.
     */
    expect(details.sales_summary.active_invoices_count).toBe(
      dashboard.sales.invoices_count,
    );

    expect(details.sales_summary.invoice_sales).toBe(
      dashboard.sales.invoice_sales,
    );

    expect(details.sales_summary.net_sales).toBe(dashboard.sales.net_sales);

    expect(details.sales_summary.paid_total).toBe(
      dashboard.sales.paid_sales_total,
    );

    expect(details.sales_summary.remaining_total).toBe(
      dashboard.sales.outstanding_debt_total,
    );
  });

  it('keeps cashier and admin full shift workflow consistent between dashboard and shift details', () => {
    const initialShift = getOpenCashShift();

    expect(initialShift).toBeTruthy();

    closeCashShift({
      shift_id: initialShift!.id,
      closing_counted_amount: 0,
      left_for_next_shift: 0,
      closed_by: 1,
    });

    const cashier = createUser(
      'Full Cycle Cashier',
      'full_cycle_cashier',
      'Report1234',
      'cashier',
    );

    const shift = openCashShift({
      opening_counted_amount: 0,
      opened_by: cashier.id,
    });

    const baseVariant = seedReportProduct({
      name: 'Full Cycle Base',
      barcode: 'FULL-CYCLE-BASE',
      openingQty: 100,
      buyPrice: 40,
      sellPrice: 100,
    });

    const samePriceVariant = seedReportProduct({
      name: 'Full Cycle Same Price',
      barcode: 'FULL-CYCLE-SAME',
      openingQty: 30,
      buyPrice: 45,
      sellPrice: 100,
    });

    const plus30Variant = seedReportProduct({
      name: 'Full Cycle Plus 30',
      barcode: 'FULL-CYCLE-PLUS30',
      openingQty: 30,
      buyPrice: 55,
      sellPrice: 130,
    });

    const plus20Variant = seedReportProduct({
      name: 'Full Cycle Plus 20',
      barcode: 'FULL-CYCLE-PLUS20',
      openingQty: 30,
      buyPrice: 50,
      sellPrice: 120,
    });

    const cashierCustomer = createTestCustomer(
      'Full Cycle Cashier Customer',
      '01011112222',
    );

    const adminCustomer = createTestCustomer(
      'Full Cycle Admin Customer',
      '01033334444',
    );

    function createSimpleSale(input: {
      actorId: number;
      quantity?: number;
      customerId?: number | null;
      paid?: number;
    }) {
      const quantity = input.quantity ?? 1;

      const total = quantity * 100;

      const paid = input.paid === undefined ? total : input.paid;

      return createSale({
        user_id: input.actorId,

        customer_id: input.customerId ?? null,

        sub_total: total,

        discount_value: 0,

        grand_total: total,

        paid,

        remaining_amount: total - paid,

        payment_status:
          paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',

        change_amount: 0,

        payment_method: 'store_cash',

        items: [
          {
            variant_id: baseVariant.variant_id,

            product_name: baseVariant.product_name,

            barcode: baseVariant.barcode,

            size: baseVariant.size,

            color: baseVariant.color,

            quantity,

            unit_price: 100,
          },
        ],
      });
    }

    function returnOne(saleId: number, actorId: number) {
      const receipt = getSaleReceipt(saleId) as any;

      return createSaleReturn({
        original_sale_id: saleId,

        user_id: actorId,

        reason: 'Full cycle return',

        refund_payment_method: 'store_cash',

        items: [
          {
            sale_item_id: Number(receipt.items[0].id),

            variant_id: baseVariant.variant_id,

            quantity: 1,
          },
        ],
      });
    }

    function exchangeOne(
      saleId: number,
      actorId: number,
      newVariantId: number,
    ) {
      const state = getSaleExchangeState(saleId);

      const group = state.groups.find(
        (item: any) =>
          item.group_kind === 'regular' &&
          item.units.some((unit: any) => Number(unit.is_returned || 0) === 0),
      );

      expect(group).toBeTruthy();

      const unit = group!.units.find(
        (item: any) => Number(item.is_returned || 0) === 0,
      );

      expect(unit).toBeTruthy();

      return createSaleExchange({
        original_sale_id: saleId,

        user_id: actorId,

        payment_method: 'store_cash',

        reason: 'Full cycle exchange',

        items: [
          {
            promotion_unit_id: Number(unit.id),

            new_variant_id: newVariantId,
          },
        ],
      });
    }

    /*
     * =================================
     * الكاشير
     * =================================
     */

    /*
     * 1) بيع ثم تعديل ثم إلغاء.
     */
    const cashierEditCancelSale = createSimpleSale({
      actorId: cashier.id,
    });

    expect(cashierEditCancelSale.shift_id).toBe(shift.id);

    const updatedCashierSale = updateSaleInvoice({
      sale_id: cashierEditCancelSale.saleId,

      actor_id: cashier.id,

      reason: 'Full cycle cashier edit',

      customer_id: null,

      sub_total: 200,

      discount_value: 0,

      grand_total: 200,

      paid: 200,

      remaining_amount: 0,

      payment_status: 'paid',

      change_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: baseVariant.variant_id,

          product_name: baseVariant.product_name,

          barcode: baseVariant.barcode,

          size: baseVariant.size,

          color: baseVariant.color,

          quantity: 2,

          unit_price: 100,
        },
      ],
    });

    expect(updatedCashierSale.shift_id).toBe(shift.id);

    const cancelledCashierSale = cancelSaleInvoice({
      sale_id: cashierEditCancelSale.saleId,

      reason: 'Full cycle cashier cancel',

      actor_id: cashier.id,
    });

    expect(cancelledCashierSale.cancelled_shift_id).toBe(shift.id);

    /*
     * 2) بيع 200 ومرتجع 100.
     */
    const cashierReturnSale = createSimpleSale({
      actorId: cashier.id,

      quantity: 2,
    });

    const cashierReturn = returnOne(cashierReturnSale.saleId, cashier.id);

    expect(cashierReturn.shift_id).toBe(shift.id);

    /*
     * 3) استبدال بدون فرق.
     */
    const cashierNoDiffSale = createSimpleSale({
      actorId: cashier.id,
    });

    const cashierNoDiffExchange = exchangeOne(
      cashierNoDiffSale.saleId,
      cashier.id,
      samePriceVariant.variant_id,
    );

    expect(cashierNoDiffExchange.shift_id).toBe(shift.id);

    expect(cashierNoDiffExchange.difference_amount).toBe(0);

    /*
     * 4) استبدال بفرق +30.
     */
    const cashierDiffSale = createSimpleSale({
      actorId: cashier.id,
    });

    const cashierDiffExchange = exchangeOne(
      cashierDiffSale.saleId,
      cashier.id,
      plus30Variant.variant_id,
    );

    expect(cashierDiffExchange.shift_id).toBe(shift.id);

    expect(cashierDiffExchange.difference_amount).toBe(30);

    expect(cashierDiffExchange.amount_to_collect).toBe(30);

    /*
     * 5) فاتورة جزئي 300:
     * دفع 100 وقت البيع
     * ثم دفعة 60
     * ثم تعديلها إلى 40
     * ثم إلغاء الـ40.
     *
     * النتيجة النهائية:
     * المدفوع = 100
     * الباقي = 200
     */
    const cashierPaymentSale = createSimpleSale({
      actorId: cashier.id,

      quantity: 3,

      customerId: cashierCustomer.id,

      paid: 100,
    });

    const cashierPayment = recordCustomerPayment({
      customer_id: cashierCustomer.id,

      sale_id: cashierPaymentSale.saleId,

      amount: 60,

      payment_method: 'store_cash',

      actor_id: cashier.id,
    });

    expect(cashierPayment.shift_id).toBe(shift.id);

    const updatedCashierPayment = updateCustomerPaymentBatch({
      batch_id: cashierPayment.payment_batch_id,

      amount: 40,

      payment_method: 'store_cash',

      notes: 'Full cycle cashier payment edit',

      actor_id: cashier.id,
    });

    expect(updatedCashierPayment.shift_id).toBe(shift.id);

    const cancelledCashierPayment = cancelCustomerPaymentBatch({
      batch_id: Number(updatedCashierPayment.batch_id),

      reason: 'Full cycle cashier payment cancel',

      actor_id: cashier.id,
    });

    expect(cancelledCashierPayment.cancelled_shift_id).toBe(shift.id);

    /*
     * 6) مصروف 50
     * تعديل إلى 70
     * ثم إلغاء.
     */
    const cashierExpense = createExpense({
      title: 'Cashier Full Cycle Expense',

      amount: 50,

      payment_method: 'store_cash',

      created_by: cashier.id,
    });

    expect(cashierExpense.shift_id).toBe(shift.id);

    const updatedCashierExpense = updateExpense({
      id: cashierExpense.id,

      title: 'Cashier Full Cycle Expense Updated',

      amount: 70,

      payment_method: 'store_cash',

      actor_id: cashier.id,
    });

    expect(updatedCashierExpense.updated_shift_id).toBe(shift.id);

    const cancelledCashierExpense = cancelExpense({
      id: cashierExpense.id,

      reason: 'Full cycle cashier expense cancel',

      actor_id: cashier.id,
    });

    expect(cancelledCashierExpense.cancelled_shift_id).toBe(shift.id);

    /*
     * =================================
     * الأدمن داخل نفس شفت الكاشير
     * =================================
     */

    /*
     * 7) بيع ثم تعديل ثم إلغاء.
     */
    const adminEditCancelSale = createSimpleSale({
      actorId: 1,
    });

    expect(adminEditCancelSale.shift_id).toBe(shift.id);

    const updatedAdminSale = updateSaleInvoice({
      sale_id: adminEditCancelSale.saleId,

      actor_id: 1,

      reason: 'Full cycle admin edit',

      customer_id: null,

      sub_total: 200,

      discount_value: 0,

      grand_total: 200,

      paid: 200,

      remaining_amount: 0,

      payment_status: 'paid',

      change_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: baseVariant.variant_id,

          product_name: baseVariant.product_name,

          barcode: baseVariant.barcode,

          size: baseVariant.size,

          color: baseVariant.color,

          quantity: 2,

          unit_price: 100,
        },
      ],
    });

    expect(updatedAdminSale.shift_id).toBe(shift.id);

    const cancelledAdminSale = cancelSaleInvoice({
      sale_id: adminEditCancelSale.saleId,

      reason: 'Full cycle admin cancel',

      actor_id: 1,
    });

    expect(cancelledAdminSale.cancelled_shift_id).toBe(shift.id);

    /*
     * 8) بيع أدمن مسدد عادي.
     */
    const adminPaidSale = createSimpleSale({
      actorId: 1,
    });

    expect(adminPaidSale.shift_id).toBe(shift.id);

    /*
     * 9) بيع أدمن آجل بالكامل.
     */
    const adminCreditSale = createSimpleSale({
      actorId: 1,

      quantity: 2,

      customerId: adminCustomer.id,

      paid: 0,
    });

    expect(adminCreditSale.shift_id).toBe(shift.id);

    /*
     * 10) بيع 200 ومرتجع 100.
     */
    const adminReturnSale = createSimpleSale({
      actorId: 1,

      quantity: 2,
    });

    const adminReturn = returnOne(adminReturnSale.saleId, 1);

    expect(adminReturn.shift_id).toBe(shift.id);

    /*
     * 11) استبدال بدون فرق.
     */
    const adminNoDiffSale = createSimpleSale({
      actorId: 1,
    });

    const adminNoDiffExchange = exchangeOne(
      adminNoDiffSale.saleId,
      1,
      samePriceVariant.variant_id,
    );

    expect(adminNoDiffExchange.shift_id).toBe(shift.id);

    expect(adminNoDiffExchange.difference_amount).toBe(0);

    /*
     * 12) استبدال بفرق +20.
     */
    const adminDiffSale = createSimpleSale({
      actorId: 1,
    });

    const adminDiffExchange = exchangeOne(
      adminDiffSale.saleId,
      1,
      plus20Variant.variant_id,
    );

    expect(adminDiffExchange.shift_id).toBe(shift.id);

    expect(adminDiffExchange.difference_amount).toBe(20);

    expect(adminDiffExchange.amount_to_collect).toBe(20);

    /*
     * 13) دفعة عميل للأدمن:
     * فاتورة 300 / دفع أولي 100
     * دفعة 60 -> تعديل 40 -> إلغاء.
     */
    const adminPaymentSale = createSimpleSale({
      actorId: 1,

      quantity: 3,

      customerId: adminCustomer.id,

      paid: 100,
    });

    const adminPayment = recordCustomerPayment({
      customer_id: adminCustomer.id,

      sale_id: adminPaymentSale.saleId,

      amount: 60,

      payment_method: 'store_cash',

      actor_id: 1,
    });

    expect(adminPayment.shift_id).toBe(shift.id);

    const updatedAdminPayment = updateCustomerPaymentBatch({
      batch_id: adminPayment.payment_batch_id,

      amount: 40,

      payment_method: 'store_cash',

      notes: 'Full cycle admin payment edit',

      actor_id: 1,
    });

    expect(updatedAdminPayment.shift_id).toBe(shift.id);

    const cancelledAdminPayment = cancelCustomerPaymentBatch({
      batch_id: Number(updatedAdminPayment.batch_id),

      reason: 'Full cycle admin payment cancel',

      actor_id: 1,
    });

    expect(cancelledAdminPayment.cancelled_shift_id).toBe(shift.id);

    /*
     * 14) مصروف أدمن 80
     * تعديل 90
     * ثم إلغاء.
     */
    const adminExpense = createExpense({
      title: 'Admin Full Cycle Expense',

      amount: 80,

      payment_method: 'store_cash',

      created_by: 1,
    });

    expect(adminExpense.shift_id).toBe(shift.id);

    const updatedAdminExpense = updateExpense({
      id: adminExpense.id,

      title: 'Admin Full Cycle Expense Updated',

      amount: 90,

      payment_method: 'store_cash',

      actor_id: 1,
    });

    expect(updatedAdminExpense.updated_shift_id).toBe(shift.id);

    const cancelledAdminExpense = cancelExpense({
      id: adminExpense.id,

      reason: 'Full cycle admin expense cancel',

      actor_id: 1,
    });

    expect(cancelledAdminExpense.cancelled_shift_id).toBe(shift.id);

    /*
     * =================================
     * النتيجة المتوقعة النهائية
     * =================================
     *
     * الفواتير الفعالة:
     *
     * كاشير:
     * 200 return sale
     * 100 exchange no diff
     * 100 exchange +30
     * 300 partial
     *
     * أدمن:
     * 100 paid
     * 200 credit
     * 200 return sale
     * 100 exchange no diff
     * 100 exchange +20
     * 300 partial
     *
     * = 10 فواتير فعالة
     *
     * الفواتير الملغاة:
     * 2
     *
     * إجمالي الفواتير الأصلية:
     * 1700
     *
     * المرتجعات:
     * 200
     *
     * فرق الاستبدالات:
     * +50
     *
     * صافي المبيعات:
     * 1700 + 50 - 200 = 1550
     *
     * المحصل الحالي:
     * 950
     *
     * المديونية:
     * 600
     */

    const dashboard = getCashierDashboardSummary({
      user_id: cashier.id,
    });

    expect(dashboard.shift?.id).toBe(shift.id);

    expect(dashboard.sales.invoices_count).toBe(10);

    expect(dashboard.sales.cancelled_invoices_count).toBe(2);

    expect(dashboard.sales.invoice_sales).toBe(1700);

    expect(dashboard.sales.returns_count).toBe(2);

    expect(dashboard.sales.returns_total).toBe(200);

    expect(dashboard.sales.exchanges_count).toBe(4);

    expect(dashboard.sales.exchange_adjustment).toBe(50);

    expect(dashboard.sales.exchange_cash_collection).toBe(50);

    expect(dashboard.sales.exchange_cash_refund).toBe(0);

    expect(dashboard.sales.exchange_debt_reduction).toBe(0);

    expect(dashboard.sales.net_sales).toBe(1550);

    expect(dashboard.sales.paid_sales_total).toBe(950);

    expect(dashboard.sales.outstanding_debt_total).toBe(600);

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(3);

    /*
     * دفعات العملاء كلها اتعدلت ثم اتلغت.
     *
     * لكل مستخدم:
     * - الـBatch القديم اتلغى بسبب التعديل
     * - الـBatch البديل اتلغى يدويًا
     *
     * إذن 4 Batches ملغاة.
     */
    expect(dashboard.operations.customer_payments_count).toBe(0);

    expect(dashboard.operations.customer_payments_total).toBe(0);

    expect(dashboard.operations.cancelled_customer_payments_count).toBe(4);

    /*
     * المصروفان اتلغوا بالكامل.
     */
    expect(dashboard.operations.expenses_count).toBe(0);

    expect(dashboard.operations.expenses_total).toBe(0);

    expect(dashboard.operations.cancelled_expenses_count).toBe(2);

    /*
     * =================================
     * تفاصيل الشفت
     * =================================
     */

    const details = getCashShiftDetails(shift.id);

    expect(details.sales_summary.invoices_count).toBe(12);

    expect(details.sales_summary.active_invoices_count).toBe(10);

    expect(details.sales_summary.cancelled_invoices_count).toBe(2);

    expect(details.sales_summary.invoice_sales).toBe(1700);

    expect(details.sales_summary.net_sales).toBe(1550);

    expect(details.sales_summary.paid_total).toBe(950);

    expect(details.sales_summary.remaining_total).toBe(600);

    expect(details.operations_summary.returns_count).toBe(2);

    expect(details.operations_summary.returns_total).toBe(200);

    expect(details.operations_summary.exchanges_count).toBe(4);

    expect(details.operations_summary.exchange_difference).toBe(50);

    expect(details.operations_summary.exchange_cash_collection).toBe(50);

    expect(details.operations_summary.exchange_cash_refund).toBe(0);

    expect(details.operations_summary.exchange_debt_reduction).toBe(0);

    expect(details.operations_summary.customer_payments_count).toBe(0);

    expect(details.operations_summary.customer_payments_total).toBe(0);

    expect(details.operations_summary.cancelled_customer_payments_count).toBe(
      4,
    );

    expect(details.operations_summary.expenses_count).toBe(0);

    expect(details.operations_summary.expenses_total).toBe(0);

    expect(details.operations_summary.cancelled_expenses_count).toBe(2);

    /*
     * =================================
     * المطابقة المباشرة
     * الرئيسية === تفاصيل الشفت
     * =================================
     */

    expect(details.sales_summary.active_invoices_count).toBe(
      dashboard.sales.invoices_count,
    );

    expect(details.sales_summary.cancelled_invoices_count).toBe(
      dashboard.sales.cancelled_invoices_count,
    );

    expect(details.sales_summary.invoice_sales).toBe(
      dashboard.sales.invoice_sales,
    );

    expect(details.sales_summary.net_sales).toBe(dashboard.sales.net_sales);

    expect(details.sales_summary.paid_total).toBe(
      dashboard.sales.paid_sales_total,
    );

    expect(details.sales_summary.remaining_total).toBe(
      dashboard.sales.outstanding_debt_total,
    );

    expect(details.operations_summary.returns_count).toBe(
      dashboard.sales.returns_count,
    );

    expect(details.operations_summary.returns_total).toBe(
      dashboard.sales.returns_total,
    );

    expect(details.operations_summary.exchanges_count).toBe(
      dashboard.sales.exchanges_count,
    );

    expect(details.operations_summary.exchange_difference).toBe(
      dashboard.sales.exchange_adjustment,
    );

    expect(details.operations_summary.exchange_cash_collection).toBe(
      dashboard.sales.exchange_cash_collection,
    );

    expect(details.operations_summary.customer_payments_count).toBe(
      dashboard.operations.customer_payments_count,
    );

    expect(details.operations_summary.customer_payments_total).toBe(
      dashboard.operations.customer_payments_total,
    );

    expect(details.operations_summary.cancelled_customer_payments_count).toBe(
      dashboard.operations.cancelled_customer_payments_count,
    );

    expect(details.operations_summary.expenses_count).toBe(
      dashboard.operations.expenses_count,
    );

    expect(details.operations_summary.expenses_total).toBe(
      dashboard.operations.expenses_total,
    );

    expect(details.operations_summary.cancelled_expenses_count).toBe(
      dashboard.operations.cancelled_expenses_count,
    );

    /*
     * نتأكد كمان إن الأدمن لم يسرق
     * ملكية الفواتير من الكاشير والعكس.
     *
     * كل Invoice محتفظ بمن أنشأها،
     * مع أن الجميع داخل نفس shift_id.
     */
    const db = getDb();

    const actors = db
      .prepare(
        `
      SELECT
        user_id,
        COUNT(*) AS count

      FROM sales

      WHERE shift_id = ?

      GROUP BY user_id
      `,
      )
      .all(shift.id) as Array<{
      user_id: number;
      count: number;
    }>;

    const cashierInvoices = actors.find(
      (row) => Number(row.user_id) === Number(cashier.id),
    );

    const adminInvoices = actors.find((row) => Number(row.user_id) === 1);

    expect(Number(cashierInvoices?.count || 0)).toBe(5);

    expect(Number(adminInvoices?.count || 0)).toBe(7);
  });

  it('keeps historical shift details immutable when later-shift operations touch old records', () => {
    const shift1 = getOpenCashShift();

    expect(shift1).toBeTruthy();

    const baseVariant = seedReportProduct({
      name: 'Cross Shift Historical Base',
      barcode: 'CROSS-SHIFT-HISTORICAL-BASE',
      openingQty: 50,
      buyPrice: 40,
      sellPrice: 100,
    });

    const exchangeVariant = seedReportProduct({
      name: 'Cross Shift Historical Exchange',
      barcode: 'CROSS-SHIFT-HISTORICAL-EXCHANGE',
      openingQty: 20,
      buyPrice: 55,
      sellPrice: 130,
    });

    const customer = createTestCustomer(
      'Cross Shift Historical Customer',
      '01077778888',
    );

    function createShiftOneSale(input?: {
      quantity?: number;
      customerId?: number | null;
      paid?: number;
    }) {
      const quantity = input?.quantity ?? 1;

      const total = quantity * 100;

      const paid = input?.paid === undefined ? total : input.paid;

      return createSale({
        user_id: 1,

        customer_id: input?.customerId ?? null,

        sub_total: total,

        discount_value: 0,

        grand_total: total,

        paid,

        remaining_amount: total - paid,

        payment_status:
          paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',

        change_amount: 0,

        payment_method: 'store_cash',

        items: [
          {
            variant_id: baseVariant.variant_id,

            product_name: baseVariant.product_name,

            barcode: baseVariant.barcode,

            size: baseVariant.size,

            color: baseVariant.color,

            quantity,

            unit_price: 100,
          },
        ],
      });
    }

    /*
     * =================================
     * Shift 1
     * =================================
     *
     * 1) فاتورة جزئي:
     *    300 / مدفوع 100 / باقي 200
     *
     * 2) فاتورة 200 سنعمل عليها
     *    مرتجع لاحقًا في Shift 2
     *
     * 3) فاتورة 100 سنعمل عليها
     *    استبدال +30 لاحقًا في Shift 2
     *
     * 4) فاتورة 100 سنلغيها
     *    لاحقًا في Shift 2
     *
     * 5) مصروف 40 سنعدله
     *    لاحقًا في Shift 2
     */

    const creditSale = createShiftOneSale({
      quantity: 3,
      customerId: customer.id,
      paid: 100,
    });

    const returnSale = createShiftOneSale({
      quantity: 2,
    });

    const exchangeSale = createShiftOneSale();

    const cancelSale = createShiftOneSale();

    const expense = createExpense({
      title: 'Cross Shift Historical Expense',

      amount: 40,

      payment_method: 'store_cash',

      created_by: 1,
    });

    expect(creditSale.shift_id).toBe(shift1!.id);

    expect(returnSale.shift_id).toBe(shift1!.id);

    expect(exchangeSale.shift_id).toBe(shift1!.id);

    expect(cancelSale.shift_id).toBe(shift1!.id);

    expect(expense.shift_id).toBe(shift1!.id);

    /*
     * صورة Shift 1 قبل أي عملية لاحقة.
     */
    const shift1Before = getCashShiftDetails(shift1!.id);

    expect(shift1Before.sales_summary.invoices_count).toBe(4);

    expect(shift1Before.sales_summary.active_invoices_count).toBe(4);

    expect(shift1Before.sales_summary.cancelled_invoices_count).toBe(0);

    expect(shift1Before.sales_summary.invoice_sales).toBe(700);

    expect(shift1Before.sales_summary.net_sales).toBe(700);

    expect(shift1Before.sales_summary.paid_total).toBe(500);

    expect(shift1Before.sales_summary.remaining_total).toBe(200);

    expect(shift1Before.operations_summary.customer_payments_count).toBe(0);

    expect(shift1Before.operations_summary.returns_count).toBe(0);

    expect(shift1Before.operations_summary.exchanges_count).toBe(0);

    expect(shift1Before.operations_summary.expenses_count).toBe(1);

    expect(shift1Before.operations_summary.expenses_total).toBe(40);

    /*
     * نقفل Shift 1 على الرصيد المتوقع
     * بالضبط، ونرحل نفس الرصيد.
     */
    const shift1ClosingAmount = Number(
      shift1Before.preview.expected_closing_amount,
    );

    closeCashShift({
      shift_id: shift1!.id,

      closing_counted_amount: shift1ClosingAmount,

      left_for_next_shift: shift1ClosingAmount,

      closed_by: 1,
    });

    /*
     * =================================
     * Shift 2
     * =================================
     */
    const shift2 = openCashShift({
      opening_counted_amount: shift1ClosingAmount,

      opened_by: 1,
    });

    /*
     * دفعة على فاتورة Shift 1.
     */
    const payment = recordCustomerPayment({
      customer_id: customer.id,

      sale_id: creditSale.saleId,

      amount: 50,

      payment_method: 'store_cash',

      actor_id: 1,
    });

    expect(payment.shift_id).toBe(shift2.id);

    /*
     * مرتجع على فاتورة Shift 1.
     */
    const returnReceipt = getSaleReceipt(returnSale.saleId) as any;

    const saleReturn = createSaleReturn({
      original_sale_id: returnSale.saleId,

      user_id: 1,

      reason: 'Cross shift historical return',

      refund_payment_method: 'store_cash',

      items: [
        {
          sale_item_id: Number(returnReceipt.items[0].id),

          variant_id: baseVariant.variant_id,

          quantity: 1,
        },
      ],
    });

    expect(saleReturn.shift_id).toBe(shift2.id);

    expect(saleReturn.return_value).toBe(100);

    /*
     * استبدال +30 على فاتورة Shift 1.
     */
    const exchangeState = getSaleExchangeState(exchangeSale.saleId);

    const regularGroup = exchangeState.groups.find(
      (group: any) =>
        group.group_kind === 'regular' &&
        group.units.some((unit: any) => Number(unit.is_returned || 0) === 0),
    );

    expect(regularGroup).toBeTruthy();

    const exchangeUnit = regularGroup!.units.find(
      (unit: any) => Number(unit.is_returned || 0) === 0,
    );

    expect(exchangeUnit).toBeTruthy();

    const exchange = createSaleExchange({
      original_sale_id: exchangeSale.saleId,

      user_id: 1,

      payment_method: 'store_cash',

      reason: 'Cross shift historical exchange',

      items: [
        {
          promotion_unit_id: Number(exchangeUnit.id),

          new_variant_id: exchangeVariant.variant_id,
        },
      ],
    });

    expect(exchange.shift_id).toBe(shift2.id);

    expect(exchange.difference_amount).toBe(30);

    /*
     * إلغاء فاتورة من Shift 1
     * داخل Shift 2.
     */
    const cancelledSale = cancelSaleInvoice({
      sale_id: cancelSale.saleId,

      reason: 'Cross shift historical cancellation',

      actor_id: 1,
    });

    expect(cancelledSale.cancelled_shift_id).toBe(shift2.id);

    /*
     * تعديل مصروف Shift 1
     * داخل Shift 2.
     */
    const updatedExpense = updateExpense({
      id: expense.id,

      title: 'Cross Shift Historical Expense Updated',

      amount: 60,

      payment_method: 'store_cash',

      actor_id: 1,
    });

    expect(updatedExpense.updated_shift_id).toBe(shift2.id);

    /*
     * =================================
     * أهم Assertion في الاختبار:
     *
     * Shift 1 يجب أن يظل كما كان
     * وقت إغلاقه.
     * =================================
     */
    const shift1After = getCashShiftDetails(shift1!.id);

    expect(shift1After.sales_summary).toEqual(shift1Before.sales_summary);

    expect(shift1After.operations_summary).toEqual(
      shift1Before.operations_summary,
    );

    expect(shift1After.preview).toEqual(shift1Before.preview);

    /*
     * =================================
     * Shift 2 يحمل العمليات الجديدة.
     * =================================
     */
    const shift2Details = getCashShiftDetails(shift2.id);

    /*
     * مفيش فواتير جديدة اتعملت في Shift 2.
     */
    expect(shift2Details.sales_summary.active_invoices_count).toBe(0);

    expect(shift2Details.sales_summary.invoice_sales).toBe(0);

    /*
     * لكن إلغاء الفاتورة القديمة
     * حصل فعلًا داخل Shift 2.
     */
    expect(shift2Details.sales_summary.cancelled_invoices_count).toBe(1);

    expect(
      shift2Details.sales_summary.cross_shift_cancelled_invoices_count,
    ).toBe(1);

    expect(shift2Details.sales_summary.cross_shift_cancelled_sales_total).toBe(
      100,
    );

    expect(shift2Details.sales_summary.cross_shift_cancelled_refund_total).toBe(
      100,
    );

    expect(
      shift2Details.sales_summary.cross_shift_cancelled_debt_reduction_total,
    ).toBe(0);

    /*
     * دفعة العميل القديمة تمت هنا.
     */
    expect(shift2Details.operations_summary.customer_payments_count).toBe(1);

    expect(shift2Details.operations_summary.customer_payments_total).toBe(50);

    /*
     * المرتجع تم هنا.
     */
    expect(shift2Details.operations_summary.returns_count).toBe(1);

    expect(shift2Details.operations_summary.returns_total).toBe(100);

    /*
     * والاستبدال تم هنا.
     */
    expect(shift2Details.operations_summary.exchanges_count).toBe(1);

    expect(shift2Details.operations_summary.exchange_difference).toBe(30);

    /*
     * =================================
     * الرئيسية الخاصة بـ Shift 2
     * =================================
     *
     * مفيش بيع جديد.
     * مرتجع = -100
     * استبدال = +30
     *
     * صافي مبيعات الشفت = -70
     */
    const shift2Dashboard = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(shift2Dashboard.shift?.id).toBe(shift2.id);

    expect(shift2Dashboard.sales.invoices_count).toBe(0);

    expect(shift2Dashboard.sales.invoice_sales).toBe(0);

    expect(shift2Dashboard.sales.cancelled_invoices_count).toBe(1);

    expect(shift2Dashboard.sales.returns_count).toBe(1);

    expect(shift2Dashboard.sales.returns_total).toBe(100);

    expect(shift2Dashboard.sales.exchanges_count).toBe(1);

    expect(shift2Dashboard.sales.exchange_adjustment).toBe(30);

    expect(shift2Dashboard.sales.cross_shift_cancelled_invoices_count).toBe(1);

    expect(shift2Dashboard.sales.cross_shift_cancelled_sales_total).toBe(100);

    expect(shift2Dashboard.sales.cross_shift_cancelled_refund_total).toBe(100);

    expect(
      shift2Dashboard.sales.cross_shift_cancelled_debt_reduction_total,
    ).toBe(0);

    expect(shift2Details.sales_summary.cross_shift_cancelled_sales_total).toBe(
      shift2Dashboard.sales.cross_shift_cancelled_sales_total,
    );

    expect(shift2Details.sales_summary.cross_shift_cancelled_refund_total).toBe(
      shift2Dashboard.sales.cross_shift_cancelled_refund_total,
    );

    expect(shift2Dashboard.sales.net_sales).toBe(-170);

    /*
     * تفاصيل الشفت لازم تحسب نفس
     * صافي العمليات التي حدثت في Shift 2.
     */
    expect(shift2Details.sales_summary.net_sales).toBe(-170);

    /*
     * =================================
     * Dashboard === Shift Details
     * =================================
     */
    expect(shift2Details.sales_summary.active_invoices_count).toBe(
      shift2Dashboard.sales.invoices_count,
    );

    expect(shift2Details.sales_summary.cancelled_invoices_count).toBe(
      shift2Dashboard.sales.cancelled_invoices_count,
    );

    expect(shift2Details.sales_summary.invoice_sales).toBe(
      shift2Dashboard.sales.invoice_sales,
    );

    expect(shift2Details.sales_summary.net_sales).toBe(
      shift2Dashboard.sales.net_sales,
    );

    expect(shift2Details.operations_summary.returns_count).toBe(
      shift2Dashboard.sales.returns_count,
    );

    expect(shift2Details.operations_summary.returns_total).toBe(
      shift2Dashboard.sales.returns_total,
    );

    expect(shift2Details.operations_summary.exchanges_count).toBe(
      shift2Dashboard.sales.exchanges_count,
    );

    expect(shift2Details.operations_summary.exchange_difference).toBe(
      shift2Dashboard.sales.exchange_adjustment,
    );

    expect(shift2Details.operations_summary.customer_payments_count).toBe(
      shift2Dashboard.operations.customer_payments_count,
    );

    expect(shift2Details.operations_summary.customer_payments_total).toBe(
      shift2Dashboard.operations.customer_payments_total,
    );
  });

  it('keeps shift operations on the shift opening business date', () => {
    const db = getDb();

    const shift = getOpenCashShift()!;

    const liability = createLiability({
      party_name: 'Shift Date Party',

      title: 'Shift Date Liability',

      total_amount: 100,

      paid_amount: 0,

      payment_method: 'cash',

      actor_id: 1,
    });

    /*
     * نحاكي شفت بدأ في
     * تاريخ قديم واستمر بعد
     * منتصف الليل.
     */
    db.prepare(
      `
      UPDATE cash_shifts

      SET
        opened_at =
          '2020-01-15 20:00:00',

        business_date =
          '2020-01-15'

      WHERE id = ?
      `,
    ).run(shift.id);

    const shiftDate = db
      .prepare(
        `
        SELECT
          COALESCE(
            NULLIF(
              business_date,
              ''
            ),

            date(
              opened_at,
              'localtime'
            )
          ) AS day

        FROM cash_shifts

        WHERE id = ?
        `,
      )
      .get(shift.id) as {
      day: string;
    };

    const variant = seedReportProduct({
      name: 'Shift Date Product',

      barcode: 'SHIFT-DATE-PRODUCT',

      openingQty: 20,

      buyPrice: 50,

      sellPrice: 100,
    });

    const exchangeVariant = seedReportProduct({
      name: 'Shift Date Exchange Target',
      barcode: 'SHIFT-DATE-EXCHANGE',
      openingQty: 10,
      buyPrice: 60,
      sellPrice: 130,
    });

    const sale = createSale({
      user_id: 1,

      /*
       * حتى لو حاول أي caller
       * يرسل تاريخ مختلف،
       * الشفت هو المصدر.
       */
      business_date: '2099-01-01',

      customer_id: null,

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

    const saleRow = db
      .prepare(
        `
        SELECT
          business_date,
          shift_id

        FROM sales

        WHERE id = ?
        `,
      )
      .get(sale.saleId) as {
      business_date: string;
      shift_id: number;
    };

    expect(saleRow.shift_id).toBe(shift.id);

    expect(saleRow.business_date).toBe(shiftDate.day);

    const receipt = getSaleReceipt(sale.saleId) as any;

    createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      reason: 'Shift date return',

      items: [
        {
          sale_item_id: receipt.items[0].id,

          variant_id: variant.variant_id,

          quantity: 1,
        },
      ],
    });

    const exchangeState = getSaleExchangeState(sale.saleId);

    const regularGroup = exchangeState.groups.find(
      (group: any) =>
        group.group_kind === 'regular' &&
        group.units.some((unit: any) => Number(unit.is_returned || 0) === 0),
    );

    expect(regularGroup).toBeTruthy();

    const exchangeUnit = regularGroup!.units.find(
      (unit: any) => Number(unit.is_returned || 0) === 0,
    );

    const exchange = createSaleExchange({
      original_sale_id: sale.saleId,
      user_id: 1,

      payment_method: 'cash',

      items: [
        {
          promotion_unit_id: Number(exchangeUnit.id),
          new_variant_id: exchangeVariant.variant_id,
        },
      ],
    });

    expect(exchange.shift_id).toBe(shift.id);

    const manualMovement = createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 25,

      payment_method: 'owner_cash',

      reference_id: null,
      reference_type: 'manual',

      notes: 'Shift date manual movement',

      created_by: 1,
      shift_id: shift.id,
    });

    createExpense({
      title: 'Shift date expense',

      amount: 10,

      payment_method: 'cash',

      created_by: 1,
    });

    const supplier = createSupplier({
      name: 'Shift Date Supplier',
    }) as any;

    db.prepare(
      `
      UPDATE sale_exchanges

      SET
        business_date = '',
        created_at = '2020-01-16 00:40:00'

      WHERE id = ?
      `,
    ).run(exchange.exchangeId);

    db.prepare(
      `
      UPDATE cash_movements

      SET
        created_at = '2020-01-16 00:50:00'

      WHERE id = ?
      `,
    ).run(Number(manualMovement.lastInsertRowid));

    const purchase = createPurchaseInvoice({
      supplier_id: supplier.id,

      actor_id: 1,

      paid_amount: 50,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 80,
        },
      ],
    });

    expect(purchase.shift_id).toBe(shift.id);

    const liabilityPayment = recordLiabilityPayment({
      liability_id: liability.liability_id,

      amount: 40,

      payment_method: 'cash',

      actor_id: 1,
    });

    expect(liabilityPayment.shift_id).toBe(shift.id);

    /*
     * نحاكي عمليات تمت بعد منتصف الليل
     * مع فقدان business_date المخزن.
     *
     * التقرير لازم يرجع لتاريخ الشفت
     * وليس تاريخ الساعة الفعلي.
     */
    db.prepare(
      `
      UPDATE purchase_invoices

      SET
        business_date = '',
        created_at = '2020-01-16 00:30:00'

      WHERE id = ?
      `,
    ).run(purchase.purchaseId);

    db.prepare(
      `
      UPDATE store_liability_payments

      SET
        business_date = '',
        created_at = '2020-01-16 00:45:00'

      WHERE id = ?
      `,
    ).run(liabilityPayment.payment_id);

    const report = getReportsSummary({
      date_from: shiftDate.day,

      date_to: shiftDate.day,
    }) as ReportsSummaryTestResult;
    expect(report.summary.exchange_count).toBe(1);

    expect(report.summary.exchange_adjustment).toBe(30);

    expect(report.summary.total_manual_deposits).toBe(25);
    expect(report.summary.sales_count).toBe(1);

    expect(report.summary.gross_sales).toBe(230);

    expect(report.summary.returns_count).toBe(1);

    expect(report.summary.total_returns).toBe(100);

    expect(report.summary.total_expenses).toBe(10);

    expect(report.summary.total_purchase_invoices).toBe(80);

    expect(report.summary.total_liability_payments).toBe(40);

    const movements = db
      .prepare(
        `
        SELECT
          business_date

        FROM cash_movements

        WHERE
          shift_id = ?

          AND
            reference_type
            IN (
              'sale',
              'sale_return',
              'sale_exchange',
              'expense',
              'manual'
            )
        `,
      )
      .all(shift.id) as Array<{
      business_date: string;
    }>;

    expect(movements.length).toBeGreaterThan(0);

    expect(
      movements.every((movement) => movement.business_date === shiftDate.day),
    ).toBe(true);
  });

  it('includes approved closing surplus in final net profit', () => {
    const shift = getOpenCashShift();

    expect(shift).toBeTruthy();

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 100,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift!.id,
    });

    closeCashShift({
      shift_id: shift!.id,
      closing_counted_amount: 150,
      left_for_next_shift: 0,
      closed_by: 1,
    });

    const variance = listCashShiftVariances({
      status: 'pending',
    }).rows.find(
      (row) => row.shift_id === shift!.id && row.stage === 'closing',
    );

    expect(variance).toBeTruthy();
    expect(variance!.kind).toBe('surplus');
    expect(Number(variance!.amount)).toBe(50);

    resolveCashShiftVariance({
      variance_id: variance!.id,
      resolution_type: 'approved',
      resolution_notes: 'زيادة إغلاق حقيقية',
      resolved_by: 1,
    });

    const report = getReportsSummary();

    expect(report.summary.approved_closing_surplus).toBe(50);
    expect(report.summary.approved_closing_shortage).toBe(0);
    expect(report.summary.final_net_profit).toBe(50);
  });

  it('includes approved opening surplus in final net profit', () => {
    const firstShift = getOpenCashShift();

    expect(firstShift).toBeTruthy();

    closeCashShift({
      shift_id: firstShift!.id,
      closing_counted_amount: 0,
      left_for_next_shift: 0,
      closed_by: 1,
    });

    const secondShift = openCashShift({
      opening_counted_amount: 50,
      opened_by: 1,
    });

    expect(secondShift.expected_opening_amount).toBe(0);
    expect(secondShift.opening_difference).toBe(50);

    const variance = listCashShiftVariances({
      status: 'pending',
    }).rows.find(
      (row) => row.shift_id === secondShift.id && row.stage === 'opening',
    );

    expect(variance).toBeTruthy();
    expect(variance!.kind).toBe('surplus');
    expect(Number(variance!.amount)).toBe(50);

    resolveCashShiftVariance({
      variance_id: variance!.id,
      resolution_type: 'approved',
      resolution_notes: 'زيادة افتتاح حقيقية',
      resolved_by: 1,
    });

    const report = getReportsSummary();

    expect(report.summary.approved_opening_surplus).toBe(50);
    expect(report.summary.approved_opening_shortage).toBe(0);
    expect(report.summary.final_net_profit).toBe(50);
  });

  it('reports split invoice amounts under each payment method', () => {
    const variant = seedReportProduct({
      name: 'Split Payment Product',
      barcode: 'REPORT-SPLIT',
      openingQty: 10,
      buyPrice: 100,
      sellPrice: 150,
    });

    createSale({
      user_id: 1,
      customer_id: null,

      sub_total: 150,
      discount_value: 0,
      grand_total: 150,

      paid: 150,
      change_amount: 0,
      payment_method: 'split',

      payments: [
        {
          payment_method: 'cash',
          amount: 50,
        },
        {
          payment_method: 'bank_transfer',
          amount: 100,
        },
      ],

      items: [
        {
          variant_id: variant.variant_id,
          product_name: variant.product_name,
          barcode: variant.barcode,
          size: variant.size,
          color: variant.color,
          quantity: 1,
          unit_price: 150,
        },
      ],
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.sales_count).toBe(1);
    expect(report.summary.gross_sales).toBe(150);

    const cash = report.paymentMethods.find(
      (row) => row.payment_method === 'cash',
    );

    const bank = report.paymentMethods.find(
      (row) => row.payment_method === 'bank_transfer',
    );

    expect(cash).toBeTruthy();
    expect(Number(cash!.count)).toBe(1);
    expect(Number(cash!.total)).toBe(50);

    expect(bank).toBeTruthy();
    expect(Number(bank!.count)).toBe(1);
    expect(Number(bank!.total)).toBe(100);
  });

  it('keeps historical sale profit unchanged after a later purchase changes the product cost', () => {
    const variant = seedReportProduct({
      name: 'Historical Profit Product',

      barcode: 'HISTORICAL-PROFIT',

      openingQty: 10,

      buyPrice: 100,

      sellPrice: 150,
    });

    createSale({
      user_id: 1,

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

          unit_price: 150,
        },
      ],
    });

    const beforePurchase = getReportsSummary() as ReportsSummaryTestResult;

    expect(beforePurchase.summary.gross_profit_before_discounts).toBe(50);

    expect(beforePurchase.summary.net_profit_after_discounts).toBe(50);

    const supplier = createSupplier({
      name: 'Historical Profit Supplier',
    }) as any;

    createPurchaseInvoice({
      supplier_id: supplier.id,

      actor_id: 1,

      paid_amount: 0,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 10,

          unit_cost: 300,
        },
      ],
    });

    const afterPurchase = getReportsSummary() as ReportsSummaryTestResult;

    /*
     * سعر الشراء الحالي ومتوسط
     * المخزون اتغيروا.
     *
     * لكن البيع القديم خرج وقتها
     * بتكلفة 100، فربحه يظل 50.
     */
    expect(afterPurchase.summary.gross_profit_before_discounts).toBe(50);

    expect(afterPurchase.summary.net_profit_after_discounts).toBe(50);

    const saleItem = getDb()
      .prepare(
        `
        SELECT unit_cost

        FROM sale_items

        ORDER BY id ASC

        LIMIT 1
        `,
      )
      .get() as {
      unit_cost: number;
    };

    expect(Number(saleItem.unit_cost)).toBe(100);
  });

  it('subtracts positive purchase rounding from final net profit', () => {
    const variant = seedReportProduct({
      name: 'Purchase Rounding Profit Product',

      barcode: 'PURCHASE-ROUNDING-PROFIT',

      openingQty: 0,

      buyPrice: 45.5,

      sellPrice: 100,
    });

    const supplier = createSupplier({
      name: 'Purchase Rounding Supplier',
    }) as any;

    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 1000,
      payment_method: 'store_cash',
      reference_type: 'test_seed',
      created_by: 1,
    });

    const purchase = createPurchaseInvoice({
      supplier_id: supplier.id,

      actor_id: 1,

      paid_amount: 46,

      settle_full_balance: true,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 45.5,
        },
      ],
    });

    expect(purchase.rounding_adjustment).toBe(0.5);

    createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 100,

      discount_value: 0,

      grand_total: 100,

      paid: 100,

      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 100,
        },
      ],
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.total_purchase_exact_amount).toBe(45.5);

    expect(report.summary.total_purchase_invoices).toBe(45.5);

    expect(report.summary.purchase_rounding_increase).toBe(0.5);

    expect(report.summary.purchase_rounding_decrease).toBe(0);

    expect(report.summary.purchase_rounding_net).toBe(0.5);

    expect(report.summary.net_profit_after_discounts).toBe(54.5);

    expect(report.summary.final_net_profit).toBe(54);
  });

  it('adds negative purchase rounding to final net profit', () => {
    const variant = seedReportProduct({
      name: 'Purchase Rounding Gain Product',

      barcode: 'PURCHASE-ROUNDING-GAIN',

      openingQty: 0,

      buyPrice: 45.49,

      sellPrice: 100,
    });

    const supplier = createSupplier({
      name: 'Purchase Rounding Gain Supplier',
    }) as any;

    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 1000,
      payment_method: 'store_cash',
      reference_type: 'test_seed',
      created_by: 1,
    });

    const purchase = createPurchaseInvoice({
      supplier_id: supplier.id,

      actor_id: 1,

      paid_amount: 45,

      settle_full_balance: true,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 1,

          unit_cost: 45.49,
        },
      ],
    });

    expect(purchase.rounding_adjustment).toBe(-0.49);

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.purchase_rounding_increase).toBe(0);

    expect(report.summary.purchase_rounding_decrease).toBe(0.49);

    expect(report.summary.purchase_rounding_net).toBe(-0.49);

    expect(report.summary.final_net_profit).toBe(0.49);
  });

  it('keeps explicit purchase settlement rounding when credit returns do not settle cash', () => {
    const variant = seedReportProduct({
      name: 'Purchase Return Rounding Product',

      barcode: 'PURCHASE-RETURN-ROUNDING',

      openingQty: 0,

      buyPrice: 22.75,

      sellPrice: 100,
    });

    const supplier = createSupplier({
      name: 'Purchase Return Rounding Supplier',
    }) as any;

    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 1000,
      payment_method: 'store_cash',
      reference_type: 'test_seed',
      created_by: 1,
    });

    const purchase = createPurchaseInvoice({
      supplier_id: supplier.id,

      actor_id: 1,

      paid_amount: 46,

      settle_full_balance: true,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 22.75,
        },
      ],
    });

    const invoice = getPurchaseInvoice(purchase.purchaseId) as any;

    createPurchaseReturn({
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

    let report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.purchase_rounding_increase).toBe(0.5);

    expect(report.summary.purchase_rounding_decrease).toBe(0);

    expect(report.summary.purchase_rounding_net).toBe(0.5);

    expect(report.summary.final_net_profit).toBe(-0.5);

    createPurchaseReturn({
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

    report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.purchase_rounding_increase).toBe(0.5);

    expect(report.summary.purchase_rounding_decrease).toBe(0);

    expect(report.summary.purchase_rounding_net).toBe(0.5);

    expect(report.summary.final_net_profit).toBe(-0.5);
  });

  it('does not infer rounding for legacy fractional purchase invoices', () => {
    const variant = seedReportProduct({
      name: 'Legacy Fractional Purchase',

      barcode: 'LEGACY-PURCHASE-ROUNDING',

      openingQty: 0,

      buyPrice: 443.75,

      sellPrice: 600,
    });

    const supplier = createSupplier({
      name: 'Legacy Purchase Supplier',
    }) as any;

    const purchase = createPurchaseInvoice({
      supplier_id: supplier.id,

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

    /*
     * نحولها يدويًا لشكل الداتا
     * القديمة قبل وجود Tracking
     * فرق التقريب.
     */
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

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.total_purchase_exact_amount).toBe(443.75);

    expect(report.summary.total_purchase_invoices).toBe(443.75);

    expect(report.summary.purchase_rounding_increase).toBe(0);

    expect(report.summary.purchase_rounding_decrease).toBe(0);

    expect(report.summary.purchase_rounding_net).toBe(0);

    expect(report.summary.final_net_profit).toBe(0);
  });

  it('keeps product discounts reconciled in reports and cashier dashboard', () => {
    createProduct({
      name: 'Report Product Discount',

      category_id: null,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'REPORT-PD',

          size: 'M',
          color: 'Black',

          buy_price: 100,

          sell_price: 190,
          discount_price: 150,

          min_stock: 1,

          opening_qty: 10,
        },
      ],
    });

    const variant = getVariantByBarcode('REPORT-PD') as any;

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 300,

      discount_value: 0,

      grand_total: 300,

      change_amount: 0,

      payment_method: 'store_cash',

      paid: 300,

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 2,

          unit_price: 150,

          list_unit_price: 190,
        },
      ],
    });

    let report = getReportsSummary() as any;

    expect(Number(report.summary.gross_sales)).toBe(300);

    expect(Number(report.summary.product_discounts)).toBe(80);

    expect(Number(report.summary.total_discounts)).toBe(80);

    /*
     * List margin:
     * (190 - 100) × 2 = 180
     */
    expect(Number(report.summary.gross_profit_before_discounts)).toBe(180);

    /*
     * Actual margin:
     * (150 - 100) × 2 = 100
     */
    expect(Number(report.summary.net_profit_after_discounts)).toBe(100);

    let cashier = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(cashier.sales.invoice_sales).toBe(300);

    expect(cashier.sales.net_sales).toBe(300);

    expect(cashier.discounts.product).toBe(80);

    expect(cashier.discounts.normal).toBe(0);

    expect(cashier.discounts.promotion).toBe(0);

    expect(cashier.discounts.loyalty).toBe(0);

    expect(cashier.discounts.total).toBe(80);

    const receipt = getSaleReceipt(sale.saleId) as any;

    createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      refund_payment_method: 'store_cash',

      items: [
        {
          sale_item_id: Number(receipt.items[0].id),

          variant_id: Number(variant.variant_id),

          quantity: 1,
        },
      ],
    });

    report = getReportsSummary() as any;

    expect(Number(report.summary.gross_sales)).toBe(300);

    expect(Number(report.summary.total_returns)).toBe(150);

    expect(Number(report.summary.net_sales)).toBe(150);

    expect(Number(report.summary.product_discounts)).toBe(40);

    expect(Number(report.summary.total_discounts)).toBe(40);

    expect(Number(report.summary.gross_profit_before_discounts)).toBe(90);

    expect(Number(report.summary.net_profit_after_discounts)).toBe(50);

    cashier = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(cashier.sales.returns_total).toBe(150);

    expect(cashier.sales.net_sales).toBe(150);

    expect(cashier.discounts.product).toBe(40);

    expect(cashier.discounts.total).toBe(40);
  });

  it('builds lightweight admin dashboard today summary', () => {
    const variant = seedReportProduct({
      name: 'Dashboard Today Product',
      barcode: 'DASHBOARD-TODAY',
      openingQty: 10,
      buyPrice: 50,
      sellPrice: 100,
    });

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 100,
      discount_value: 0,
      grand_total: 100,

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

          quantity: 1,

          unit_price: 100,
        },
      ],
    });

    const db = getDb();

    db.prepare(
      `
    UPDATE cash_shifts

    SET business_date = ?

    WHERE id = (
      SELECT shift_id
      FROM sales
      WHERE id = ?
    )
    `,
    ).run('2026-10-10', sale.saleId);

    const receipt = getSaleReceipt(sale.saleId) as any;

    createSaleReturn({
      original_sale_id: sale.saleId,

      user_id: 1,

      reason: 'Dashboard today summary return',

      items: [
        {
          sale_item_id: Number(receipt.items[0].id),

          variant_id: variant.variant_id,

          quantity: 1,
        },
      ],
    });

    const summary = getAdminDashboardTodaySummary('2026-10-10');

    const fullReport = getReportsSummary({
      date_from: '2026-10-10',

      date_to: '2026-10-10',
    });

    expect(summary.sales_count).toBe(fullReport.summary.sales_count);

    expect(summary.net_sales).toBe(fullReport.summary.net_sales);

    expect(summary.sales_count).toBe(1);

    expect(summary.net_sales).toBe(0);

    const empty = getAdminDashboardTodaySummary('2026-10-11');

    expect(empty.sales_count).toBe(0);

    expect(empty.net_sales).toBe(0);
  });

  it('does not infer legacy purchase return rounding without explicit settlement', () => {
    const variant = seedReportProduct({
      name: 'Legacy Purchase Return Rounding',

      barcode: 'LEGACY-PURCHASE-RETURN',

      openingQty: 0,

      buyPrice: 22.75,

      sellPrice: 100,
    });

    const supplier = createSupplier({
      name: 'Legacy Return Supplier',
    }) as any;

    const purchase = createPurchaseInvoice({
      supplier_id: supplier.id,

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

    /*
     * محاكاة الداتا القديمة:
     *
     * الفاتورة والمرتجع عندهم
     * القيم الدقيقة لكن بدون
     * Tracking لفرق التقريب.
     */
    getDb()
      .prepare(
        `
      UPDATE purchase_invoices

      SET
        total_amount = 45.5,

        exact_total_amount = 45.5,

        rounding_adjustment = 0

      WHERE id = ?
      `,
      )
      .run(purchase.purchaseId);

    getDb()
      .prepare(
        `
      UPDATE purchase_returns

      SET
        total_amount = 22.75,

        exact_total_amount = 22.75,

        rounding_adjustment = 0

      WHERE id = ?
      `,
      )
      .run(purchaseReturn.return_id);

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.purchase_rounding_increase).toBe(0);

    expect(report.summary.purchase_rounding_decrease).toBe(0);

    expect(report.summary.purchase_rounding_net).toBe(0);

    expect(report.summary.final_net_profit).toBe(0);
  });

  it('rounds whole-pound sale discount and calculates profit from cent-accurate inventory cost', () => {
    const variant = seedReportProduct({
      name: 'Whole Pound Profit Product',

      barcode: 'WHOLE-POUND-PROFIT',

      openingQty: 1,

      buyPrice: 150,
      sellPrice: 200,
    });

    const sale = createSale({
      user_id: 1,

      customer_id: null,

      sub_total: 200,

      discount_value: 1.5,

      grand_total: 198,

      change_amount: 0,

      payment_method: 'cash',

      paid: 198,

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 200,
        },
      ],
    });

    expect(sale.grand_total).toBe(198);

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.summary.normal_discounts).toBe(2);

    expect(report.summary.gross_profit_before_discounts).toBe(50);

    expect(report.summary.net_profit_after_discounts).toBe(48);
  });
});
