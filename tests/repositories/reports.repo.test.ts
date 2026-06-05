import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode
} from '../../src/main/database/repositories/product.repo';
import { createSale, createSaleReturn, getSaleReceipt } from '../../src/main/database/repositories/sales.repo';
import { createExpense } from '../../src/main/database/repositories/expense.repo';
import {
  createLiability,
  recordLiabilityPayment
} from '../../src/main/database/repositories/liabilities.repo';
import { getReportsSummary } from '../../src/main/database/repositories/reports.repo';

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
    final_net_profit: number;
  };
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
        opening_qty: options?.openingQty ?? 20
      }
    ]
  });

  const variant = getVariantByBarcode(barcode) as ReportVariantTestRow | undefined;

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
      `
    )
    .run(name, phone);

  return {
    id: Number(result.lastInsertRowid),
    name,
    phone
  } as CustomerTestRow;
}

describe('reports repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
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
    expect(report.summary.final_net_profit).toBe(0);

    expect(report.topProducts).toHaveLength(0);
    expect(report.dailySales).toHaveLength(0);
    expect(report.paymentMethods).toHaveLength(0);
    expect(report.topCustomers).toHaveLength(0);
  });

  it('calculates sales profit discounts expenses and liability payments', () => {
    const variant = seedReportProduct({
      name: 'Report Shirt',
      barcode: 'REPORT-SHIRT',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150
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
          unit_price: 150
        }
      ]
    });

    createExpense({
      title: 'Report Expense',
      amount: 30,
      payment_method: 'cash',
      created_by: 1
    });

    const liability = createLiability({
      party_name: 'Report Party',
      title: 'Report Liability',
      total_amount: 100,
      paid_amount: 0,
      actor_id: 1
    });

    recordLiabilityPayment({
      liability_id: liability.liability_id,
      amount: 40,
      payment_method: 'cash',
      actor_id: 1
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
    expect(report.summary.final_net_profit).toBe(10);

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

  it('subtracts returns from sales totals top products and customers', () => {
    const variant = seedReportProduct({
      name: 'Return Report Product',
      barcode: 'REPORT-RETURN',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150
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
          unit_price: 150
        }
      ]
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
          quantity: 1
        }
      ]
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
      sellPrice: 150
    });

    seedReportProduct({
      name: 'Available Stock Report Product',
      barcode: 'REPORT-AVAILABLE',
      openingQty: 20,
      minStock: 5,
      buyPrice: 100,
      sellPrice: 150
    });

    const report = getReportsSummary() as ReportsSummaryTestResult;

    expect(report.lowStock.some((item) => item.barcode === 'REPORT-LOW')).toBe(true);
    expect(report.lowStock.some((item) => item.barcode === 'REPORT-AVAILABLE')).toBe(false);
  });

  it('filters reports by date range', () => {
    const variant = seedReportProduct({
      name: 'Date Filter Product',
      barcode: 'REPORT-DATE',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150
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
          unit_price: 150
        }
      ]
    });

    const today = new Date().toISOString().slice(0, 10);

    const todayReport = getReportsSummary({
      date_from: today,
      date_to: today
    }) as ReportsSummaryTestResult;

    const futureReport = getReportsSummary({
      date_from: '2099-01-01',
      date_to: '2099-01-31'
    }) as ReportsSummaryTestResult;

    expect(todayReport.summary.sales_count).toBe(1);
    expect(todayReport.summary.gross_sales).toBe(150);

    expect(futureReport.summary.sales_count).toBe(0);
    expect(futureReport.summary.gross_sales).toBe(0);
    expect(futureReport.topProducts).toHaveLength(0);
    expect(futureReport.dailySales).toHaveLength(0);
  });
});