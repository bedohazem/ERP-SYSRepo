import { getDb } from '../db';
import { preservePrecision } from '../../../shared/money';
import {
  buildSalesFinancialJournalSql,
  buildSalesProductJournalSql,
  type FinancialJournalDates,
} from './sales-history-journal';

export type SalesHistoryFilter = {
  date_from?: string;
  date_to?: string;
  user_id?: number;
};

function shiftDate(shift: string, timestamp: string, stored?: string) {
  return `COALESCE(
    (SELECT COALESCE(NULLIF(cs.business_date, ''), date(cs.opened_at, 'localtime'))
      FROM cash_shifts cs WHERE cs.id = ${shift} LIMIT 1),
    ${stored ? `NULLIF(${stored}, ''),` : ''}
    date(${timestamp}, 'localtime')
  )`;
}

function dates(): FinancialJournalDates {
  return {
    sale: shiftDate('s.shift_id', 's.created_at', 's.business_date'),
    saleCancel: shiftDate('s.cancelled_shift_id', 's.cancelled_at'),
    saleReturn: shiftDate('sr.shift_id', 'sr.created_at'),
    saleReturnCancel: shiftDate('sr.cancelled_shift_id', 'sr.cancelled_at'),
    exchange: shiftDate('se.shift_id', 'se.created_at', 'se.business_date'),
    exchangeCancel: shiftDate('se.cancelled_shift_id', 'se.cancelled_at'),
  };
}

function where(
  input: SalesHistoryFilter | undefined,
  userColumn = 'x.user_id',
) {
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (input?.date_from) {
    clauses.push('x.business_date >= ?');
    args.push(input.date_from);
  }
  if (input?.date_to) {
    clauses.push('x.business_date <= ?');
    args.push(input.date_to);
  }
  if (input?.user_id) {
    clauses.push(`${userColumn} = ?`);
    args.push(Number(input.user_id));
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    args,
  };
}

const n = (value: unknown) => preservePrecision(value ?? 0);

