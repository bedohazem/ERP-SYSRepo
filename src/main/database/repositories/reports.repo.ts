import { getDb } from '../db';

type ReportFilter = {
  date_from?: string;
  date_to?: string;
};

function buildWhere(alias: string, input?: ReportFilter, extra: string[] = []) {
  const where: string[] = [...extra];
  const params: any[] = [];

  if (input?.date_from) {
    where.push(`datetime(${alias}.created_at, 'localtime') >= datetime(?)`);
    params.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    where.push(`datetime(${alias}.created_at, 'localtime') <= datetime(?)`);
    params.push(`${input.date_to} 23:59:59`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
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
`;

function getCashAccountLabel(account: string) {
  switch (account) {
    case 'store_cash':
      return 'كاش درج المحل';
    case 'owner_cash':
      return 'كاش مع المالك';
    case 'owner_bank':
      return 'حساب بنك / فيزا المالك';
    case 'owner_vodafone':
      return 'فودافون كاش المالك';
    case 'fawry_machine':
      return 'ماكينة فوري';
    default:
      return account || 'غير محدد';
  }
}

export function getReportsSummary(input?: ReportFilter) {
  const db = getDb();

  const salesWhere = buildWhere('s', input, [`IFNULL(s.type, 'sale') = 'sale'`]);
  const returnsWhere = buildWhere('sr', input);
  const combinedWhere = buildWhere('x', input);

  const salesSummary = db
    .prepare(`
      SELECT
        COUNT(*) AS sales_count,
        IFNULL(SUM(s.grand_total), 0) AS gross_sales,
        IFNULL(SUM(s.discount_value), 0) AS normal_discounts,
        IFNULL(SUM(s.loyalty_discount_value), 0) AS loyalty_discounts,
        IFNULL(SUM(s.discount_value + s.loyalty_discount_value), 0) AS total_discounts
      FROM sales s
      ${salesWhere.whereSql}
    `)
    .get(...salesWhere.params) as any;

  const returnsSummary = db
    .prepare(`
      SELECT
        COUNT(*) AS returns_count,
        IFNULL(SUM(sr.refund_amount), 0) AS total_returns
      FROM sale_returns sr
      ${returnsWhere.whereSql}
    `)
    .get(...returnsWhere.params) as any;

  const salesProfitRow = db
    .prepare(`
      SELECT
        IFNULL(SUM(x.items_profit_before_discount), 0) AS gross_profit_before_discounts,
        IFNULL(SUM(
          x.items_profit_before_discount
          - x.normal_discount
          - x.loyalty_discount
        ), 0) AS net_profit_after_discounts
      FROM (
        SELECT
          s.id,
          IFNULL(s.discount_value, 0) AS normal_discount,
          IFNULL(s.loyalty_discount_value, 0) AS loyalty_discount,
          IFNULL(SUM(si.unit_cost * si.quantity), 0) AS total_cost,
          IFNULL(SUM((si.unit_price - si.unit_cost) * si.quantity), 0) AS items_profit_before_discount
        FROM sales s
        JOIN sale_items si ON si.sale_id = s.id
        ${salesWhere.whereSql}
        GROUP BY s.id
      ) x
    `)
    .get(...salesWhere.params) as any;

  const returnsProfitRow = db
    .prepare(`
      SELECT
        IFNULL(SUM(x.items_profit_before_discount), 0) AS returned_profit_before_discounts,
        IFNULL(SUM(x.refund_amount - x.total_cost), 0) AS returned_profit_after_discounts
      FROM (
        SELECT
          sr.id,
          sr.refund_amount,
          IFNULL(SUM(sri.unit_cost * sri.quantity), 0) AS total_cost,
          IFNULL(SUM((sri.unit_price - sri.unit_cost) * sri.quantity), 0) AS items_profit_before_discount
        FROM sale_returns sr
        JOIN sale_return_items sri ON sri.return_id = sr.id
        ${returnsWhere.whereSql}
        GROUP BY sr.id
      ) x
    `)
    .get(...returnsWhere.params) as any;

  const grossSales = Number(salesSummary.gross_sales || 0);
  const totalReturns = Number(returnsSummary.total_returns || 0);

  const grossProfitBeforeDiscounts =
    Number(salesProfitRow.gross_profit_before_discounts || 0) -
    Number(returnsProfitRow.returned_profit_before_discounts || 0);

  const netProfitAfterDiscounts =
    Number(salesProfitRow.net_profit_after_discounts || 0) -
    Number(returnsProfitRow.returned_profit_after_discounts || 0);


  const expensesWhere = buildWhere('e', input);
  const liabilityPaymentsWhere = buildWhere('p', input);

  const expensesRow = db
    .prepare(`
      SELECT IFNULL(SUM(e.amount), 0) AS total_expenses
      FROM expenses e
      ${expensesWhere.whereSql}
    `)
    .get(...expensesWhere.params) as any;

  const liabilityPaymentsRow = db
    .prepare(`
      SELECT IFNULL(SUM(p.amount), 0) AS total_liability_payments
      FROM store_liability_payments p
      ${liabilityPaymentsWhere.whereSql}
    `)
    .get(...liabilityPaymentsWhere.params) as any;

  const totalExpenses = Number(expensesRow.total_expenses || 0);
  const totalLiabilityPayments = Number(liabilityPaymentsRow.total_liability_payments || 0);

  const finalNetProfit = netProfitAfterDiscounts - totalExpenses;  

  const topProducts = db
    .prepare(`
      SELECT
        x.variant_id,
        x.product_name,
        x.size,
        x.color,
        IFNULL(SUM(x.quantity), 0) AS net_quantity,
        IFNULL(SUM(x.total), 0) AS net_total
      FROM (
        SELECT
          si.variant_id,
          si.product_name,
          si.size,
          si.color,
          si.quantity AS quantity,
          si.line_total AS total,
          s.created_at
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE IFNULL(s.type, 'sale') = 'sale'

        UNION ALL

        SELECT
          sri.variant_id,
          sri.product_name,
          sri.size,
          sri.color,
          -sri.quantity AS quantity,
          -sri.line_total AS total,
          sr.created_at
        FROM sale_return_items sri
        JOIN sale_returns sr ON sr.id = sri.return_id
      ) x
      ${combinedWhere.whereSql}
      GROUP BY x.variant_id, x.product_name, x.size, x.color
      HAVING net_quantity > 0
      ORDER BY net_quantity DESC
      LIMIT 10
    `)
    .all(...combinedWhere.params);

  const dailySales = db
    .prepare(`
      SELECT
        date(x.created_at, 'localtime') AS day,
        IFNULL(SUM(x.amount), 0) AS total
      FROM (
        SELECT
          s.created_at,
          s.grand_total AS amount
        FROM sales s
        WHERE IFNULL(s.type, 'sale') = 'sale'

        UNION ALL

        SELECT
          sr.created_at,
          -sr.refund_amount AS amount
        FROM sale_returns sr
      ) x
      ${combinedWhere.whereSql}
      GROUP BY date(x.created_at, 'localtime')
      ORDER BY day ASC
      LIMIT 60
    `)
    .all(...combinedWhere.params);

  const paymentMethods = db
    .prepare(`
      SELECT
        IFNULL(s.payment_method, 'cash') AS payment_method,
        COUNT(*) AS count,
        IFNULL(SUM(s.grand_total), 0) AS total
      FROM sales s
      ${salesWhere.whereSql}
      GROUP BY IFNULL(s.payment_method, 'cash')
      ORDER BY total DESC
    `)
    .all(...salesWhere.params);

  const lowStock = db
    .prepare(`
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
      LIMIT 20
    `)
    .all();

  const topCustomers = db
    .prepare(`
      SELECT
        c.id,
        c.name,
        c.phone,
        IFNULL(SUM(x.sales_count), 0) AS sales_count,
        IFNULL(SUM(x.amount), 0) AS total_spent
      FROM customers c
      JOIN (
        SELECT
          s.customer_id,
          s.created_at,
          s.grand_total AS amount,
          1 AS sales_count
        FROM sales s
        WHERE IFNULL(s.type, 'sale') = 'sale'
          AND s.customer_id IS NOT NULL

        UNION ALL

        SELECT
          sr.customer_id,
          sr.created_at,
          -sr.refund_amount AS amount,
          0 AS sales_count
        FROM sale_returns sr
        WHERE sr.customer_id IS NOT NULL
      ) x ON x.customer_id = c.id
      ${combinedWhere.whereSql}
      GROUP BY c.id
      ORDER BY total_spent DESC
      LIMIT 10
    `)
    .all(...combinedWhere.params);

  const cashAccounts = db
    .prepare(`
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
      ) cash
      GROUP BY account
      ORDER BY ${CASH_ACCOUNT_ORDER}
    `)
    .all()
    .map((row: any) => ({
      payment_method: row.payment_method,
      label: getCashAccountLabel(row.payment_method),
      total_in: Number(row.total_in || 0),
      total_out: Number(row.total_out || 0),
      balance: Number(row.balance || 0)
    }));

  const cashTotalCapital = cashAccounts.reduce(
    (sum: number, account: any) => sum + Number(account.balance || 0),
    0
  );  

  return {
    summary: {
      sales_count: Number(salesSummary.sales_count || 0),
      returns_count: Number(returnsSummary.returns_count || 0),
      gross_sales: grossSales,
      total_returns: totalReturns,
      normal_discounts: Number(salesSummary.normal_discounts || 0),
      loyalty_discounts: Number(salesSummary.loyalty_discounts || 0),
      total_discounts: Number(salesSummary.total_discounts || 0),
      net_sales: grossSales - totalReturns,
      gross_profit_before_discounts: grossProfitBeforeDiscounts,
      net_profit_after_discounts: netProfitAfterDiscounts,
      total_expenses: totalExpenses,
      total_liability_payments: totalLiabilityPayments,
      final_net_profit: finalNetProfit
    },
    cashAccounts,
    cashTotalCapital,
    topProducts,
    dailySales,
    paymentMethods,
    lowStock,
    topCustomers
  };
}