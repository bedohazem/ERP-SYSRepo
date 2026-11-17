import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import { getInventoryCostState } from '../../src/main/database/inventory-cost';
import {
  createProduct,
  getVariantByBarcode,
  searchSaleVariants,
  updateProduct,
  updateVariant,
} from '../../src/main/database/repositories/product.repo';
import {
  createPurchaseInvoice,
  createPurchaseReturn,
  getPurchaseInvoice,
  getPurchaseReturn,
} from '../../src/main/database/repositories/purchases.repo';
import {
  createSale,
  createSaleReturn,
  getSaleReceipt,
  getSaleReturnHistory,
} from '../../src/main/database/repositories/sales.repo';
import { getSaleCurrentState } from '../../src/main/database/repositories/sales-current-state.repo';
import { getReportsSummary } from '../../src/main/database/repositories/reports.repo';
import { getSalesHistoryReport } from '../../src/main/database/repositories/sales-history-report.repo';
import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

// Snapshot للسجلات المحاسبية فقط، وليس بيانات الكتالوج المتغيرة عمدًا.
const FINANCIAL_TABLES = [
  'purchase_invoices',
  'purchase_items',
  'purchase_returns',
  'purchase_return_items',
  'sales',
  'sale_items',
  'sale_payments',
  'sale_returns',
  'sale_return_items',
  'stock_movements',
  'cash_movements',
  'supplier_payments',
  'supplier_credit_allocations',
  'supplier_account_credit_allocations',
] as const;

function captureFinancialState(variantId: number, supplierId: number) {
  const db = getDb();
  const cost = getInventoryCostState(db, variantId);
  const report = getReportsSummary();
  const history = getSalesHistoryReport();

  return {
    ledger: Object.fromEntries(
      FINANCIAL_TABLES.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ]),
    ),
    inventory: {
      stock: cost.stock,
      average_cost: cost.average_cost,
      inventory_value: cost.inventory_value,
      // buy_price الحالي متعمد يتغير، لذلك ليس جزءًا من Snapshot.
    },
    supplier: db
      .prepare('SELECT balance, total_purchased FROM suppliers WHERE id = ?')
      .get(supplierId),
    financialReport: {
      summary: report.summary,
      topProducts: report.topProducts.map((item) => ({
        variant_id: item.variant_id,
        net_quantity: item.net_quantity,
        net_total: item.net_total,
      })),
    },
    historicalReport: {
      summary: history.summary,
      topProducts: history.topProducts.map((item) => ({
        variant_id: item.variant_id,
        net_quantity: item.net_quantity,
        net_total: item.net_total,
      })),
    },
  };
}

