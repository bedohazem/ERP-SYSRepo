import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo'
import {
  createSale,
  createSaleReturn,
  getSaleReceipt,
} from '../../src/main/database/repositories/sales.repo'
import { createExpense } from '../../src/main/database/repositories/expense.repo'
import {
  createLiability,
  recordLiabilityPayment,
} from '../../src/main/database/repositories/liabilities.repo'
import {
  getCashierDashboardSummary,
  getReportsSummary,
} from '../../src/main/database/repositories/reports.repo'

import { createPurchaseInvoice } from '../../src/main/database/repositories/purchases.repo'

import { createSupplier } from '../../src/main/database/repositories/suppliers.repo'

import { createCashMovement } from '../../src/main/database/repositories/cash.repo'
import {
  closeCashShift,
  getOpenCashShift,
  openCashShift,
  listCashShiftVariances,
  resolveCashShiftVariance,
} from '../../src/main/database/repositories/cash-shifts.repo'
import { createUser } from '../../src/main/database/repositories/user.repo'
import {
  createSaleExchange,
  getSaleExchangeState,
} from '../../src/main/database/repositories/sales-exchange.repo'
import { recordCustomerPayment } from '../../src/main/database/repositories/customers.repo'

type ReportVariantTestRow = {
  variant_id: number
  product_id: number
  product_name: string
  barcode: string
  size: string
  color: string
  sell_price: number
  buy_price: number
  stock: number
  min_stock: number
  is_active: number
}

type CustomerTestRow = {
  id: number
  name: string
  phone: string | null
}

type ReportPaymentMethodRow = {
  payment_method: string
  count: number
  total: number
}

type ReportTopProductRow = {
  variant_id: number
  product_name: string
  size: string
  color: string
  net_quantity: number
  net_total: number
}

type ReportTopCustomerRow = {
  id: number
  name: string
  phone: string | null
  sales_count: number
  total_spent: number
}

type ReportDailySaleRow = {
  day: string
  total: number
}

type ReportLowStockRow = {
  variant_id: number
  product_name: string
  barcode: string
  size: string
  color: string
  min_stock: number
  stock: number
}

type ReportsSummaryTestResult = {
  summary: {
    sales_count: number
    returns_count: number
    gross_sales: number
    total_returns: number
    normal_discounts: number
    loyalty_discounts: number
    total_discounts: number
    net_sales: number
    gross_profit_before_discounts: number
    net_profit_after_discounts: number
    total_expenses: number
    total_liability_payments: number
    total_purchase_invoices: number
    total_manual_deposits: number
    total_manual_withdrawals: number
    final_net_profit: number
  }
  cashierSales: Array<{
    user_id: number | null

    cashier_name: string

    sales_count: number
    sales_total: number

    returns_count: number
    returns_total: number

    exchange_count: number

    exchange_adjustment: number

    net_sales: number
  }>
  topProducts: ReportTopProductRow[]
  dailySales: ReportDailySaleRow[]
  paymentMethods: ReportPaymentMethodRow[]
  lowStock: ReportLowStockRow[]
  topCustomers: ReportTopCustomerRow[]
}

function seedReportProduct(options?: {
  name?: string
  barcode?: string
  openingQty?: number
  minStock?: number
  buyPrice?: number
  sellPrice?: number
}) {
  const barcode = options?.barcode ?? 'REPORT001'

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
  })

  const variant = getVariantByBarcode(barcode) as
    | ReportVariantTestRow
    | undefined

  if (!variant) {
    throw new Error(`Failed to seed report product: ${barcode}`)
  }

  return variant
}

function createTestCustomer(name = 'Report Customer', phone = '01000000000') {
  const db = getDb()

  const result = db
    .prepare(
      `
      INSERT INTO customers (name, phone)
      VALUES (?, ?)
      `,
    )
    .run(name, phone)

  return {
    id: Number(result.lastInsertRowid),
    name,
    phone,
  } as CustomerTestRow
}

