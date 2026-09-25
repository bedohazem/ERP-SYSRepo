import { getDb } from '../db'

type ReportFilter = {
  date_from?: string
  date_to?: string
  user_id?: number
}

export type CashierDashboardInput = {
  user_id: number
}

function reportMoney(value: unknown) {
  return Number(Number(value || 0).toFixed(2))
}

function buildWhere(
  alias: string,
  input?: ReportFilter,
  extra: string[] = [],
  userColumn?: string,
  dateExpression?: string,
) {
  const where: string[] = [...extra]
  const params: any[] = []

  const dateExpr = dateExpression || `date(${alias}.created_at, 'localtime')`

  if (input?.date_from) {
    where.push(`${dateExpr} >= ?`)
    params.push(input.date_from)
  }

  if (input?.date_to) {
    where.push(`${dateExpr} <= ?`)
    params.push(input.date_to)
  }

  if (input?.user_id && userColumn) {
    where.push(`${userColumn} = ?`)
    params.push(Number(input.user_id))
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  }
}

const CASH_ACCOUNT_ORDER = `
  CASE account
    WHEN 'store_cash' THEN 1
    WHEN 'owner_cash' THEN 2
    WHEN 'owner_bank' THEN 3
    WHEN 'owner_vodafone' THEN 4
    WHEN 'fawry_machine' THEN 5
    ELSE 99
  END
`

function getCashAccountLabel(account: string) {
  switch (account) {
    case 'store_cash':
      return 'كاش درج المحل'
    case 'owner_cash':
      return 'كاش مع المالك'
    case 'owner_bank':
      return 'حساب بنك / فيزا المالك'
    case 'owner_vodafone':
      return 'فودافون كاش المالك'
    case 'fawry_machine':
      return 'ماكينة فوري'
    default:
      return account || 'غير محدد'
  }
}