describe('catalog metadata financial regression', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
    openCashShift({ opening_counted_amount: 0, opened_by: 1 });
  }, 30_000);

  afterEach(() => {
    closeDb();
  });

  it('preserves purchases, sales, both returns, stock cost and profit across catalog edits', () => {
    const db = getDb();

    const created = createProduct({
      name: 'Original Regression Shirt',
      category_id: null,
      variants: [
        {
          barcode: 'REG-FIN-OLD-001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 200,
          min_stock: 0,
          opening_qty: 0,
        },
      ],
    });
    expect(created.success).toBe(true);

    const original = getVariantByBarcode('REG-FIN-OLD-001');
    expect(original).toBeDefined();
    const variantId = Number(original!.variant_id);
    const productId = Number(original!.product_id);

    const supplierId = Number(
      db
        .prepare('INSERT INTO suppliers (name, phone) VALUES (?, ?)')
        .run('Regression Supplier', '01190000001').lastInsertRowid,
    );

    // شراء 10 قطع × 100 = 1000، بدون سداد.
    const purchase = createPurchaseInvoice({
      supplier_id: supplierId,
      actor_id: 1,
      paid_amount: 0,
      items: [{ variant_id: variantId, quantity: 10, unit_cost: 100 }],
    });
    expect(purchase.total_amount).toBe(1000);

    const purchased = getPurchaseInvoice(purchase.purchaseId) as any;
    const purchaseItemId = Number(purchased.items[0].id);

    // بيع 3 قطع × 200 = 600 مع خصم فاتورة 20، الصافي 580.
    const sale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 600,
      discount_value: 20,
      grand_total: 580,
      paid: 580,
      remaining_amount: 0,
      payment_status: 'paid',
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: variantId,
          product_name: original!.product_name,
          barcode: original!.barcode,
          size: original!.size,
          color: original!.color,
          quantity: 3,
          unit_price: 200,
        },
      ],
    });

    const sold = getSaleReceipt(sale.saleId) as any;
    const saleItemId = Number(sold.items[0].id);
    expect(Number(sold.items[0].unit_cost)).toBe(100);

    // مرتجع بيع قطعة واحدة بقيمتها التاريخية، لا بسعر الكتالوج.
    const saleReturn = createSaleReturn({
      original_sale_id: sale.saleId,
      user_id: 1,
      reason: 'Regression: sale return',
      items: [{ sale_item_id: saleItemId, variant_id: variantId, quantity: 1 }],
    });
    expect(saleReturn.return_value).toBeGreaterThan(0);

    // مرتجع شراء قطعتين على حساب المورد: 200.
    const purchaseReturn = createPurchaseReturn({
      purchase_id: purchase.purchaseId,
      actor_id: 1,
      refund_mode: 'credit',
      items: [{ purchase_item_id: purchaseItemId, quantity: 2 }],
    });
    expect(purchaseReturn.total_amount).toBe(200);

    const before = captureFinancialState(variantId, supplierId);
    expect(before.inventory.stock).toBe(6); // 10 - 3 + 1 - 2
    expect(before.inventory.average_cost).toBeCloseTo(100, 8);
    expect(before.inventory.inventory_value).toBeCloseTo(600, 8);
    expect(before.financialReport.summary.net_sales).toBeGreaterThan(0);
    expect(before.financialReport.summary.normal_discounts).toBeGreaterThan(0);
    expect(before.financialReport.summary.total_returns).toBeGreaterThan(0);
    expect(before.financialReport.summary.gross_profit_before_discounts).toBe(200);
    expect((before.supplier as { balance: number }).balance).toBe(800);
    expect(before.financialReport.topProducts).toHaveLength(1);
    expect(before.financialReport.topProducts[0].net_quantity).toBe(2);
    expect(before.financialReport.topProducts[0].net_total).toBe(400);

    // تعديل الاسم + الباركود + المقاس + اللون + سعري الشراء والبيع الحاليين.
    updateProduct({
      id: productId,
      name: 'Current Regression Shirt',
      category_id: null,
      description: null,
      image_path: null,
    });
    updateVariant({
      id: variantId,
      barcode: 'REG-FIN-NEW-001',
      size: 'XL',
      color: 'Blue',
      buy_price: 175,
      sell_price: 350,
      discount_price: null,
      min_stock: 0,
      is_active: 1,
    });

    const after = captureFinancialState(variantId, supplierId);

    // لا حركة مالية أو مخزنية واحدة تغيرت، ولا أي رقم ربح أو مديونية.
    expect(after).toEqual(before);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);

    // الباركود القديم والجديد يشيران لنفس الصنف الحالي.
    const oldScan = getVariantByBarcode('REG-FIN-OLD-001');
    const newScan = getVariantByBarcode('REG-FIN-NEW-001');
    expect(oldScan?.variant_id).toBe(variantId);
    expect(newScan?.variant_id).toBe(variantId);
    expect(oldScan?.barcode).toBe('REG-FIN-NEW-001');
    expect(oldScan?.sell_price).toBe(350);
    expect(oldScan?.stock).toBe(6);
    expect(
      searchSaleVariants('REG-FIN-OLD-001').some(
        (item) => Number(item.variant_id) === variantId,
      ),
    ).toBe(true);

    // فواتير الأصل تحافظ على الهوية والسعر وقت العملية.
    const originalSale = getSaleReceipt(sale.saleId) as any;
    expect(originalSale.items[0].product_name).toBe('Original Regression Shirt');
    expect(originalSale.items[0].barcode).toBe('REG-FIN-OLD-001');
    expect(Number(originalSale.items[0].unit_price)).toBe(200);
    expect(Number(originalSale.sale.discount_value)).toBe(20);
    expect(Number(originalSale.sale.paid)).toBe(580);
    expect(Number(originalSale.items[0].unit_cost)).toBe(100);

    // عرض التفاصيل الحالية بجوار Snapshot التاريخي.
    const currentSale = getSaleCurrentState(sale.saleId) as any;
    expect(currentSale.current_receipt.items[0].product_name).toBe(
      'Current Regression Shirt',
    );
    expect(currentSale.original_receipt.items[0].product_name).toBe(
      'Original Regression Shirt',
    );

    const currentPurchase = getPurchaseInvoice(purchase.purchaseId) as any;
    expect(currentPurchase.items[0].product_name).toBe('Original Regression Shirt');
    expect(currentPurchase.items[0].current_product_name).toBe('Current Regression Shirt');
    expect(currentPurchase.items[0].current_barcode).toBe('REG-FIN-NEW-001');
    expect(currentPurchase.items[0].current_size).toBe('XL');
    expect(currentPurchase.items[0].current_color).toBe('Blue');
    expect(Number(currentPurchase.items[0].unit_cost)).toBe(100);
    expect(Number(currentPurchase.items[0].sell_price)).toBe(350);

    const saleReturnHistory = getSaleReturnHistory(sale.saleId) as any[];
    expect(saleReturnHistory[0].items[0].product_name).toBe('Original Regression Shirt');
    expect(saleReturnHistory[0].items[0].current_product_name).toBe(
      'Current Regression Shirt',
    );
    const purchaseReturnHistory = getPurchaseReturn(purchaseReturn.return_id) as any;
    expect(purchaseReturnHistory.items[0].product_name).toBe('Original Regression Shirt');
    expect(purchaseReturnHistory.items[0].current_product_name).toBe(
      'Current Regression Shirt',
    );

    const report = getReportsSummary();
    const history = getSalesHistoryReport();
    expect(report.topProducts).toHaveLength(1);
    expect(history.topProducts).toHaveLength(1);
    expect(report.topProducts[0].product_name).toBe('Current Regression Shirt');
    expect(history.topProducts[0].product_name).toBe('Current Regression Shirt');
    expect(report.topProducts[0].net_total).toBe(
      before.financialReport.topProducts[0].net_total,
    );

    // عملية جديدة بعد التعديل تُسجل الهوية الحالية، حتى لو أرسلت الواجهة اسمًا قديمًا.
    const nextSale = createSale({
      user_id: 1,
      customer_id: null,
      sub_total: 350,
      discount_value: 0,
      grand_total: 350,
      paid: 350,
      remaining_amount: 0,
      payment_status: 'paid',
      change_amount: 0,
      payment_method: 'store_cash',
      items: [
        {
          variant_id: variantId,
          product_name: 'Outdated frontend name',
          barcode: 'REG-FIN-OLD-001',
          size: 'M',
          color: 'Black',
          quantity: 1,
          unit_price: 350,
        },
      ],
    });
    const newReceipt = getSaleReceipt(nextSale.saleId) as any;
    expect(newReceipt.items[0].product_name).toBe('Current Regression Shirt');
    expect(newReceipt.items[0].barcode).toBe('REG-FIN-NEW-001');
    expect(newReceipt.items[0].size).toBe('XL');
    expect(newReceipt.items[0].color).toBe('Blue');
    expect(Number(newReceipt.items[0].unit_price)).toBe(350);
    expect(Number((getSaleReceipt(sale.saleId) as any).items[0].unit_price)).toBe(200);

    const finalReport = getReportsSummary();
    expect(finalReport.topProducts).toHaveLength(1);
    expect(finalReport.topProducts[0].net_quantity).toBe(3);
    expect(finalReport.topProducts[0].net_total).toBeCloseTo(
      before.financialReport.topProducts[0].net_total + 350,
      8,
    );
  }, 60_000);
});
