import { getDb } from '../db';

type ReportFilter = {
  date_from?: string;
  date_to?: string;
};

function buildDateWhere(alias = 's', input?: ReportFilter) {
  const where: string[] = [];
  const params: any[] = [];

  if (input?.date_from) {
    where.push(`datetime(${alias}.created_at) >= datetime(?)`);
    params.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    where.push(`datetime(${alias}.created_at) <= datetime(?)`);
    params.push(`${input.date_to} 23:59:59`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

export function getReportsSummary(input?: ReportFilter) {
  const db = getDb();
  const { whereSql, params } = buildDateWhere('s', input);

  const summary = db
    .prepare(`
      SELECT
        COUNT(CASE WHEN IFNULL(s.type, 'sale') = 'sale' THEN 1 END) AS sales_count,
        COUNT(CASE WHEN IFNULL(s.type, 'sale') = 'return' THEN 1 END) AS returns_count,

        IFNULL(SUM(CASE WHEN IFNULL(s.type, 'sale') = 'sale' THEN s.grand_total ELSE 0 END), 0) AS gross_sales,
        IFNULL(SUM(CASE WHEN IFNULL(s.type, 'sale') = 'return' THEN s.grand_total ELSE 0 END), 0) AS total_returns,

        IFNULL(SUM(CASE WHEN IFNULL(s.type, 'sale') = 'sale' THEN s.loyalty_discount_value ELSE 0 END), 0) AS loyalty_discounts,

        IFNULL(SUM(
          CASE
            WHEN IFNULL(s.type, 'sale') = 'sale' THEN s.grand_total
            WHEN IFNULL(s.type, 'sale') = 'return' THEN -s.grand_total
            ELSE 0
          END
        ), 0) AS net_sales
      FROM sales s
      ${whereSql}
    `)
    .get(...params) as any;

const profitRow = db
  .prepare(`
    SELECT
      IFNULL(SUM(
        CASE
          WHEN IFNULL(x.type, 'sale') = 'sale'
            THEN x.items_profit_before_discount
          WHEN IFNULL(x.type, 'sale') = 'return'
            THEN -x.items_profit_before_discount
          ELSE 0
        END
      ), 0) AS gross_profit_before_discounts,

      IFNULL(SUM(
        CASE
          WHEN IFNULL(x.type, 'sale') = 'sale'
            THEN x.grand_total - x.total_cost
          WHEN IFNULL(x.type, 'sale') = 'return'
            THEN -(x.grand_total - x.total_cost)
          ELSE 0
        END
      ), 0) AS net_profit_after_discounts
    FROM (
      SELECT
        s.id,
        s.type,
        s.grand_total,
        IFNULL(SUM(si.unit_cost * si.quantity), 0) AS total_cost,
        IFNULL(SUM((si.unit_price - si.unit_cost) * si.quantity), 0) AS items_profit_before_discount
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      ${whereSql}
      GROUP BY s.id
    ) x
  `)
  .get(...params) as any;

  const topProducts = db
    .prepare(`
      SELECT
        si.variant_id,
        si.product_name,
        si.size,
        si.color,
        IFNULL(SUM(
          CASE
            WHEN IFNULL(s.type, 'sale') = 'sale' THEN si.quantity
            WHEN IFNULL(s.type, 'sale') = 'return' THEN -si.quantity
            ELSE 0
          END
        ), 0) AS net_quantity,
        IFNULL(SUM(
          CASE
            WHEN IFNULL(s.type, 'sale') = 'sale' THEN si.line_total
            WHEN IFNULL(s.type, 'sale') = 'return' THEN -si.line_total
            ELSE 0
          END
        ), 0) AS net_total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      ${whereSql}
      GROUP BY si.variant_id, si.product_name, si.size, si.color
      HAVING net_quantity > 0
      ORDER BY net_quantity DESC
      LIMIT 10
    `)
    .all(...params);

  const dailySales = db
    .prepare(`
      SELECT
        date(s.created_at) AS day,
        IFNULL(SUM(
          CASE
            WHEN IFNULL(s.type, 'sale') = 'sale' THEN s.grand_total
            WHEN IFNULL(s.type, 'sale') = 'return' THEN -s.grand_total
            ELSE 0
          END
        ), 0) AS total
      FROM sales s
      ${whereSql}
      GROUP BY date(s.created_at)
      ORDER BY day ASC
      LIMIT 60
    `)
    .all(...params);

  const paymentMethods = db
    .prepare(`
      SELECT
        IFNULL(s.payment_method, 'cash') AS payment_method,
        COUNT(*) AS count,
        IFNULL(SUM(s.grand_total), 0) AS total
      FROM sales s
      ${whereSql}
        ${whereSql ? 'AND' : 'WHERE'} IFNULL(s.type, 'sale') = 'sale'
      GROUP BY IFNULL(s.payment_method, 'cash')
      ORDER BY total DESC
    `)
    .all(...params);

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
        COUNT(s.id) AS sales_count,
        IFNULL(SUM(s.grand_total), 0) AS total_spent
      FROM customers c
      JOIN sales s ON s.customer_id = c.id
      ${whereSql}
        ${whereSql ? 'AND' : 'WHERE'} IFNULL(s.type, 'sale') = 'sale'
      GROUP BY c.id
      ORDER BY total_spent DESC
      LIMIT 10
    `)
    .all(...params);

  return {
    summary: {
      sales_count: Number(summary.sales_count || 0),
      returns_count: Number(summary.returns_count || 0),
      gross_sales: Number(summary.gross_sales || 0),
      total_returns: Number(summary.total_returns || 0),
      loyalty_discounts: Number(summary.loyalty_discounts || 0),
      net_sales: Number(summary.net_sales || 0),
      gross_profit_before_discounts: Number(
        profitRow.gross_profit_before_discounts || 0
      ),
      net_profit_after_discounts: Number(
        profitRow.net_profit_after_discounts || 0
      )
    },
    topProducts,
    dailySales,
    paymentMethods,
    lowStock,
    topCustomers
  };
}