export function getReportsSummary(input?: ReportFilter) {
  const db = getDb()

  const saleBusinessDate: string = `
    COALESCE(
      (
        SELECT
          date(
            cs.opened_at,
            'localtime'
          )

        FROM cash_shifts cs

        WHERE
          cs.id = s.shift_id
      ),

      NULLIF(
        s.business_date,
        ''
      ),

      date(
        s.created_at,
        'localtime'
      )
    )
  `

  const returnBusinessDate: string = `
    COALESCE(
      (
        SELECT
          date(
            cs.opened_at,
            'localtime'
          )

        FROM cash_shifts cs

        WHERE
          cs.id = sr.shift_id
      ),

      date(
        sr.created_at,
        'localtime'
      )
    )
  `

  const exchangeBusinessDate: string = `
    COALESCE(
      (
        SELECT
          date(
            cs.opened_at,
            'localtime'
          )

        FROM cash_shifts cs

        WHERE
          cs.id = se.shift_id
      ),

      NULLIF(
        se.business_date,
        ''
      ),

      date(
        se.created_at,
        'localtime'
      )
    )
  `

  const expenseBusinessDate: string = `
    COALESCE(
      (
        SELECT
          date(
            cs.opened_at,
            'localtime'
          )

        FROM cash_shifts cs

        WHERE
          cs.id = e.shift_id
      ),

      date(
        e.created_at,
        'localtime'
      )
    )
  `

  const cancelledSaleBusinessDate: string = `
    COALESCE(
      (
        SELECT
          date(
            cs.opened_at,
            'localtime'
          )

        FROM cash_shifts cs

        WHERE
          cs.id =
            s.cancelled_shift_id
      ),

      date(
        s.cancelled_at,
        'localtime'
      )
    )
  `

  const cancelledReturnBusinessDate: string = `
    COALESCE(
      (
        SELECT
          date(
            cs.opened_at,
            'localtime'
          )

        FROM cash_shifts cs

        WHERE
          cs.id =
            sr.cancelled_shift_id
      ),

      date(
        sr.cancelled_at,
        'localtime'
      )
    )
  `

  const salesWhere = buildWhere(
    's',
    input,
    [`IFNULL(s.type, 'sale') = 'sale'`, `s.cancelled_at IS NULL`],
    's.user_id',
    saleBusinessDate,
  )

  const returnsWhere = buildWhere(
    'sr',
    input,
    [
      `IFNULL(os.type, 'sale') = 'sale'`,
      `os.cancelled_at IS NULL`,
      `sr.cancelled_at IS NULL`,
    ],
    'sr.user_id',
    returnBusinessDate,
  )

  const exchangesWhere = buildWhere(
    'se',
    input,
    [
      `IFNULL(os.type, 'sale') = 'sale'`,
      `os.cancelled_at IS NULL`,
      `se.cancelled_at IS NULL`,
    ],
    'se.user_id',
    exchangeBusinessDate,
  )

  const cancelledSalesWhere = buildWhere(
    's',
    input,
    [`IFNULL(s.type, 'sale') = 'sale'`, `s.cancelled_at IS NOT NULL`],
    's.user_id',
    cancelledSaleBusinessDate,
  )

  const cancelledReturnsWhere = buildWhere(
    'sr',
    input,
    [`sr.cancelled_at IS NOT NULL`],
    'sr.user_id',
    cancelledReturnBusinessDate,
  )

  const combinedWhere = buildWhere(
    'x',
    input,
    [],
    'x.user_id',
    'x.business_date',
  )

  const salesSummary = db
    .prepare(
      `
      SELECT
        COUNT(*) AS sales_count,
        IFNULL(SUM(s.grand_total), 0) AS gross_sales,
        IFNULL(
          SUM(s.discount_value),
          0
        ) AS normal_discounts,

        IFNULL(
          SUM(
            s.promotion_discount_value
          ),
          0
        ) AS promotion_discounts,

        IFNULL(
          SUM(
            s.loyalty_discount_value
          ),
          0
        ) AS loyalty_discounts,

        IFNULL(
          SUM(
            s.discount_value
            + IFNULL(
                s.promotion_discount_value,
                0
              )
            + s.loyalty_discount_value
          ),
          0
        ) AS total_discounts
      FROM sales s
      ${salesWhere.whereSql}
    `,
    )
    .get(...salesWhere.params) as any

  const returnsSummary = db
    .prepare(
      `
    SELECT
      COUNT(*) AS returns_count,

      IFNULL(
        SUM(sr.refund_amount),
        0
      ) AS total_returns,

      IFNULL(
        SUM(
          CASE
            WHEN
              sr.normal_discount_value
              IS NOT NULL
            THEN
              sr.normal_discount_value

            ELSE MAX(
              0,
              sr.sub_total
              - sr.refund_amount
              - IFNULL(
                  sr.loyalty_discount_value,
                  0
                )
              - IFNULL(
                  sr.promotion_discount_value,
                  0
                )
            )
          END
        ),
        0
      ) AS returned_normal_discounts,

      IFNULL(
        SUM(
          IFNULL(
            sr.promotion_discount_value,
            0
          )
        ),
        0
      ) AS returned_promotion_discounts,

      IFNULL(
        SUM(sr.loyalty_discount_value),
        0
      ) AS returned_loyalty_discounts

    FROM sale_returns sr

    JOIN sales os
      ON os.id = sr.original_sale_id

    ${returnsWhere.whereSql}
  `,
    )
    .get(...returnsWhere.params) as any

  const exchangeSummary = db
    .prepare(
      `
      SELECT
        COUNT(*) AS exchange_count,

        IFNULL(
          SUM(
            se.difference_amount
          ),
          0
        ) AS exchange_adjustment,

        IFNULL(
          SUM(
            se.cash_collection_amount
          ),
          0
        ) AS exchange_cash_collection,

        IFNULL(
          SUM(
            se.cash_refund_amount
          ),
          0
        ) AS exchange_cash_refund,

        IFNULL(
          SUM(
            se.debt_reduction_amount
          ),
          0
        ) AS exchange_debt_reduction,

        IFNULL(
          SUM(
            COALESCE(
              se.new_normal_discount_value,
              se.old_normal_discount_value,
              0
            )
            -
            COALESCE(
              se.old_normal_discount_value,
              0
            )
          ),
          0
        ) AS normal_discount_adjustment,

        IFNULL(
          SUM(
            COALESCE(
              se.new_promotion_discount_value,
              se.old_promotion_discount_value,
              0
            )
            -
            COALESCE(
              se.old_promotion_discount_value,
              0
            )
          ),
          0
        ) AS promotion_discount_adjustment,

        IFNULL(
          SUM(
            COALESCE(
              se.new_loyalty_discount_value,
              se.old_loyalty_discount_value,
              0
            )
            -
            COALESCE(
              se.old_loyalty_discount_value,
              0
            )
          ),
          0
        ) AS loyalty_discount_adjustment

      FROM sale_exchanges se

      JOIN sales os
        ON
          os.id =
            se.original_sale_id

      ${exchangesWhere.whereSql}
      `,
    )
    .get(...exchangesWhere.params) as any

  const cancelledSalesRow = db
    .prepare(
      `
    SELECT COUNT(*) AS cancelled_sales_count
    FROM sales s
    ${cancelledSalesWhere.whereSql}
    `,
    )
    .get(...cancelledSalesWhere.params) as any

  const cancelledReturnsRow = db
    .prepare(
      `
    SELECT COUNT(*) AS cancelled_returns_count
    FROM sale_returns sr
    ${cancelledReturnsWhere.whereSql}
    `,
    )
    .get(...cancelledReturnsWhere.params) as any

  const salesProfitRow = db
    .prepare(
      `
      SELECT
        IFNULL(SUM(x.items_profit_before_discount), 0) AS gross_profit_before_discounts,
        IFNULL(SUM(
          x.items_profit_before_discount
          - x.normal_discount
          - x.promotion_discount
          - x.loyalty_discount
        ), 0) AS net_profit_after_discounts
      FROM (
        SELECT
          s.id,
          IFNULL(s.discount_value, 0) AS normal_discount,
          IFNULL(
            s.promotion_discount_value,
            0
          ) AS promotion_discount,
          IFNULL(s.loyalty_discount_value, 0) AS loyalty_discount,
          IFNULL(SUM(si.unit_cost * si.quantity), 0) AS total_cost,
          IFNULL(SUM((si.unit_price - si.unit_cost) * si.quantity), 0) AS items_profit_before_discount
        FROM sales s
        JOIN sale_items si ON si.sale_id = s.id
        ${salesWhere.whereSql}
        GROUP BY s.id
      ) x
    `,
    )
    .get(...salesWhere.params) as any

  const returnsProfitRow = db
    .prepare(
      `
    SELECT
      IFNULL(
        SUM(x.items_profit_before_discount),
        0
      ) AS returned_profit_before_discounts,

      IFNULL(
        SUM(x.refund_amount - x.total_cost),
        0
      ) AS returned_profit_after_discounts

    FROM (
      SELECT
        sr.id,
        sr.refund_amount,

        IFNULL(
          SUM(sri.unit_cost * sri.quantity),
          0
        ) AS total_cost,

        IFNULL(
          SUM(
            (sri.unit_price - sri.unit_cost) * sri.quantity
          ),
          0
        ) AS items_profit_before_discount

      FROM sale_returns sr

      JOIN sales os
        ON os.id = sr.original_sale_id

      JOIN sale_return_items sri
        ON sri.return_id = sr.id

      ${returnsWhere.whereSql}

      GROUP BY sr.id
    ) x
  `,
    )
    .get(...returnsWhere.params) as any

  const exchangeProfitRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            IFNULL(
              x.price_delta,
              0
            )
          ),
          0
        ) AS gross_price_adjustment,

        IFNULL(
          SUM(
            IFNULL(
              x.price_delta,
              0
            )
            -
            IFNULL(
              x.cost_delta,
              0
            )
          ),
          0
        ) AS gross_profit_adjustment,

        IFNULL(
          SUM(
            se.difference_amount
            -
            IFNULL(
              x.cost_delta,
              0
            )
          ),
          0
        ) AS net_profit_adjustment

      FROM sale_exchanges se

      JOIN sales os
        ON
          os.id =
            se.original_sale_id

      LEFT JOIN (
        SELECT
          sei.exchange_id,

          IFNULL(
            SUM(
              (
                sei.new_unit_price
                -
                sei.old_unit_price
              )
              *
              sei.quantity
            ),
            0
          ) AS price_delta,

          IFNULL(
            SUM(
              (
                COALESCE(
                  sei.new_unit_cost,
                  0
                )
                -
                COALESCE(
                  sei.old_unit_cost,
                  0
                )
              )
              *
              sei.quantity
            ),
            0
          ) AS cost_delta

        FROM sale_exchange_items sei
        
        GROUP BY
          sei.exchange_id
      ) x
        ON
          x.exchange_id =
            se.id

      ${exchangesWhere.whereSql}
      `,
    )
    .get(...exchangesWhere.params) as any

  const exchangeAdjustment = Number(exchangeSummary.exchange_adjustment || 0)

  const grossPriceAdjustment = Number(
    exchangeProfitRow.gross_price_adjustment || 0,
  )

  const exchangeDiscountAdjustment = grossPriceAdjustment - exchangeAdjustment

  const grossSales = Number(salesSummary.gross_sales || 0) + exchangeAdjustment

  const totalReturns = Number(returnsSummary.total_returns || 0)

  const normalDiscounts = Math.max(
    0,

    Number(salesSummary.normal_discounts || 0) -
      Number(returnsSummary.returned_normal_discounts || 0) +
      Number(exchangeSummary.normal_discount_adjustment || 0),
  )

  const promotionDiscounts = Math.max(
    0,

    Number(salesSummary.promotion_discounts || 0) -
      Number(returnsSummary.returned_promotion_discounts || 0) +
      Number(exchangeSummary.promotion_discount_adjustment || 0),
  )

  const loyaltyDiscounts = Math.max(
    0,

    Number(salesSummary.loyalty_discounts || 0) -
      Number(returnsSummary.returned_loyalty_discounts || 0) +
      Number(exchangeSummary.loyalty_discount_adjustment || 0),
  )

  const returnedDiscounts =
    Number(returnsSummary.returned_normal_discounts || 0) +
    Number(returnsSummary.returned_promotion_discounts || 0) +
    Number(returnsSummary.returned_loyalty_discounts || 0)

  const totalDiscounts = Math.max(
    0,

    Number(salesSummary.total_discounts || 0) -
      returnedDiscounts +
      exchangeDiscountAdjustment,
  )

  const grossProfitBeforeDiscounts =
    Number(salesProfitRow.gross_profit_before_discounts || 0) -
    Number(returnsProfitRow.returned_profit_before_discounts || 0) +
    Number(exchangeProfitRow.gross_profit_adjustment || 0)

  const netProfitAfterDiscounts =
    Number(salesProfitRow.net_profit_after_discounts || 0) -
    Number(returnsProfitRow.returned_profit_after_discounts || 0) +
    Number(exchangeProfitRow.net_profit_adjustment || 0)

  const expensesWhere = buildWhere(
    'e',
    input,
    [`e.cancelled_at IS NULL`],
    undefined,
    expenseBusinessDate,
  )

  const liabilityPaymentsWhere = buildWhere('p', input, [
    `p.cancelled_at IS NULL`,
  ])

  const purchasesWhere = buildWhere(
    'pi',
    input,
    [`pi.cancelled_at IS NULL`, `IFNULL(pi.status, 'active') <> 'cancelled'`],
    undefined,
    `date(pi.created_at, 'localtime')`,
  )

  const manualCashWhere = buildWhere(
    'cm',
    input,
    [
      `cm.cancelled_at IS NULL`,
      `cm.reference_type = 'manual'`,
      `cm.type IN ('deposit', 'withdraw')`,
    ],
    'cm.created_by',
    `COALESCE(
    NULLIF(cm.business_date, ''),
    date(cm.created_at, 'localtime')
  )`,
  )

  const closingVarianceWhere = buildWhere(
    'csv',
    input,
    [
      `csv.stage = 'closing'`,
      `csv.status = 'resolved'`,
      `csv.resolution_type = 'approved'`,
    ],
    'cs.opened_by',
    `date(cs.opened_at, 'localtime')`,
  )

  const openingVarianceWhere = buildWhere(
    'csv',
    input,
    [
      `csv.stage = 'opening'`,
      `csv.status = 'resolved'`,
      `csv.resolution_type = 'approved'`,
    ],
    'cs.opened_by',
    `date(cs.opened_at, 'localtime')`,
  )

  const expensesRow = db
    .prepare(
      `
      SELECT IFNULL(SUM(e.amount), 0) AS total_expenses
      FROM expenses e
      ${expensesWhere.whereSql}
    `,
    )
    .get(...expensesWhere.params) as any

  const liabilityPaymentsRow = db
    .prepare(
      `
      SELECT IFNULL(SUM(p.amount), 0) AS total_liability_payments
      FROM store_liability_payments p
      ${liabilityPaymentsWhere.whereSql}
    `,
    )
    .get(...liabilityPaymentsWhere.params) as any

  const purchasesRow = db
    .prepare(
      `
    SELECT
      IFNULL(
        SUM(pi.total_amount),
        0
      ) AS total_purchase_invoices

    FROM purchase_invoices pi

    ${purchasesWhere.whereSql}
    `,
    )
    .get(...purchasesWhere.params) as {
    total_purchase_invoices: number
  }

  const manualCashRow = db
    .prepare(
      `
    SELECT
      IFNULL(
        SUM(
          CASE
            WHEN cm.type = 'deposit'
              AND cm.direction = 'in'
            THEN cm.amount
            ELSE 0
          END
        ),
        0
      ) AS total_manual_deposits,

      IFNULL(
        SUM(
          CASE
            WHEN cm.type = 'withdraw'
              AND cm.direction = 'out'
            THEN cm.amount
            ELSE 0
          END
        ),
        0
      ) AS total_manual_withdrawals

    FROM cash_movements cm

    ${manualCashWhere.whereSql}
    `,
    )
    .get(...manualCashWhere.params) as {
    total_manual_deposits: number
    total_manual_withdrawals: number
  }

  const closingVarianceRow = db
    .prepare(
      `
    SELECT
      IFNULL(
        SUM(
          CASE
            WHEN csv.kind = 'surplus'
            THEN csv.amount
            ELSE 0
          END
        ),
        0
      ) AS approved_closing_surplus,

      IFNULL(
        SUM(
          CASE
            WHEN csv.kind = 'shortage'
            THEN csv.amount
            ELSE 0
          END
        ),
        0
      ) AS approved_closing_shortage

    FROM cash_shift_variances csv

    JOIN cash_shifts cs
      ON cs.id = csv.shift_id

    ${closingVarianceWhere.whereSql}
    `,
    )
    .get(...closingVarianceWhere.params) as {
    approved_closing_surplus: number
    approved_closing_shortage: number
  }

  const openingVarianceRow = db
    .prepare(
      `
    SELECT
      IFNULL(
        SUM(
          CASE
            WHEN csv.kind = 'surplus'
            THEN csv.amount
            ELSE 0
          END
        ),
        0
      ) AS approved_opening_surplus,

      IFNULL(
        SUM(
          CASE
            WHEN csv.kind = 'shortage'
            THEN csv.amount
            ELSE 0
          END
        ),
        0
      ) AS approved_opening_shortage

    FROM cash_shift_variances csv

    JOIN cash_shifts cs
      ON cs.id = csv.shift_id

    ${openingVarianceWhere.whereSql}
    `,
    )
    .get(...openingVarianceWhere.params) as {
    approved_opening_surplus: number
    approved_opening_shortage: number
  }

  const totalExpenses = Number(expensesRow.total_expenses || 0)
  const totalLiabilityPayments = Number(
    liabilityPaymentsRow.total_liability_payments || 0,
  )

  const totalPurchaseInvoices = Number(
    purchasesRow.total_purchase_invoices || 0,
  )

  const totalManualDeposits = Number(manualCashRow.total_manual_deposits || 0)

  const totalManualWithdrawals = Number(
    manualCashRow.total_manual_withdrawals || 0,
  )

  const approvedClosingSurplus = Number(
    closingVarianceRow.approved_closing_surplus || 0,
  )

  const approvedClosingShortage = Number(
    closingVarianceRow.approved_closing_shortage || 0,
  )

  const approvedOpeningSurplus = Number(
    openingVarianceRow.approved_opening_surplus || 0,
  )

  const approvedOpeningShortage = Number(
    openingVarianceRow.approved_opening_shortage || 0,
  )

  const finalNetProfit =
    netProfitAfterDiscounts -
    totalExpenses +
    approvedClosingSurplus -
    approvedClosingShortage +
    approvedOpeningSurplus -
    approvedOpeningShortage

  const topProducts = db
    .prepare(
      `
      SELECT
        x.variant_id,
        x.product_name,
        x.size,
        x.color,

        IFNULL(
          SUM(x.quantity),
          0
        ) AS net_quantity,

        IFNULL(
          SUM(x.total),
          0
        ) AS net_total

      FROM (
        SELECT
          si.variant_id,
          si.product_name,
          si.size,
          si.color,

          si.quantity
            AS quantity,

          si.line_total
            AS total,

          ${saleBusinessDate}
            AS business_date,

          s.user_id

        FROM sale_items si

        JOIN sales s
          ON
            s.id =
              si.sale_id

        WHERE
          IFNULL(
            s.type,
            'sale'
          ) = 'sale'

          AND
            s.cancelled_at
            IS NULL

        UNION ALL

        SELECT
          sei.old_variant_id
            AS variant_id,

          old_product.name
            AS product_name,

          old_variant.size,
          old_variant.color,

          -sei.quantity
            AS quantity,

          -(
            sei.old_unit_price
            *
            sei.quantity
          ) AS total,

          ${exchangeBusinessDate}
            AS business_date,

          se.user_id

        FROM sale_exchange_items sei

        JOIN sale_exchanges se
          ON
            se.id =
              sei.exchange_id

        JOIN sales os
          ON
            os.id =
              se.original_sale_id

        JOIN product_variants
          old_variant
          ON
            old_variant.id =
              sei.old_variant_id

        JOIN products
          old_product
          ON
            old_product.id =
              old_variant.product_id

        WHERE
          os.cancelled_at
            IS NULL

          AND
            se.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'

        UNION ALL

        SELECT
          sei.new_variant_id
            AS variant_id,

          new_product.name
            AS product_name,

          new_variant.size,
          new_variant.color,

          sei.quantity
            AS quantity,

          (
            sei.new_unit_price
            *
            sei.quantity
          ) AS total,

          ${exchangeBusinessDate}
            AS business_date,

          se.user_id

        FROM sale_exchange_items sei

        JOIN sale_exchanges se
          ON
            se.id =
              sei.exchange_id

        JOIN sales os
          ON
            os.id =
              se.original_sale_id

        JOIN product_variants
          new_variant
          ON
            new_variant.id =
              sei.new_variant_id

        JOIN products
          new_product
          ON
            new_product.id =
              new_variant.product_id

        WHERE
          os.cancelled_at
            IS NULL

          AND
            se.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'

        UNION ALL

        SELECT
          sri.variant_id,
          sri.product_name,
          sri.size,
          sri.color,

          -sri.quantity
            AS quantity,

          -sri.line_total
            AS total,

          ${returnBusinessDate}
            AS business_date,

          sr.user_id

        FROM sale_return_items sri

        JOIN sale_returns sr
          ON
            sr.id =
              sri.return_id

        JOIN sales os
          ON
            os.id =
              sr.original_sale_id

        WHERE
          sr.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL
      ) x

      ${combinedWhere.whereSql}

      GROUP BY
        x.variant_id,
        x.product_name,
        x.size,
        x.color

      HAVING
        net_quantity > 0

      ORDER BY
        net_quantity DESC
      `,
    )
    .all(...combinedWhere.params)

  const dailySales = db
    .prepare(
      `
      SELECT
        x.business_date
          AS day,

        IFNULL(
          SUM(x.amount),
          0
        ) AS total

      FROM (
        SELECT
          ${saleBusinessDate}
            AS business_date,

          s.user_id,

          s.grand_total
            AS amount

        FROM sales s

        WHERE
          IFNULL(
            s.type,
            'sale'
          ) = 'sale'

          AND
            s.cancelled_at
            IS NULL

        UNION ALL

        SELECT
          ${exchangeBusinessDate}
            AS business_date,

          se.user_id,

          se.difference_amount
            AS amount

        FROM sale_exchanges se

        JOIN sales os
          ON
            os.id =
              se.original_sale_id

        WHERE
          se.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'

        UNION ALL

        SELECT
          ${returnBusinessDate}
            AS business_date,

          sr.user_id,

          -sr.refund_amount
            AS amount

        FROM sale_returns sr

        JOIN sales os
          ON
            os.id =
              sr.original_sale_id

        WHERE
          sr.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL
      ) x

      ${combinedWhere.whereSql}

      GROUP BY
        x.business_date

      ORDER BY
        day ASC
      `,
    )
    .all(...combinedWhere.params)

  const paymentMethods = db
    .prepare(
      `
      SELECT
        x.payment_method,

        IFNULL(
          SUM(x.invoice_count),
          0
        ) AS count,

        IFNULL(
          SUM(x.amount),
          0
        ) AS total

      FROM (
        /*
         * فواتير البيع.
         */
        SELECT
          CASE
            WHEN sp.payment_method IN ('cash', 'store_cash')
              THEN 'cash'

            WHEN sp.payment_method IN ('card', 'fawry_machine')
              THEN 'card'

            WHEN sp.payment_method IN ('wallet', 'owner_vodafone')
              THEN 'wallet'

            WHEN sp.payment_method IN ('bank', 'bank_transfer', 'owner_bank')
              THEN 'bank_transfer'

            ELSE sp.payment_method
          END AS payment_method,

          1 AS invoice_count,

          sp.amount AS amount,

          ${saleBusinessDate} AS business_date,

          s.user_id

        FROM sale_payments sp

        JOIN sales s
          ON s.id = sp.sale_id

        WHERE
          IFNULL(
            s.type,
            'sale'
          ) = 'sale'

          AND s.cancelled_at IS NULL
          AND sp.payment_method <> 'split'
          AND sp.amount > 0

        UNION ALL

        /*
         * فرق الاستبدال.
         */
        SELECT
          CASE
            WHEN COALESCE(
              se.payment_method,
              os.payment_method,
              'cash'
            ) IN ('cash', 'store_cash')
              THEN 'cash'

            WHEN COALESCE(
              se.payment_method,
              os.payment_method,
              'cash'
            ) IN ('card', 'fawry_machine')
              THEN 'card'

            WHEN COALESCE(
              se.payment_method,
              os.payment_method,
              'cash'
            ) IN ('wallet', 'owner_vodafone')
              THEN 'wallet'

            WHEN COALESCE(
              se.payment_method,
              os.payment_method,
              'cash'
            ) IN ('bank', 'bank_transfer', 'owner_bank')
              THEN 'bank_transfer'

            ELSE COALESCE(
              se.payment_method,
              os.payment_method,
              'cash'
            )
          END AS payment_method,

          0 AS invoice_count,

          se.difference_amount
            AS amount,

          ${exchangeBusinessDate}
            AS business_date,

          se.user_id

        FROM sale_exchanges se

        JOIN sales os
          ON
            os.id =
              se.original_sale_id

        WHERE
          se.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'

        UNION ALL

        /*
         * المرتجعات تخصم من
         * وسيلة دفع الفاتورة الأصلية.
         */
        SELECT
          CASE
            WHEN COALESCE(
              sr.payment_method,
              os.payment_method,
              'cash'
            ) IN ('cash', 'store_cash')
              THEN 'cash'

            WHEN COALESCE(
              sr.payment_method,
              os.payment_method,
              'cash'
            ) IN ('card', 'fawry_machine')
              THEN 'card'

            WHEN COALESCE(
              sr.payment_method,
              os.payment_method,
              'cash'
            ) IN ('wallet', 'owner_vodafone')
              THEN 'wallet'

            WHEN COALESCE(
              sr.payment_method,
              os.payment_method,
              'cash'
            ) IN ('bank', 'bank_transfer', 'owner_bank')
              THEN 'bank_transfer'

            ELSE COALESCE(
              sr.payment_method,
              os.payment_method,
              'cash'
            )
          END AS payment_method,

          0 AS invoice_count,

          -sr.refund_amount
            AS amount,

          ${returnBusinessDate}
            AS business_date,

          sr.user_id

        FROM sale_returns sr

        JOIN sales os
          ON
            os.id =
              sr.original_sale_id

        WHERE
          sr.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL
      ) x

      ${combinedWhere.whereSql}

      GROUP BY
        x.payment_method

      ORDER BY
        total DESC
      `,
    )
    .all(...combinedWhere.params)

  const cashierSales = db
    .prepare(
      `
      SELECT
        x.user_id,

        COALESCE(
          u.name,
          'مستخدم غير معروف'
        ) AS cashier_name,

        IFNULL(
          SUM(x.sales_count),
          0
        ) AS sales_count,

        IFNULL(
          SUM(x.sale_amount),
          0
        ) AS sales_total,

        IFNULL(
          SUM(x.returns_count),
          0
        ) AS returns_count,

        IFNULL(
          SUM(x.return_amount),
          0
        ) AS returns_total,

        IFNULL(
          SUM(x.exchange_count),
          0
        ) AS exchange_count,

        IFNULL(
          SUM(
            x.exchange_adjustment
          ),
          0
        ) AS exchange_adjustment,

        IFNULL(
          SUM(
            x.sale_amount
            - x.return_amount
            + x.exchange_adjustment
          ),
          0
        ) AS net_sales

      FROM (
        /*
         * البيع ينسب للكاشير
         * صاحب الفاتورة.
         */
        SELECT
          s.user_id,

          ${saleBusinessDate}
            AS business_date,

          1 AS sales_count,

          s.grand_total
            AS sale_amount,

          0 AS returns_count,

          0 AS return_amount,

          0 AS exchange_count,

          0 AS exchange_adjustment

        FROM sales s

        WHERE
          IFNULL(
            s.type,
            'sale'
          ) = 'sale'

          AND
            s.cancelled_at
            IS NULL

        UNION ALL

        /*
         * المرتجع يقلل مبيعات
         * صاحب الفاتورة الأصلية،
         * حتى لو مستخدم آخر
         * هو الذي نفذ المرتجع.
         */
        SELECT
          os.user_id,

          ${returnBusinessDate}
            AS business_date,

          0 AS sales_count,

          0 AS sale_amount,

          1 AS returns_count,

          sr.refund_amount
            AS return_amount,

          0 AS exchange_count,

          0 AS exchange_adjustment

        FROM sale_returns sr

        JOIN sales os
          ON
            os.id =
              sr.original_sale_id

        WHERE
          sr.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'

        UNION ALL

        /*
         * فرق الاستبدال ينسب
         * لصاحب الفاتورة الأصلية.
         */
        SELECT
          os.user_id,

          ${exchangeBusinessDate}
            AS business_date,

          0 AS sales_count,

          0 AS sale_amount,

          0 AS returns_count,

          0 AS return_amount,

          1 AS exchange_count,

          se.difference_amount
            AS exchange_adjustment

        FROM sale_exchanges se

        JOIN sales os
          ON
            os.id =
              se.original_sale_id

        WHERE
          se.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'
      ) x

      LEFT JOIN users u
        ON
          u.id =
            x.user_id

      ${combinedWhere.whereSql}

      GROUP BY
        x.user_id,
        u.name

      ORDER BY
        net_sales DESC,
        cashier_name ASC
      `,
    )
    .all(...combinedWhere.params)
    .map((row: any) => ({
      user_id: row.user_id === null ? null : Number(row.user_id),

      cashier_name: String(row.cashier_name || 'مستخدم غير معروف'),

      sales_count: Number(row.sales_count || 0),

      sales_total: Number(row.sales_total || 0),

      returns_count: Number(row.returns_count || 0),

      returns_total: Number(row.returns_total || 0),

      exchange_count: Number(row.exchange_count || 0),

      exchange_adjustment: Number(row.exchange_adjustment || 0),

      net_sales: Number(row.net_sales || 0),
    }))

  const lowStock = db
    .prepare(
      `
      SELECT
        pv.id AS variant_id,
        p.name AS product_name,
        pv.barcode,
        pv.size,
        pv.color,
        pv.min_stock,
        IFNULL(SUM(
          CASE
            WHEN sm.type = 'in' THEN sm.quantity
            WHEN sm.type = 'out' THEN -sm.quantity
            ELSE 0
          END
        ), 0) AS stock
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN stock_movements sm ON sm.variant_id = pv.id
      WHERE pv.is_active = 1
        AND p.is_active = 1
      GROUP BY pv.id
      HAVING stock <= pv.min_stock
      ORDER BY stock ASC
    `,
    )
    .all()

  const topCustomers = db
    .prepare(
      `
      SELECT
        c.id,
        c.name,
        c.phone,

        IFNULL(
          SUM(x.sales_count),
          0
        ) AS sales_count,

        IFNULL(
          SUM(x.amount),
          0
        ) AS total_spent

      FROM customers c

      JOIN (
        /*
         * المبيعات الأصلية.
         */
        SELECT
          s.customer_id,

          ${saleBusinessDate}
            AS business_date,

          s.user_id,

          s.grand_total
            AS amount,

          1 AS sales_count

        FROM sales s

        WHERE
          IFNULL(
            s.type,
            'sale'
          ) = 'sale'

          AND
            s.cancelled_at
            IS NULL

          AND
            s.customer_id
            IS NOT NULL

        UNION ALL

        /*
         * المرتجعات تقلل إنفاق
         * العميل بتاريخ الشفت
         * الذي تم فيه المرتجع.
         */
        SELECT
          sr.customer_id,

          ${returnBusinessDate}
            AS business_date,

          sr.user_id,

          -sr.refund_amount
            AS amount,

          0 AS sales_count

        FROM sale_returns sr

        JOIN sales os
          ON
            os.id =
              sr.original_sale_id

        WHERE
          sr.customer_id
            IS NOT NULL

          AND
            sr.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'

        UNION ALL

        /*
         * فرق الاستبدال يؤثر
         * على إجمالي إنفاق العميل.
         */
        SELECT
          os.customer_id,

          ${exchangeBusinessDate}
            AS business_date,

          se.user_id,

          se.difference_amount
            AS amount,

          0 AS sales_count

        FROM sale_exchanges se

        JOIN sales os
          ON
            os.id =
              se.original_sale_id

        WHERE
          os.customer_id
            IS NOT NULL

          AND
            se.cancelled_at
            IS NULL

          AND
            os.cancelled_at
            IS NULL

          AND
            IFNULL(
              os.type,
              'sale'
            ) = 'sale'
      ) x
        ON
          x.customer_id =
            c.id

      ${combinedWhere.whereSql}

      GROUP BY
        c.id,
        c.name,
        c.phone

      ORDER BY
        total_spent DESC
      `,
    )
    .all(...combinedWhere.params)

  const cashAccounts = db
    .prepare(
      `
      SELECT
        account AS payment_method,
        IFNULL(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS total_in,
        IFNULL(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS total_out,
        IFNULL(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS balance
      FROM (
        SELECT
          CASE
            WHEN payment_method IS NULL OR TRIM(payment_method) = '' THEN 'store_cash'
            WHEN payment_method = 'cash' THEN 'store_cash'
            WHEN payment_method = 'card' THEN 'fawry_machine'
            WHEN payment_method = 'wallet' THEN 'owner_vodafone'
            WHEN payment_method IN ('bank', 'bank_transfer') THEN 'owner_bank'
            WHEN payment_method IN (
              'store_cash',
              'owner_cash',
              'owner_bank',
              'owner_vodafone',
              'fawry_machine'
            ) THEN payment_method
            ELSE 'store_cash'
          END AS account,
          direction,
          amount
        FROM cash_movements
          WHERE cancelled_at IS NULL
      ) cash
      GROUP BY account
      ORDER BY ${CASH_ACCOUNT_ORDER}
    `,
    )
    .all()
    .map((row: any) => ({
      payment_method: row.payment_method,
      label: getCashAccountLabel(row.payment_method),
      total_in: Number(row.total_in || 0),
      total_out: Number(row.total_out || 0),
      balance: Number(row.balance || 0),
    }))

  const cashTotalCapital = cashAccounts.reduce(
    (sum: number, account: any) => sum + Number(account.balance || 0),
    0,
  )

  return {
    summary: {
      sales_count: Number(salesSummary.sales_count || 0),
      exchange_count: Number(exchangeSummary.exchange_count || 0),
      exchange_adjustment: exchangeAdjustment,
      approved_closing_surplus: approvedClosingSurplus,
      approved_closing_shortage: approvedClosingShortage,
      exchange_cash_collection: Number(
        exchangeSummary.exchange_cash_collection || 0,
      ),

      exchange_cash_refund: Number(exchangeSummary.exchange_cash_refund || 0),

      exchange_debt_reduction: Number(
        exchangeSummary.exchange_debt_reduction || 0,
      ),
      exchange_discount_adjustment: exchangeDiscountAdjustment,
      returns_count: Number(returnsSummary.returns_count || 0),
      cancelled_sales_count: Number(
        cancelledSalesRow.cancelled_sales_count || 0,
      ),

      cancelled_returns_count: Number(
        cancelledReturnsRow.cancelled_returns_count || 0,
      ),
      gross_sales: grossSales,
      total_returns: totalReturns,
      normal_discounts: normalDiscounts,
      promotion_discounts: promotionDiscounts,
      loyalty_discounts: loyaltyDiscounts,
      total_discounts: totalDiscounts,
      net_sales: grossSales - totalReturns,
      gross_profit_before_discounts: grossProfitBeforeDiscounts,
      net_profit_after_discounts: netProfitAfterDiscounts,
      total_expenses: totalExpenses,
      total_liability_payments: totalLiabilityPayments,
      total_purchase_invoices: totalPurchaseInvoices,
      total_manual_deposits: totalManualDeposits,
      total_manual_withdrawals: totalManualWithdrawals,
      final_net_profit: finalNetProfit,
      approved_opening_surplus: approvedOpeningSurplus,
      approved_opening_shortage: approvedOpeningShortage,
    },
    cashAccounts,
    cashTotalCapital,
    topProducts,
    dailySales,
    paymentMethods,
    cashierSales,
    lowStock,
    topCustomers,
  }
}

export function getCashierDashboardSummary(input: CashierDashboardInput) {
  const db = getDb()

  const userId = Number(input?.user_id || 0)

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('المستخدم غير صحيح')
  }

  /*
   * Dashboard الكاشير مرتبطة
   * بالشفت المفتوح نفسه،
   * وليس بتاريخ اليوم.
   */
  const shift = db
    .prepare(
      `
      SELECT
        cs.id,
        cs.status,
        cs.opening_counted_amount,
        cs.opened_at,
        cs.closed_at,

        date(
          cs.opened_at,
          'localtime'
        ) AS business_date

      FROM cash_shifts cs

      WHERE
        cs.status = 'open'

        AND
          cs.opened_by = ?

      ORDER BY
        cs.id DESC

      LIMIT 1
      `,
    )
    .get(userId) as any

  /*
   * لو مفيش شفت مفتوح:
   * ممنوع نعرض أرقام الشفت السابق.
   */
  if (!shift) {
    return {
      date: '',

      shift: null,

      sales: {
        invoices_count: 0,

        cancelled_invoices_count: 0,

        invoice_sales: 0,

        paid_sales_total: 0,

        outstanding_debt_total: 0,

        outstanding_debt_invoices_count: 0,

        returns_count: 0,

        cancelled_returns_count: 0,

        returns_total: 0,

        exchanges_count: 0,

        cancelled_exchanges_count: 0,

        exchange_adjustment: 0,

        exchange_cash_collection: 0,

        exchange_cash_refund: 0,

        exchange_cash_difference: 0,

        exchange_debt_reduction: 0,

        net_sales: 0,
      },

      discounts: {
        normal: 0,
        promotion: 0,
        loyalty: 0,
        total: 0,
      },

      operations: {
        customer_payments_count: 0,

        customer_payments_total: 0,

        cancelled_customer_payments_count: 0,

        expenses_count: 0,

        cancelled_expenses_count: 0,

        expenses_total: 0,

        stock_count_sessions_count: 0,
      },
    }
  }

  const shiftId = Number(shift.id)

  /*
   * فواتير البيع التي أنشأها
   * هذا الكاشير داخل الشفت الحالي.
   */
  const sales = db
    .prepare(
      `
      SELECT
        COUNT(*)
          AS invoices_count,

        IFNULL(
          SUM(
            s.grand_total
          ),
          0
        ) AS invoice_sales,

        /*
          * القيمة الحالية المدفوعة فعلًا
          * من فواتير هذا الشفت.
          *
          * نراعي:
          * - الاستبدالات
          * - المرتجعات
          * - المديونية الحالية
          */
          IFNULL(
            SUM(
              MAX(
                0,

                s.grand_total

                +
                IFNULL(
                  (
                    SELECT
                      SUM(
                        se.difference_amount
                      )

                    FROM sale_exchanges se

                    WHERE
                      se.original_sale_id =
                        s.id

                      AND
                        se.cancelled_at
                        IS NULL
                  ),
                  0
                )

                -
                IFNULL(
                  (
                    SELECT
                      SUM(
                        sr.refund_amount
                      )

                    FROM sale_returns sr

                    WHERE
                      sr.original_sale_id =
                        s.id

                      AND
                        sr.cancelled_at
                        IS NULL
                  ),
                  0
                )

                -
                IFNULL(
                  s.remaining_amount,
                  0
                )
              )
            ),
            0
          ) AS paid_sales_total,

          IFNULL(
            SUM(
              MAX(
                0,
                IFNULL(
                  s.remaining_amount,
                  0
                )
              )
            ),
            0
          ) AS outstanding_debt_total,

          IFNULL(
            SUM(
              CASE
                WHEN
                  ROUND(
                    IFNULL(
                      s.remaining_amount,
                      0
                    ),
                    2
                  ) > 0
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS outstanding_debt_invoices_count,

        IFNULL(
          SUM(
            IFNULL(
              s.discount_value,
              0
            )
          ),
          0
        ) AS normal_discounts,

        IFNULL(
          SUM(
            IFNULL(
              s.promotion_discount_value,
              0
            )
          ),
          0
        ) AS promotion_discounts,

        IFNULL(
          SUM(
            IFNULL(
              s.loyalty_discount_value,
              0
            )
          ),
          0
        ) AS loyalty_discounts

      FROM sales s

      WHERE
        IFNULL(
          s.type,
          'sale'
        ) = 'sale'

        AND
          s.cancelled_at
          IS NULL

        AND
          s.shift_id = ?
      `,
    )
    .get(shiftId) as any

  /*
   * الإلغاءات التي نفذها
   * الكاشير في الشفت الحالي.
   */
  const cancelledSales = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count

      FROM sales s

      WHERE
        s.cancelled_at
        IS NOT NULL

        AND
          s.cancelled_shift_id = ?
      `,
    )
    .get(shiftId) as any

  /*
   * المرتجعات هنا مرتبطة
   * بالشفت الذي تم فيه المرتجع،
   * وليس بصاحب الفاتورة القديمة.
   */
  const returns = db
    .prepare(
      `
      SELECT
        COUNT(*)
          AS returns_count,

        IFNULL(
          SUM(
            sr.refund_amount
          ),
          0
        ) AS returns_total,

        IFNULL(
          SUM(
            CASE
              WHEN
                sr.normal_discount_value
                IS NOT NULL

              THEN
                sr.normal_discount_value

              ELSE
                MAX(
                  0,

                  sr.sub_total
                  - sr.refund_amount

                  - IFNULL(
                      sr.loyalty_discount_value,
                      0
                    )

                  - IFNULL(
                      sr.promotion_discount_value,
                      0
                    )
                )
            END
          ),
          0
        ) AS returned_normal_discount,

        IFNULL(
          SUM(
            IFNULL(
              sr.promotion_discount_value,
              0
            )
          ),
          0
        ) AS returned_promotion_discount,

        IFNULL(
          SUM(
            IFNULL(
              sr.loyalty_discount_value,
              0
            )
          ),
          0
        ) AS returned_loyalty_discount

      FROM sale_returns sr

      JOIN sales os
        ON
          os.id =
            sr.original_sale_id

      WHERE
        sr.cancelled_at
        IS NULL

        AND
          os.cancelled_at
          IS NULL

        AND
          sr.shift_id = ?
      `,
    )
    .get(shiftId) as any

  const cancelledReturns = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count

      FROM sale_returns sr

      WHERE
        sr.cancelled_at
        IS NOT NULL

        AND
          sr.cancelled_shift_id = ?
      `,
    )
    .get(shiftId) as any

  /*
   * الاستبدالات التي تم تنفيذها
   * في الشفت الحالي فقط.
   */
  const exchanges = db
    .prepare(
      `
      SELECT
        COUNT(*)
          AS exchanges_count,

        IFNULL(
          SUM(
            se.difference_amount
          ),
          0
        ) AS exchange_adjustment,

        IFNULL(
          SUM(
            se.cash_collection_amount
          ),
          0
        ) AS exchange_cash_collection,

        IFNULL(
          SUM(
            se.cash_refund_amount
          ),
          0
        ) AS exchange_cash_refund,

        IFNULL(
          SUM(
            se.debt_reduction_amount
          ),
          0
        ) AS exchange_debt_reduction,

        IFNULL(
          SUM(
            COALESCE(
              se.new_normal_discount_value,
              se.old_normal_discount_value,
              0
            )
            -
            COALESCE(
              se.old_normal_discount_value,
              0
            )
          ),
          0
        ) AS normal_discount_adjustment,

        IFNULL(
          SUM(
            COALESCE(
              se.new_promotion_discount_value,
              se.old_promotion_discount_value,
              0
            )
            -
            COALESCE(
              se.old_promotion_discount_value,
              0
            )
          ),
          0
        ) AS promotion_discount_adjustment,

        IFNULL(
          SUM(
            COALESCE(
              se.new_loyalty_discount_value,
              se.old_loyalty_discount_value,
              0
            )
            -
            COALESCE(
              se.old_loyalty_discount_value,
              0
            )
          ),
          0
        ) AS loyalty_discount_adjustment

      FROM sale_exchanges se

      JOIN sales os
        ON
          os.id =
            se.original_sale_id

      WHERE
        se.cancelled_at
        IS NULL

        AND
          os.cancelled_at
          IS NULL

        AND
          se.shift_id = ?
      `,
    )
    .get(shiftId) as any

  const cancelledExchanges = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count

      FROM sale_exchanges se

      WHERE
        se.cancelled_at
        IS NOT NULL

        AND
          se.cancelled_shift_id = ?
      `,
    )
    .get(shiftId) as any

  /*
   * دفعات العملاء:
   * عدد + إجمالي قيمة.
   */
  const customerPayments = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count,

        IFNULL(
          SUM(
            b.amount
          ),
          0
        ) AS total

      FROM customer_payment_batches b

      WHERE
        b.cancelled_at
        IS NULL

        AND
          b.shift_id = ?
      `,
    )
    .get(shiftId) as any

  const cancelledCustomerPayments = db
    .prepare(
      `
        SELECT
          COUNT(*) AS count

        FROM customer_payment_batches b

        WHERE
          b.cancelled_at
          IS NOT NULL
          AND
            b.cancelled_shift_id = ?
        `,
    )
    .get(shiftId) as any

  const expenses = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count,

        IFNULL(
          SUM(
            e.amount
          ),
          0
        ) AS total

      FROM expenses e

      WHERE
        e.cancelled_at
        IS NULL

        AND
          e.shift_id = ?
      `,
    )
    .get(shiftId) as any

  const cancelledExpenses = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count

      FROM expenses e

      WHERE
        e.cancelled_at
        IS NOT NULL

        AND
          e.cancelled_shift_id = ?
      `,
    )
    .get(shiftId) as any

  /*
   * جلسات الجرد ليس لها shift_id
   * حاليًا، والكاشير لا ينشئ
   * الجلسة أصلًا.
   *
   * لذلك نحسب جلسات الجرد التي
   * عمل عليها فعليًا منذ فتح الشفت.
   */
  const stockCounts = db
    .prepare(
      `
      SELECT
        COUNT(
          DISTINCT
          al.entity_id
        ) AS count

      FROM activity_logs al

      WHERE
        al.user_id = ?

        AND
          al.entity =
            'stock_counts'

        AND
          al.action IN (
            'stock_count_item_updated',
            'stock_count_barcode_scanned'
          )

        AND
          datetime(
            al.created_at
          ) >= datetime(?)
      `,
    )
    .get(userId, shift.opened_at) as any

  const invoiceSales = reportMoney(sales?.invoice_sales)

  const returnsTotal = reportMoney(returns?.returns_total)

  const exchangeAdjustment = reportMoney(exchanges?.exchange_adjustment)

  const exchangeCashCollection = reportMoney(
    exchanges?.exchange_cash_collection,
  )

  const exchangeCashRefund = reportMoney(exchanges?.exchange_cash_refund)

  const exchangeCashDifference = reportMoney(
    exchangeCashCollection - exchangeCashRefund,
  )

  const exchangeDebtReduction = reportMoney(exchanges?.exchange_debt_reduction)

  const normalDiscount = Math.max(
    0,

    reportMoney(
      Number(sales?.normal_discounts || 0) -
        Number(returns?.returned_normal_discount || 0) +
        Number(exchanges?.normal_discount_adjustment || 0),
    ),
  )

  const promotionDiscount = Math.max(
    0,

    reportMoney(
      Number(sales?.promotion_discounts || 0) -
        Number(returns?.returned_promotion_discount || 0) +
        Number(exchanges?.promotion_discount_adjustment || 0),
    ),
  )

  const loyaltyDiscount = Math.max(
    0,

    reportMoney(
      Number(sales?.loyalty_discounts || 0) -
        Number(returns?.returned_loyalty_discount || 0) +
        Number(exchanges?.loyalty_discount_adjustment || 0),
    ),
  )

  const totalDiscount = reportMoney(
    normalDiscount + promotionDiscount + loyaltyDiscount,
  )

  const netSales = reportMoney(invoiceSales + exchangeAdjustment - returnsTotal)

  return {
    date: String(shift.business_date || ''),

    /*
     * لا نرجع expected opening
     * ولا opening difference.
     */
    shift: {
      id: shiftId,

      status: 'open' as const,

      opening_counted_amount: reportMoney(shift.opening_counted_amount),

      opened_at: String(shift.opened_at || ''),

      closed_at: null,
    },

    sales: {
      invoices_count: Number(sales?.invoices_count || 0),

      cancelled_invoices_count: Number(cancelledSales?.count || 0),

      invoice_sales: invoiceSales,
      paid_sales_total: reportMoney(sales?.paid_sales_total),

      outstanding_debt_total: reportMoney(sales?.outstanding_debt_total),

      outstanding_debt_invoices_count: Number(
        sales?.outstanding_debt_invoices_count || 0,
      ),
      returns_count: Number(returns?.returns_count || 0),

      cancelled_returns_count: Number(cancelledReturns?.count || 0),

      returns_total: returnsTotal,

      exchanges_count: Number(exchanges?.exchanges_count || 0),

      cancelled_exchanges_count: Number(cancelledExchanges?.count || 0),

      exchange_adjustment: exchangeAdjustment,

      exchange_cash_collection: exchangeCashCollection,

      exchange_cash_refund: exchangeCashRefund,

      exchange_cash_difference: exchangeCashDifference,

      exchange_debt_reduction: exchangeDebtReduction,

      net_sales: netSales,
    },

    discounts: {
      normal: normalDiscount,

      promotion: promotionDiscount,

      loyalty: loyaltyDiscount,

      total: totalDiscount,
    },

    operations: {
      customer_payments_count: Number(customerPayments?.count || 0),

      customer_payments_total: reportMoney(customerPayments?.total),

      cancelled_customer_payments_count: Number(
        cancelledCustomerPayments?.count || 0,
      ),

      expenses_count: Number(expenses?.count || 0),

      cancelled_expenses_count: Number(cancelledExpenses?.count || 0),

      expenses_total: reportMoney(expenses?.total),

      stock_count_sessions_count: Number(stockCounts?.count || 0),
    },
  }
}