describe('reports repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()

    openCashShift({
      opening_counted_amount: 0,
      opened_by: 1,
    })
  })

  it('returns empty summary when there is no business data', () => {
    const report = getReportsSummary() as ReportsSummaryTestResult

    expect(report.summary.sales_count).toBe(0)
    expect(report.summary.returns_count).toBe(0)
    expect(report.summary.gross_sales).toBe(0)
    expect(report.summary.total_returns).toBe(0)
    expect(report.summary.net_sales).toBe(0)
    expect(report.summary.gross_profit_before_discounts).toBe(0)
    expect(report.summary.net_profit_after_discounts).toBe(0)
    expect(report.summary.total_expenses).toBe(0)
    expect(report.summary.total_liability_payments).toBe(0)
    expect(report.summary.total_purchase_invoices).toBe(0)
    expect(report.cashierSales).toHaveLength(0)
    expect(report.summary.total_manual_deposits).toBe(0)

    expect(report.summary.total_manual_withdrawals).toBe(0)
    expect(report.summary.final_net_profit).toBe(0)

    expect(report.topProducts).toHaveLength(0)
    expect(report.dailySales).toHaveLength(0)
    expect(report.paymentMethods).toHaveLength(0)
    expect(report.topCustomers).toHaveLength(0)
  })

  it('calculates sales profit discounts expenses and liability payments', () => {
    const variant = seedReportProduct({
      name: 'Report Shirt',
      barcode: 'REPORT-SHIRT',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150,
    })

    const customer = createTestCustomer()

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
    })

    createExpense({
      title: 'Report Expense',
      amount: 30,
      payment_method: 'cash',
      created_by: 1,
    })

    const liability = createLiability({
      party_name: 'Report Party',
      title: 'Report Liability',
      total_amount: 100,
      paid_amount: 0,
      actor_id: 1,
    })

    recordLiabilityPayment({
      liability_id: liability.liability_id,
      amount: 40,
      payment_method: 'cash',
      actor_id: 1,
    })

    const report = getReportsSummary() as ReportsSummaryTestResult

    expect(report.summary.sales_count).toBe(1)
    expect(report.summary.returns_count).toBe(0)

    expect(report.summary.gross_sales).toBe(280)
    expect(report.summary.normal_discounts).toBe(20)
    expect(report.summary.loyalty_discounts).toBe(0)
    expect(report.summary.total_discounts).toBe(20)
    expect(report.summary.total_returns).toBe(0)
    expect(report.summary.net_sales).toBe(280)

    expect(report.summary.gross_profit_before_discounts).toBe(100)
    expect(report.summary.net_profit_after_discounts).toBe(80)

    expect(report.summary.total_expenses).toBe(30)
    expect(report.summary.total_liability_payments).toBe(40)
    expect(report.summary.final_net_profit).toBe(50)

    expect(report.paymentMethods).toHaveLength(1)
    expect(report.paymentMethods[0].payment_method).toBe('cash')
    expect(report.paymentMethods[0].count).toBe(1)
    expect(report.paymentMethods[0].total).toBe(280)

    expect(report.topProducts).toHaveLength(1)
    expect(report.topProducts[0].product_name).toBe('Report Shirt')
    expect(report.topProducts[0].net_quantity).toBe(2)
    expect(report.topProducts[0].net_total).toBe(300)

    expect(report.topCustomers).toHaveLength(1)
    expect(report.topCustomers[0].id).toBe(customer.id)
    expect(report.topCustomers[0].name).toBe('Report Customer')
    expect(report.topCustomers[0].sales_count).toBe(1)
    expect(report.topCustomers[0].total_spent).toBe(280)

    expect(report.dailySales.length).toBeGreaterThanOrEqual(1)
    expect(report.dailySales[0].total).toBe(280)
  })

  it('subtracts returns from sales totals top products and customers', () => {
    const variant = seedReportProduct({
      name: 'Return Report Product',
      barcode: 'REPORT-RETURN',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150,
    })

    const customer = createTestCustomer('Return Customer', '01011111111')

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
    })

    const receipt = getSaleReceipt(sale.saleId) as any
    const saleItemId = receipt.items[0].id

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
    })

    const report = getReportsSummary() as ReportsSummaryTestResult

    expect(report.summary.sales_count).toBe(1)
    expect(report.summary.returns_count).toBe(1)

    expect(report.summary.gross_sales).toBe(300)
    expect(report.summary.total_returns).toBe(150)
    expect(report.summary.net_sales).toBe(150)

    expect(report.summary.gross_profit_before_discounts).toBe(50)
    expect(report.summary.net_profit_after_discounts).toBe(50)

    expect(report.topProducts).toHaveLength(1)
    expect(report.topProducts[0].product_name).toBe('Return Report Product')
    expect(report.topProducts[0].net_quantity).toBe(1)
    expect(report.topProducts[0].net_total).toBe(150)

    expect(report.topCustomers).toHaveLength(1)
    expect(report.topCustomers[0].name).toBe('Return Customer')
    expect(report.topCustomers[0].sales_count).toBe(1)
    expect(report.topCustomers[0].total_spent).toBe(150)

    expect(report.dailySales.length).toBeGreaterThanOrEqual(1)
    expect(report.dailySales[0].total).toBe(150)
  })

  it('reports low stock items', () => {
    seedReportProduct({
      name: 'Low Stock Report Product',
      barcode: 'REPORT-LOW',
      openingQty: 3,
      minStock: 5,
      buyPrice: 100,
      sellPrice: 150,
    })

    seedReportProduct({
      name: 'Available Stock Report Product',
      barcode: 'REPORT-AVAILABLE',
      openingQty: 20,
      minStock: 5,
      buyPrice: 100,
      sellPrice: 150,
    })

    const report = getReportsSummary() as ReportsSummaryTestResult

    expect(report.lowStock.some((item) => item.barcode === 'REPORT-LOW')).toBe(
      true,
    )
    expect(
      report.lowStock.some((item) => item.barcode === 'REPORT-AVAILABLE'),
    ).toBe(false)
  })

  it('filters reports by date range', () => {
    const variant = seedReportProduct({
      name: 'Date Filter Product',
      barcode: 'REPORT-DATE',
      openingQty: 20,
      buyPrice: 100,
      sellPrice: 150,
    })

    const now = new Date()
    const reportDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')

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
    })

    const todayReport = getReportsSummary({
      date_from: reportDate,
      date_to: reportDate,
    }) as ReportsSummaryTestResult

    const futureReport = getReportsSummary({
      date_from: '2099-01-01',
      date_to: '2099-01-31',
    }) as ReportsSummaryTestResult

    expect(todayReport.summary.sales_count).toBe(1)
    expect(todayReport.summary.gross_sales).toBe(150)

    expect(futureReport.summary.sales_count).toBe(0)
    expect(futureReport.summary.gross_sales).toBe(0)
    expect(futureReport.topProducts).toHaveLength(0)
    expect(futureReport.dailySales).toHaveLength(0)
  })

  it('reports purchase invoices and manual cash movements', () => {
    const variant = seedReportProduct({
      name: 'Purchase Report Product',

      barcode: 'REPORT-PURCHASE',

      openingQty: 0,

      buyPrice: 100,

      sellPrice: 150,
    })

    const supplier = createSupplier({
      name: 'Report Supplier',
    }) as any

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
    })

    createCashMovement({
      type: 'deposit',

      direction: 'in',

      amount: 500,

      payment_method: 'store_cash',

      reference_type: 'manual',

      notes: 'Manual report deposit',

      created_by: 1,
    })

    createCashMovement({
      type: 'withdraw',

      direction: 'out',

      amount: 120,

      payment_method: 'store_cash',

      reference_type: 'manual',

      notes: 'Manual report withdrawal',

      created_by: 1,
    })

    const report = getReportsSummary() as ReportsSummaryTestResult

    expect(report.summary.total_purchase_invoices).toBe(240)

    expect(report.summary.total_manual_deposits).toBe(500)

    expect(report.summary.total_manual_withdrawals).toBe(120)
  })
  it('groups monthly sales by cashier', () => {
    const variant = seedReportProduct({
      name: 'Cashier Monthly Product',

      barcode: 'CASHIER-MONTHLY',

      openingQty: 50,

      buyPrice: 50,

      sellPrice: 100,
    })

    const secondUser = createUser(
      'Second Cashier',

      'second_cashier_report',

      '1234',

      /*
       * Admin هنا فقط لتسهيل
       * تشغيل الـrepository test
       * على نفس الشفت المفتوح.
       */
      'admin',
    )

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
    })

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
    })

    const db = getDb()

    db.prepare(
      `
      UPDATE sales
      SET business_date = ?
      WHERE id = ?
      `,
    ).run('2026-09-05', firstSale.saleId)

    db.prepare(
      `
      UPDATE sales
      SET business_date = ?
      WHERE id = ?
      `,
    ).run('2026-09-06', secondSale.saleId)

    const report = getReportsSummary({
      date_from: '2026-09-01',

      date_to: '2026-09-30',
    }) as ReportsSummaryTestResult

    expect(report.cashierSales).toHaveLength(2)

    const first = report.cashierSales.find((row) => Number(row.user_id) === 1)

    const second = report.cashierSales.find(
      (row) => Number(row.user_id) === Number(secondUser.id),
    )

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()

    expect(first?.sales_count).toBe(1)

    expect(first?.sales_total).toBe(100)

    expect(first?.net_sales).toBe(100)

    expect(second?.sales_count).toBe(1)

    expect(second?.sales_total).toBe(200)

    expect(second?.net_sales).toBe(200)
  })

  it('removes returned invoice discounts from the active shift dashboard even when another admin creates the return', () => {
    const variant = seedReportProduct({
      name: 'Cashier Discount Return',

      barcode: 'CASHIER-DISCOUNT-RETURN',

      openingQty: 20,

      buyPrice: 100,

      sellPrice: 200,
    })

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
    })

    const receipt = getSaleReceipt(sale.saleId) as any

    /*
     * مستخدم Admin آخر
     * ينفذ المرتجع،
     * لكن العملية نفسها تحدث
     * داخل نفس الشفت المفتوح.
     */
    const secondAdmin = createUser(
      'Return Admin',

      'return_admin',

      '1234',

      'admin',
    )

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
    })

    const dashboard = getCashierDashboardSummary({
      user_id: 1,
    })

    expect(dashboard.sales.invoice_sales).toBe(150)

    expect(dashboard.sales.returns_total).toBe(150)

    expect(dashboard.sales.net_sales).toBe(0)

    expect(dashboard.discounts.normal).toBe(0)

    expect(dashboard.discounts.total).toBe(0)

    expect(dashboard.sales.returns_count).toBe(1)
  })

  it('separates exchange invoice adjustment from cash refund when the sale has debt', () => {
    const oldVariant = seedReportProduct({
      name: 'Old Debt Exchange Product',

      barcode: 'REPORT-EX-DEBT-OLD',

      openingQty: 10,

      buyPrice: 200,

      sellPrice: 450,
    })

    const newVariant = seedReportProduct({
      name: 'New Debt Exchange Product',

      barcode: 'REPORT-EX-DEBT-NEW',

      openingQty: 10,

      buyPrice: 10,

      sellPrice: 20,
    })

    const customer = createTestCustomer(
      'Exchange Debt Customer',

      '01099999999',
    )

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
    })

    const state = getSaleExchangeState(sale.saleId)

    const regularGroup = state.groups.find(
      (group: any) => group.group_kind === 'regular',
    )

    expect(regularGroup).toBeTruthy()

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
    })

    /*
     * قيمة الفاتورة نزلت
     * من 450 إلى 20.
     */
    expect(exchange.difference_amount).toBe(-430)

    /*
     * المديونية القديمة 250
     * يتم إلغاؤها أولًا.
     */
    expect(exchange.debt_reduction_amount).toBe(250)

    /*
     * العميل دفع 200،
     * وأخذ منتج بـ20،
     * إذن الرد النقدي 180.
     */
    expect(exchange.amount_to_refund).toBe(180)

    const db = getDb()

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
      day: string
    }

    const dashboard = getCashierDashboardSummary({
      user_id: 1,
    })

    expect(dashboard.sales.invoice_sales).toBe(450)

    expect(dashboard.sales.exchange_adjustment).toBe(-430)

    expect(dashboard.sales.exchange_debt_reduction).toBe(250)

    expect(dashboard.sales.exchange_cash_refund).toBe(180)

    expect(dashboard.sales.exchange_cash_difference).toBe(-180)

    expect(dashboard.sales.net_sales).toBe(20)
  })

  it('shows customer payment total and counted shift opening on cashier dashboard', () => {
    const variant = seedReportProduct({
      name: 'Dashboard Payment Product',

      barcode: 'DASH-PAYMENT',

      openingQty: 20,

      buyPrice: 100,

      sellPrice: 500,
    })

    const customer = createTestCustomer(
      'Dashboard Payment Customer',

      '01088888888',
    )

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
    })

    recordCustomerPayment({
      customer_id: customer.id,

      sale_id: sale.saleId,

      amount: 125,

      payment_method: 'cash',

      actor_id: 1,
    })

    const db = getDb()

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
    ).run()

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
      day: string
    }

    const dashboard = getCashierDashboardSummary({
      user_id: 1,
    })

    expect(dashboard.operations.customer_payments_count).toBe(1)

    expect(dashboard.operations.customer_payments_total).toBe(125)

    expect(dashboard.shift).toBeTruthy()

    expect(dashboard.shift?.opening_counted_amount).toBe(350)

    expect(dashboard.shift?.status).toBe('open')
  })

  it('resets the cashier dashboard when a new shift starts', () => {
    const variant = seedReportProduct({
      name: 'Shift Dashboard Product',

      barcode: 'SHIFT-DASHBOARD',

      openingQty: 20,

      buyPrice: 50,

      sellPrice: 100,
    })

    /*
     * beforeEach فتح بالفعل
     * الشفت الأول للمستخدم 1.
     */
    const firstShift = getOpenCashShift()

    expect(firstShift).toBeTruthy()

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
    })

    const firstDashboard = getCashierDashboardSummary({
      user_id: 1,
    })

    expect(firstDashboard.shift?.id).toBe(firstShift!.id)

    expect(firstDashboard.sales.invoice_sales).toBe(100)

    closeCashShift({
      shift_id: firstShift!.id,

      closing_counted_amount: 100,
      left_for_next_shift: 0,

      closed_by: 1,
    })

    const secondCashier = createUser(
      'Second Shift Cashier',

      'second_shift_cashier',

      '1234',

      /*
       * Admin في التست فقط
       * لتجنب قيود تشغيلية
       * ليست موضوع الاختبار.
       */
      'admin',
    )

    const secondShift = openCashShift({
      opening_counted_amount: 75,

      opened_by: secondCashier.id,
    })

    /*
     * بمجرد فتح شفت جديد:
     * Dashboard تبدأ من صفر.
     */
    const emptySecondDashboard = getCashierDashboardSummary({
      user_id: secondCashier.id,
    })

    expect(emptySecondDashboard.shift?.id).toBe(secondShift.id)

    expect(emptySecondDashboard.shift?.opening_counted_amount).toBe(75)

    expect(emptySecondDashboard.sales.invoice_sales).toBe(0)

    expect(emptySecondDashboard.sales.invoices_count).toBe(0)

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
    })

    const secondDashboard = getCashierDashboardSummary({
      user_id: secondCashier.id,
    })

    expect(secondDashboard.shift?.id).toBe(secondShift.id)

    expect(secondDashboard.sales.invoice_sales).toBe(200)

    expect(secondDashboard.sales.invoices_count).toBe(1)

    /*
     * مبيعات الشفت الأول
     * لم تنتقل للشفت الثاني.
     */
    expect(secondDashboard.sales.invoice_sales).not.toBe(300)

    /*
     * صاحب الشفت القديم لا يرى
     * بياناته القديمة في Dashboard
     * بعد انتهاء شفته.
     */
    const oldCashierDashboard = getCashierDashboardSummary({
      user_id: 1,
    })

    expect(oldCashierDashboard.shift).toBeNull()

    expect(oldCashierDashboard.sales.invoice_sales).toBe(0)
  })

  it('shows paid sales and outstanding debt for active shift invoices', () => {
    const variant = seedReportProduct({
      name: 'Shift Credit Sale',

      barcode: 'SHIFT-CREDIT-SALE',

      openingQty: 20,

      buyPrice: 100,

      sellPrice: 300,
    })

    const customer = createTestCustomer(
      'Credit Customer',

      '01077777777',
    )

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
    })

    let dashboard = getCashierDashboardSummary({
      user_id: 1,
    })

    expect(dashboard.sales.invoice_sales).toBe(300)

    expect(dashboard.sales.paid_sales_total).toBe(150)

    expect(dashboard.sales.outstanding_debt_total).toBe(150)

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(1)

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
    })

    dashboard = getCashierDashboardSummary({
      user_id: 1,
    })

    expect(dashboard.sales.paid_sales_total).toBe(200)

    expect(dashboard.sales.outstanding_debt_total).toBe(100)

    expect(dashboard.sales.outstanding_debt_invoices_count).toBe(1)
  })

  it('keeps shift operations on the shift opening business date', () => {
    const db = getDb()

    const shift = getOpenCashShift()!

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
          '2020-01-15 20:00:00'

      WHERE id = ?
      `,
    ).run(shift.id)

    const shiftDate = db
      .prepare(
        `
        SELECT
          date(
            opened_at,
            'localtime'
          ) AS day

        FROM cash_shifts

        WHERE id = ?
        `,
      )
      .get(shift.id) as {
      day: string
    }

    const variant = seedReportProduct({
      name: 'Shift Date Product',

      barcode: 'SHIFT-DATE-PRODUCT',

      openingQty: 20,

      buyPrice: 50,

      sellPrice: 100,
    })

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
    })

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
      business_date: string
      shift_id: number
    }

    expect(saleRow.shift_id).toBe(shift.id)

    expect(saleRow.business_date).toBe(shiftDate.day)

    const receipt = getSaleReceipt(sale.saleId) as any

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
    })

    createExpense({
      title: 'Shift date expense',

      amount: 10,

      payment_method: 'cash',

      created_by: 1,
    })

    const report = getReportsSummary({
      date_from: shiftDate.day,

      date_to: shiftDate.day,
    }) as ReportsSummaryTestResult

    expect(report.summary.sales_count).toBe(1)

    expect(report.summary.gross_sales).toBe(200)

    expect(report.summary.returns_count).toBe(1)

    expect(report.summary.total_returns).toBe(100)

    expect(report.summary.total_expenses).toBe(10)

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
              'expense'
            )
        `,
      )
      .all(shift.id) as Array<{
      business_date: string
    }>

    expect(movements.length).toBeGreaterThan(0)

    expect(
      movements.every((movement) => movement.business_date === shiftDate.day),
    ).toBe(true)
  })

  it('includes approved closing surplus in final net profit', () => {
    const shift = getOpenCashShift()

    expect(shift).toBeTruthy()

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 100,
      payment_method: 'store_cash',
      created_by: 1,
      shift_id: shift!.id,
    })

    closeCashShift({
      shift_id: shift!.id,
      closing_counted_amount: 150,
      left_for_next_shift: 0,
      closed_by: 1,
    })

    const variance = listCashShiftVariances({
      status: 'pending',
    }).rows.find((row) => row.shift_id === shift!.id && row.stage === 'closing')

    expect(variance).toBeTruthy()
    expect(variance!.kind).toBe('surplus')
    expect(Number(variance!.amount)).toBe(50)

    resolveCashShiftVariance({
      variance_id: variance!.id,
      resolution_type: 'approved',
      resolution_notes: 'زيادة إغلاق حقيقية',
      resolved_by: 1,
    })

    const report = getReportsSummary()

    expect(report.summary.approved_closing_surplus).toBe(50)
    expect(report.summary.approved_closing_shortage).toBe(0)
    expect(report.summary.final_net_profit).toBe(50)
  })
})