export function getSalesHistoryReport(input?: SalesHistoryFilter) {
  const db = getDb();
  const d = dates();
  const journal = buildSalesFinancialJournalSql(d);
  const productJournal = buildSalesProductJournalSql(d);
  const f = where(input);
  const sellerFilter = where(input, 'x.cashier_id');

  const sums = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(x.sales_count),0) AS sales_count,
      COALESCE(SUM(x.returns_count),0) AS returns_count,
      COALESCE(SUM(x.exchange_count),0) AS exchange_count,
      COALESCE(SUM(x.sale_amount + x.exchange_adjustment),0) AS gross_sales,
      COALESCE(SUM(x.return_amount),0) AS total_returns,
      COALESCE(SUM(x.exchange_adjustment),0) AS exchange_adjustment,
      COALESCE(SUM(x.exchange_discount_adjustment),0) AS exchange_discount_adjustment,
      COALESCE(SUM(x.exchange_cash_collection),0) AS exchange_cash_collection,
      COALESCE(SUM(x.exchange_cash_refund),0) AS exchange_cash_refund,
      COALESCE(SUM(x.exchange_debt_reduction),0) AS exchange_debt_reduction,
      COALESCE(SUM(x.product_discounts),0) AS product_discounts,
      COALESCE(SUM(x.normal_discounts),0) AS normal_discounts,
      COALESCE(SUM(x.promotion_discounts),0) AS promotion_discounts,
      COALESCE(SUM(x.loyalty_discounts),0) AS loyalty_discounts,
      COALESCE(SUM(x.exchange_discounts),0) AS exchange_discounts,
      COALESCE(SUM(x.gross_profit),0) AS gross_profit_before_discounts,
      COALESCE(SUM(x.net_profit),0) AS net_profit_after_discounts
    FROM (${journal}) x ${f.where}
  `,
    )
    .get(...f.args) as Record<string, number>;
  const summary = Object.fromEntries(
    Object.entries(sums).map(([key, value]) => [key, n(value)]),
  ) as Record<keyof typeof sums, number>;
  summary.net_sales = n(summary.gross_sales - summary.total_returns);
  summary.total_discounts = n(
    summary.product_discounts +
      summary.normal_discounts +
      summary.promotion_discounts +
      summary.loyalty_discounts +
      summary.exchange_discounts,
  );

  const dailySales = db
    .prepare(
      `
    SELECT x.business_date AS day,
      COALESCE(SUM(x.sale_amount - x.return_amount + x.exchange_adjustment),0) AS total
    FROM (${journal}) x ${f.where}
    GROUP BY x.business_date ORDER BY x.business_date ASC
  `,
    )
    .all(...f.args)
    .map((row: any) => ({ day: row.day, total: n(row.total) }));

  const topProducts = db
    .prepare(
      `
    SELECT x.variant_id, x.product_name, x.size, x.color,
      COALESCE(SUM(x.quantity),0) AS net_quantity,
      COALESCE(SUM(x.total),0) AS net_total
    FROM (${productJournal}) x ${f.where}
    GROUP BY x.variant_id, x.product_name, x.size, x.color
    HAVING net_quantity <> 0
    ORDER BY net_quantity DESC
  `,
    )
    .all(...f.args)
    .map((row: any) => ({
      variant_id: n(row.variant_id),
      product_name: row.product_name,
      size: row.size,
      color: row.color,
      net_quantity: n(row.net_quantity),
      net_total: n(row.net_total),
    }));

  const cashierSales = db
    .prepare(
      `
    SELECT x.cashier_id AS user_id,
      COALESCE(u.name,'مستخدم غير معروف') AS cashier_name,
      COALESCE(SUM(x.sales_count),0) AS sales_count,
      COALESCE(SUM(x.sale_amount),0) AS sales_total,
      COALESCE(SUM(x.returns_count),0) AS returns_count,
      COALESCE(SUM(x.return_amount),0) AS returns_total,
      COALESCE(SUM(x.exchange_count),0) AS exchange_count,
      COALESCE(SUM(x.exchange_adjustment),0) AS exchange_adjustment,
      COALESCE(SUM(x.sale_amount - x.return_amount + x.exchange_adjustment),0) AS net_sales
    FROM (${journal}) x
    LEFT JOIN users u ON u.id = x.cashier_id
    ${sellerFilter.where}
    GROUP BY x.cashier_id, u.name
    ORDER BY net_sales DESC, cashier_name ASC
  `,
    )
    .all(...sellerFilter.args)
    .map((row: any) => ({
      user_id: row.user_id === null ? null : n(row.user_id),
      cashier_name: row.cashier_name,
      sales_count: n(row.sales_count),
      sales_total: n(row.sales_total),
      returns_count: n(row.returns_count),
      returns_total: n(row.returns_total),
      exchange_count: n(row.exchange_count),
      exchange_adjustment: n(row.exchange_adjustment),
      net_sales: n(row.net_sales),
    }));

  const salespersonSales = db
    .prepare(
      `
    SELECT
      COALESCE(MAX(x.salesperson_id), MAX(cashier_sp.id)) AS salesperson_id,
      COALESCE(
        MAX(NULLIF(TRIM(x.salesperson_name),'')),
        MAX(sp.name),MAX(cashier_sp.name),MAX(u.name),'بائع غير معروف'
      ) AS salesperson_name,
      COALESCE(SUM(x.sales_count),0) AS sales_count,
      COALESCE(SUM(x.sale_amount),0) AS sales_total,
      COALESCE(SUM(x.returns_count),0) AS returns_count,
      COALESCE(SUM(x.return_amount),0) AS returns_total,
      COALESCE(SUM(x.exchange_count),0) AS exchange_count,
      COALESCE(SUM(x.exchange_adjustment),0) AS exchange_adjustment,
      COALESCE(SUM(x.sale_amount - x.return_amount + x.exchange_adjustment),0) AS net_sales
    FROM (${journal}) x
    LEFT JOIN salespeople sp ON sp.id = x.salesperson_id
    LEFT JOIN salespeople cashier_sp
      ON x.salesperson_id IS NULL AND cashier_sp.user_id = x.cashier_id
    LEFT JOIN users u ON u.id = x.cashier_id
    ${sellerFilter.where}
    GROUP BY CASE WHEN COALESCE(x.salesperson_id,cashier_sp.id) IS NOT NULL
      THEN 'salesperson:' || COALESCE(x.salesperson_id,cashier_sp.id)
      ELSE 'user:' || x.cashier_id END
    ORDER BY net_sales DESC, salesperson_name ASC
  `,
    )
    .all(...sellerFilter.args)
    .map((row: any) => ({
      salesperson_id:
        row.salesperson_id === null ? null : n(row.salesperson_id),
      salesperson_name: row.salesperson_name,
      sales_count: n(row.sales_count),
      sales_total: n(row.sales_total),
      returns_count: n(row.returns_count),
      returns_total: n(row.returns_total),
      exchange_count: n(row.exchange_count),
      exchange_adjustment: n(row.exchange_adjustment),
      net_sales: n(row.net_sales),
    }));

  const topCustomers = db
    .prepare(
      `
    SELECT c.id, c.name, c.phone,
      COALESCE(SUM(x.sales_count),0) AS sales_count,
      COALESCE(SUM(x.sale_amount - x.return_amount + x.exchange_adjustment),0) AS total_spent
    FROM (${journal}) x
    JOIN customers c ON c.id = x.customer_id
    ${f.where}
    GROUP BY c.id,c.name,c.phone
    ORDER BY total_spent DESC
  `,
    )
    .all(...f.args)
    .map((row: any) => ({
      id: n(row.id),
      name: row.name,
      phone: row.phone,
      sales_count: n(row.sales_count),
      total_spent: n(row.total_spent),
    }));

  return {
    summary,
    dailySales,
    topProducts,
    cashierSales,
    salespersonSales,
    topCustomers,
  };
}

export function getSalesTodaySummary(businessDate: string) {
  const db = getDb();
  const journal = buildSalesFinancialJournalSql(dates());
  const result = db
    .prepare(
      `
    SELECT COALESCE(SUM(x.sales_count),0) AS sales_count,
      COALESCE(SUM(x.sale_amount - x.return_amount + x.exchange_adjustment),0) AS net_sales
    FROM (${journal}) x WHERE x.business_date = ?
  `,
    )
    .get(businessDate) as { sales_count: number; net_sales: number };
  return { sales_count: n(result.sales_count), net_sales: n(result.net_sales) };
}
