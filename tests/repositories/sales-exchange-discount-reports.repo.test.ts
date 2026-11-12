import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createCategory,
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  createSale,
  createSaleReturn,
  listSales,
} from '../../src/main/database/repositories/sales.repo';
import {
  createSaleExchange,
  cancelSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo';
import { getSalesHistoryReport } from '../../src/main/database/repositories/sales-history-report.repo';
import {
  getCashierDashboardSummary,
  getReportsSummary,
} from '../../src/main/database/repositories/reports.repo';
import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

function setup(quantity = 1, normalDiscount = 0) {
  const category = createCategory({
    name: 'Exchange discount dashboard tests',
  });
  createProduct({
    name: 'Exchange discount dashboard item',
    category_id: category.id,
    image_path: null,
    description: null,
    variants: [
      {
        barcode: 'RDX100',
        size: 'S',
        color: 'Black',
        buy_price: 40,
        sell_price: 100,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'RDX150',
        size: 'M',
        color: 'Black',
        buy_price: 60,
        sell_price: 150,
        min_stock: 1,
        opening_qty: 20,
      },
      {
        barcode: 'RDX200',
        size: 'L',
        color: 'Black',
        buy_price: 80,
        sell_price: 200,
        min_stock: 1,
        opening_qty: 20,
      },
    ],
  });
  const oldVariant = getVariantByBarcode('RDX100') as any;
  const nextVariant = getVariantByBarcode('RDX150') as any;
  const finalVariant = getVariantByBarcode('RDX200') as any;
  const sale = createSale({
    user_id: 1,
    customer_id: null,
    promotion_id: null,
    sub_total: 100 * quantity,
    discount_value: normalDiscount,
    grand_total: 100 * quantity - normalDiscount,
    paid: 100 * quantity - normalDiscount,
    change_amount: 0,
    payment_method: 'cash',
    items: [
      {
        variant_id: oldVariant.variant_id,
        product_name: oldVariant.product_name,
        barcode: oldVariant.barcode,
        size: oldVariant.size,
        color: oldVariant.color,
        quantity,
        unit_price: 100,
      },
    ],
  });
  const state = getSaleExchangeState(sale.saleId);
  const group = state.groups.find((g: any) => g.group_kind === 'regular');
  if (!group) throw new Error('Missing regular group');
  const saleItem = getDb()
    .prepare('SELECT id FROM sale_items WHERE sale_id = ?')
    .get(sale.saleId) as { id: number };
  return {
    saleId: sale.saleId,
    unitId: Number(group.units[0].id),
    saleItemId: saleItem.id,
    nextVariant,
    finalVariant,
  };
}

function swap(
  data: ReturnType<typeof setup>,
  variantId: number,
  amount: number,
) {
  return createSaleExchange({
    original_sale_id: data.saleId,
    user_id: 1,
    payment_method: 'store_cash',
    discount_type: 'amount',
    discount_input: amount,
    items: [{ promotion_unit_id: data.unitId, new_variant_id: variantId }],
  });
}

const cashierDiscounts = () =>
  getCashierDashboardSummary({ user_id: 1 }).discounts;
const historyDiscounts = () => getSalesHistoryReport().summary;

describe('exchange discount reporting and cashier dashboard', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
  }, 30_000);

  it('shows the actual granted exchange discount once in cashier and historical totals', () => {
    const data = setup();
    const ex = swap(data, data.nextVariant.variant_id, 10);
    expect(ex.difference_amount).toBe(40);
    expect(cashierDiscounts()).toMatchObject({ exchange: 10, total: 10 });
    expect(historyDiscounts().exchange_discounts).toBe(10);
    expect(historyDiscounts().total_discounts).toBe(10);
    expect(getReportsSummary().summary.exchange_discounts).toBe(10);
    expect(getReportsSummary().summary.total_discounts).toBe(10);
    // الفاتورة بعد الاستبدال
    const invoice = listSales({ limit: 20, offset: 0 }).rows.find(
      (row: any) => Number(row.id) === data.saleId,
    );

    expect(invoice).toBeDefined();
    expect(Number(invoice.exchange_discount_value)).toBe(10);
    expect(Number(invoice.total_discount_value)).toBe(10);
    expect(Number(invoice.grand_total)).toBe(140);

    // رئيسية الكاشير
    const cashier = getCashierDashboardSummary({ user_id: 1 });

    expect(cashier.sales.exchange_adjustment).toBe(40);
    expect(cashier.sales.net_sales).toBe(140);
    expect(cashier.discounts.exchange).toBe(10);
    expect(cashier.discounts.total).toBe(10);

    // التقارير والأرباح
    const report = getSalesHistoryReport().summary;

    expect(report.net_sales).toBe(140);
    expect(report.gross_profit_before_discounts).toBe(90);
    expect(report.net_profit_after_discounts).toBe(80);

    expect(getReportsSummary().summary.net_profit_after_discounts).toBe(80);
  });

  it('reverses the discount in both summaries if the exchange is cancelled', () => {
    const data = setup();
    const ex = swap(data, data.nextVariant.variant_id, 10);
    expect(
      cancelSaleExchange({ exchange_id: ex.exchangeId, actor_id: 1 }).ok,
    ).toBe(true);
    expect(cashierDiscounts().exchange).toBe(0);
    expect(historyDiscounts().exchange_discounts).toBe(0);
    expect(historyDiscounts().total_discounts).toBe(0);

    const cashier = getCashierDashboardSummary({ user_id: 1 });
    const report = getSalesHistoryReport().summary;

    expect(cashier.sales.net_sales).toBe(100);
    expect(cashier.discounts.exchange).toBe(0);

    expect(report.net_sales).toBe(100);
    expect(report.net_profit_after_discounts).toBe(60);
  });

  it('does not keep a discount in totals after returning the replacement', () => {
    const data = setup();
    swap(data, data.nextVariant.variant_id, 10);
    const ret = createSaleReturn({
      original_sale_id: data.saleId,
      user_id: 1,
      refund_payment_method: 'store_cash',
      items: [
        {
          sale_item_id: data.saleItemId,
          variant_id: data.nextVariant.variant_id,
          quantity: 1,
        },
      ],
    });
    expect(ret.return_value).toBe(140);
    expect(cashierDiscounts().exchange).toBe(0);
    expect(historyDiscounts().exchange_discounts).toBe(0);
    expect(historyDiscounts().total_discounts).toBe(0);

    const cashier = getCashierDashboardSummary({ user_id: 1 });
    const report = getSalesHistoryReport().summary;

    expect(cashier.sales.net_sales).toBe(0);
    expect(cashier.discounts.exchange).toBe(0);

    expect(report.net_sales).toBe(0);
    expect(report.net_profit_after_discounts).toBe(0);
  });

  it('counts separate grants across consecutive exchanges without counting retained discounts twice', () => {
    const data = setup();
    swap(data, data.nextVariant.variant_id, 10);
    swap(data, data.finalVariant.variant_id, 5);
    expect(cashierDiscounts()).toMatchObject({ exchange: 15, total: 15 });
    expect(historyDiscounts().exchange_discounts).toBe(15);
    expect(historyDiscounts().total_discounts).toBe(15);
  });

  it('keeps 14 normal discount and 10 exchange discount on the same invoice', () => {
    // قطعتان × 100 = 200
    // خصم عادي أصلي = 28
    // إجمالي البيع = 172
    const data = setup(2, 28);

    // استبدال قطعة واحدة:
    // القديم = 100، الجديد = 150
    // نصيب خصم القطعة القديمة = 14 يُلغى
    // خصم استبدال جديد = 10
    const exchange = swap(data, data.nextVariant.variant_id, 10);

    // الفاتورة بعد الاستبدال:
    // 100 + 150 - 14 - 10 = 226
    // فرق الاستبدال = 226 - 172 = 54
    expect(exchange.exchange_discount_value).toBe(10);
    expect(exchange.difference_amount).toBe(54);
    expect(exchange.amount_to_collect).toBe(54);

    const invoice = listSales({
      limit: 20,
      offset: 0,
    }).rows.find((row: any) => Number(row.id) === data.saleId);

    expect(invoice).toBeDefined();

    expect(Number(invoice.discount_value)).toBe(14);
    expect(Number(invoice.exchange_discount_value)).toBe(10);
    expect(Number(invoice.total_discount_value)).toBe(24);
    expect(Number(invoice.grand_total)).toBe(226);

    // الرئيسية: الخصم العادي والاستبدال منفصلان
    const cashier = getCashierDashboardSummary({
      user_id: 1,
    });

    expect(cashier.discounts.normal).toBe(14);
    expect(cashier.discounts.exchange).toBe(10);
    expect(cashier.discounts.total).toBe(24);

    expect(cashier.sales.invoice_sales).toBe(172);
    expect(cashier.sales.exchange_adjustment).toBe(54);
    expect(cashier.sales.net_sales).toBe(226);

    // تكلفة القطعة المتبقية = 40
    // تكلفة البديل = 60
    // إجمالي التكلفة الحالية = 100
    // الربح قبل الخصومات = 250 - 100 = 150
    // الربح بعد الخصومات = 226 - 100 = 126
    const report = getSalesHistoryReport().summary;

    expect(report.normal_discounts).toBe(14);
    expect(report.exchange_discounts).toBe(10);
    expect(report.total_discounts).toBe(24);

    expect(report.net_sales).toBe(226);
    expect(report.gross_profit_before_discounts).toBe(150);
    expect(report.net_profit_after_discounts).toBe(126);
  });
});
