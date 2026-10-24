import { getDb } from '../db';

import {
  getInventoryCostState,
  issueStockAtAverageCost,
  receiveStockAtCost,
} from '../inventory-cost';
import { roundMoney } from '../../../shared/money';

const STOCK_SUM_SQL = `
  IFNULL(SUM(
    CASE
      WHEN sm.type = 'in' THEN sm.quantity
      WHEN sm.type = 'out' THEN -sm.quantity
      ELSE 0
    END
  ), 0)
`;

export function getInventoryList(input?: {
  search?: string;
  status?: 'all' | 'available' | 'low' | 'out' | 'inactive';
  categoryId?: number | string | null;
}) {
  const db = getDb();

  const search = input?.search?.trim() || '';
  const status = input?.status || 'all';

  const params: any[] = [];

  let categorySql = '';
  const rawCategoryId = input?.categoryId;
  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null;

  if (categoryId && Number.isFinite(categoryId) && categoryId > 0) {
    categorySql = `AND p.category_id = ?`;
    params.push(categoryId);
  }

  let searchSql = '';

  if (search) {
    searchSql = `
      AND (
        p.name LIKE ?
        OR IFNULL(v.barcode, '') LIKE ?
        OR IFNULL(v.size, '') LIKE ?
        OR IFNULL(v.color, '') LIKE ?
      )
    `;

    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  let havingSql = '';

  if (status === 'available') {
    havingSql = `
      HAVING p.is_active = 1
        AND v.is_active = 1
        AND stock > v.min_stock
    `;
  }

  if (status === 'low') {
    havingSql = `
      HAVING p.is_active = 1
        AND v.is_active = 1
        AND stock > 0
        AND stock <= v.min_stock
    `;
  }

  if (status === 'out') {
    havingSql = `
      HAVING p.is_active = 1
        AND v.is_active = 1
        AND stock = 0
    `;
  }

  if (status === 'inactive') {
    havingSql = `
      HAVING p.is_active != 1
        OR v.is_active != 1
    `;
  }

  return db
    .prepare(
      `
      SELECT
        v.id AS variant_id,
        p.id AS product_id,
        p.name AS product_name,
        p.category_id AS category_id,
        c.name AS category_name,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        v.average_cost,
        v.inventory_value,
        v.sell_price,
        v.min_stock,
        v.is_active,
        p.is_active AS product_is_active,
        ${STOCK_SUM_SQL} AS stock
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock_movements sm ON sm.variant_id = v.id
      WHERE 1 = 1
        ${categorySql}
        ${searchSql}
      GROUP BY v.id
      ${havingSql}
      ORDER BY
        CASE
          WHEN stock < 0 THEN 0
          WHEN stock = 0 THEN 1
          WHEN stock <= v.min_stock THEN 2
          ELSE 3
        END,
        p.name ASC
    `,
    )
    .all(...params);
}

export type InventoryPageStatus = 'available' | 'low' | 'out' | 'inactive';

export type InventoryPageInput = {
  search?: string;

  status?: 'all' | InventoryPageStatus;

  statuses?: InventoryPageStatus[];

  categoryId?: number | string | null;
  limit?: number;
  offset?: number;
};

export function listInventoryPage(input?: InventoryPageInput) {
  const db = getDb();

  const search = input?.search?.trim() || '';

  const selectedStatuses: InventoryPageStatus[] = Array.isArray(input?.statuses)
    ? Array.from(new Set(input.statuses))
    : input?.status && input.status !== 'all'
      ? [input.status]
      : [];

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200);

  const offset = Math.max(Number(input?.offset || 0), 0);

  const params: any[] = [];

  const rawCategoryId = input?.categoryId;

  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null;

  let categorySql = '';

  if (categoryId && Number.isFinite(categoryId) && categoryId > 0) {
    categorySql = `
      AND p.category_id = ?
    `;

    params.push(categoryId);
  }

  let searchSql = '';

  if (search) {
    searchSql = `
      AND (
        p.name LIKE ?
        OR IFNULL(v.barcode, '') LIKE ?
        OR IFNULL(v.size, '') LIKE ?
        OR IFNULL(v.color, '') LIKE ?
      )
    `;

    const q = `%${search}%`;

    params.push(q, q, q, q);
  }

  const statusConditions: string[] = [];

  if (selectedStatuses.includes('available')) {
    statusConditions.push(`
      (
        product_is_active = 1
        AND is_active = 1
        AND stock > min_stock
      )
    `);
  }

  if (selectedStatuses.includes('low')) {
    statusConditions.push(`
      (
        product_is_active = 1
        AND is_active = 1
        AND stock > 0
        AND stock <= min_stock
      )
    `);
  }

  if (selectedStatuses.includes('out')) {
    statusConditions.push(`
      (
        product_is_active = 1
        AND is_active = 1
        AND stock = 0
      )
    `);
  }

  if (selectedStatuses.includes('inactive')) {
    statusConditions.push(`
      (
        product_is_active != 1
        OR is_active != 1
      )
    `);
  }

  const statusSql =
    statusConditions.length > 0 ? `WHERE ${statusConditions.join(' OR ')}` : '';

  const queryRows = db
    .prepare(
      `
      WITH
      candidates AS (
        SELECT
          v.id AS variant_id,
          p.id AS product_id,
          p.name AS product_name,
          p.category_id AS category_id,
          c.name AS category_name,

          v.barcode,
          v.size,
          v.color,

          v.buy_price,
          v.average_cost,
          v.inventory_value,
          v.sell_price,
          v.min_stock,

          v.is_active,

          p.is_active
            AS product_is_active

        FROM product_variants v

        JOIN products p
          ON p.id = v.product_id

        LEFT JOIN categories c
          ON c.id = p.category_id

        WHERE 1 = 1
          ${categorySql}
          ${searchSql}
      ),

      stock_totals AS (
        SELECT
          sm.variant_id,

          IFNULL(
            SUM(
              CASE
                WHEN sm.type = 'in'
                  THEN sm.quantity

                WHEN sm.type = 'out'
                  THEN -sm.quantity

                ELSE 0
              END
            ),
            0
          ) AS stock

        FROM stock_movements sm

        JOIN candidates candidate
          ON candidate.variant_id =
            sm.variant_id

        GROUP BY
          sm.variant_id
      ),

      inventory_base AS (
        SELECT
          candidate.*,

          IFNULL(
            stock_totals.stock,
            0
          ) AS stock

        FROM candidates candidate

        LEFT JOIN stock_totals
          ON stock_totals.variant_id =
            candidate.variant_id
      ),

      filtered_inventory AS (
        SELECT *

        FROM inventory_base

        ${statusSql}
      ),

      summary AS (
        SELECT
          COUNT(*) AS total,

          IFNULL(
            SUM(
              CASE
                WHEN
                  product_is_active = 1
                  AND is_active = 1
                  AND stock > min_stock

                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS available,

          IFNULL(
            SUM(
              CASE
                WHEN
                  product_is_active = 1
                  AND is_active = 1
                  AND stock > 0
                  AND stock <= min_stock

                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS low,

          IFNULL(
            SUM(
              CASE
                WHEN
                  product_is_active = 1
                  AND is_active = 1
                  AND stock = 0

                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS out,

          IFNULL(
            SUM(
              CASE
                WHEN
                  product_is_active != 1
                  OR is_active != 1

                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS inactive,

          IFNULL(
            SUM(
              CASE
                WHEN stock > 0
                  THEN inventory_value

                ELSE 0
              END
            ),
            0
          ) AS total_buy_value,

          IFNULL(
            SUM(
              CASE
                WHEN stock > 0
                  THEN stock * sell_price

                ELSE 0
              END
            ),
            0
          ) AS total_sell_value

        FROM filtered_inventory
      ),

      paged AS (
        SELECT *

        FROM filtered_inventory

        ORDER BY
          CASE
            WHEN stock < 0 THEN 0
            WHEN stock = 0 THEN 1
            WHEN stock <= min_stock THEN 2
            ELSE 3
          END,

          product_name ASC,

          variant_id ASC

        LIMIT ?
        OFFSET ?
      )

      SELECT
        paged.*,

        summary.total
          AS summary_total,

        summary.available
          AS summary_available,

        summary.low
          AS summary_low,

        summary.out
          AS summary_out,

        summary.inactive
          AS summary_inactive,

        summary.total_buy_value
          AS summary_total_buy_value,

        summary.total_sell_value
          AS summary_total_sell_value

      FROM summary

      LEFT JOIN paged
        ON 1 = 1

      ORDER BY
        CASE
          WHEN paged.stock < 0 THEN 0
          WHEN paged.stock = 0 THEN 1
          WHEN paged.stock <= paged.min_stock THEN 2
          ELSE 3
        END,

        paged.product_name ASC,

        paged.variant_id ASC
      `,
    )
    .all(...params, limit, offset) as any[];

  const summaryRow = queryRows[0] || {};

  const rows = queryRows
    .filter((row) => row.variant_id !== null && row.variant_id !== undefined)
    .map((row) => {
      const {
        summary_total: _summaryTotal,
        summary_available: _summaryAvailable,
        summary_low: _summaryLow,
        summary_out: _summaryOut,
        summary_inactive: _summaryInactive,
        summary_total_buy_value: _summaryTotalBuyValue,
        summary_total_sell_value: _summaryTotalSellValue,
        ...inventoryRow
      } = row;

      return inventoryRow;
    });

  const total = Number(summaryRow.summary_total || 0);

  return {
    rows,

    total,

    limit,

    offset,

    summary: {
      total,

      available: Number(summaryRow.summary_available || 0),

      low: Number(summaryRow.summary_low || 0),

      out: Number(summaryRow.summary_out || 0),

      inactive: Number(summaryRow.summary_inactive || 0),

      totalBuyValue: roundMoney(summaryRow.summary_total_buy_value),

      totalSellValue: roundMoney(summaryRow.summary_total_sell_value),
    },
  };
}

export type InventoryAnalyticsInput = {
  categoryId?: number | string | null;
};

export function getInventoryAnalytics(input?: InventoryAnalyticsInput) {
  const db = getDb();

  const rawCategoryId = input?.categoryId;

  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null;

  const params: any[] = [];

  let categorySql = '';

  if (categoryId && Number.isFinite(categoryId) && categoryId > 0) {
    categorySql = 'AND p.category_id = ?';

    params.push(categoryId);
  }

  const inventorySql = `
    SELECT
      v.id AS variant_id,

      p.name AS product_name,

      v.barcode,
      v.size,
      v.color,

      v.sell_price,
      v.inventory_value,

      v.is_active,

      p.is_active
        AS product_is_active,

      ${STOCK_SUM_SQL}
        AS stock

    FROM product_variants v

    JOIN products p
      ON p.id = v.product_id

    LEFT JOIN stock_movements sm
      ON sm.variant_id = v.id

    WHERE 1 = 1
      ${categorySql}

    GROUP BY v.id
  `;

  /*
   * صافي حركة البيع:
   *
   * بيع          +
   * مرتجع        -
   * صنف خرج باستبدال -
   * صنف دخل مكانه +
   */
  /*
   * Inventory analytics intentionally uses
   * the real operation timestamp (created_at),
   * not the accounting Business Date.
   *
   * "Last 30 days", "last sale" and
   * "dead stock after 90 days" measure
   * real elapsed operational time.
   *
   * Financial reports use Business Date;
   * inventory recency does not.
   */
  const activitySql = `
    SELECT
      si.variant_id,

      si.quantity
        AS quantity_delta,

      date(
        s.created_at,
        'localtime'
      ) AS activity_date

    FROM sale_items si

    JOIN sales s
      ON s.id = si.sale_id

    WHERE
      IFNULL(
        s.type,
        'sale'
      ) = 'sale'

      AND s.cancelled_at
        IS NULL

    UNION ALL

    SELECT
      sri.variant_id,

      -sri.quantity
        AS quantity_delta,

      date(
        sr.created_at,
        'localtime'
      ) AS activity_date

    FROM sale_return_items sri

    JOIN sale_returns sr
      ON sr.id = sri.return_id

    JOIN sales os
      ON os.id =
        sr.original_sale_id

    WHERE
      sr.cancelled_at IS NULL

      AND os.cancelled_at
        IS NULL

      AND IFNULL(
        os.type,
        'sale'
      ) = 'sale'

    UNION ALL

    SELECT
      sei.old_variant_id
        AS variant_id,

      -sei.quantity
        AS quantity_delta,

      date(
        se.created_at,
        'localtime'
      ) AS activity_date

    FROM sale_exchange_items sei

    JOIN sale_exchanges se
      ON se.id =
        sei.exchange_id

    JOIN sales os
      ON os.id =
        se.original_sale_id

    WHERE
      se.cancelled_at IS NULL

      AND os.cancelled_at
        IS NULL

      AND IFNULL(
        os.type,
        'sale'
      ) = 'sale'

    UNION ALL

    SELECT
      sei.new_variant_id
        AS variant_id,

      sei.quantity
        AS quantity_delta,

      date(
        se.created_at,
        'localtime'
      ) AS activity_date

    FROM sale_exchange_items sei

    JOIN sale_exchanges se
      ON se.id =
        sei.exchange_id

    JOIN sales os
      ON os.id =
        se.original_sale_id

    WHERE
      se.cancelled_at IS NULL

      AND os.cancelled_at
        IS NULL

      AND IFNULL(
        os.type,
        'sale'
      ) = 'sale'
  `;

  /*
   * آخر مرة خرج فيها الصنف
   * كبيع فعلي للعميل.
   *
   * المرتجع لا يعتبر بيعًا جديدًا.
   */
  const lastOutboundSql = `
    SELECT
      variant_id,

      MAX(activity_date)
        AS last_sale_date

    FROM (
      SELECT
        si.variant_id,

        date(
          s.created_at,
          'localtime'
        ) AS activity_date

      FROM sale_items si

      JOIN sales s
        ON s.id =
          si.sale_id

      WHERE
        IFNULL(
          s.type,
          'sale'
        ) = 'sale'

        AND s.cancelled_at
          IS NULL

      UNION ALL

      SELECT
        sei.new_variant_id
          AS variant_id,

        date(
          se.created_at,
          'localtime'
        ) AS activity_date

      FROM sale_exchange_items sei

      JOIN sale_exchanges se
        ON se.id =
          sei.exchange_id

      JOIN sales os
        ON os.id =
          se.original_sale_id

      WHERE
        se.cancelled_at IS NULL

        AND os.cancelled_at
          IS NULL

        AND IFNULL(
          os.type,
          'sale'
        ) = 'sale'
    ) outbound

    GROUP BY variant_id
  `;

  const analyticsRow = db
    .prepare(
      `
      WITH
      inventory AS (
        ${inventorySql}
      ),

      activity AS (
        ${activitySql}
      ),

      recent_activity AS (
        SELECT
          a.variant_id,

          IFNULL(
            SUM(
              CASE
                WHEN a.activity_date >=
                  date(
                    'now',
                    'localtime',
                    '-29 days'
                  )

                THEN a.quantity_delta

                ELSE 0
              END
            ),
            0
          ) AS net_sold_units_30d

        FROM activity a

        JOIN inventory i
          ON i.variant_id =
            a.variant_id

        GROUP BY
          a.variant_id
      ),

      last_outbound_all AS (
        ${lastOutboundSql}
      ),

      last_outbound AS (
        SELECT
          l.variant_id,
          l.last_sale_date

        FROM last_outbound_all l

        JOIN inventory i
          ON i.variant_id =
            l.variant_id
      ),

      metrics AS (
        SELECT
          i.variant_id,
          i.product_name,

          i.barcode,
          i.size,
          i.color,

          i.sell_price,
          i.inventory_value,

          i.is_active,
          i.product_is_active,

          i.stock,

          IFNULL(
            r.net_sold_units_30d,
            0
          ) AS net_sold_units_30d,

          l.last_sale_date

        FROM inventory i

        LEFT JOIN recent_activity r
          ON r.variant_id =
            i.variant_id

        LEFT JOIN last_outbound l
          ON l.variant_id =
            i.variant_id
      ),

      top_mover AS (
        SELECT
          variant_id,
          product_name,

          barcode,
          size,
          color,

          stock
            AS current_stock,

          net_sold_units_30d
            AS sold_units_30d

        FROM metrics

        WHERE
          product_is_active = 1

          AND is_active = 1

          AND net_sold_units_30d > 0

        ORDER BY
          net_sold_units_30d DESC,

          product_name ASC,

          variant_id ASC

        LIMIT 1
      )

      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN
                m.product_is_active = 1

                AND m.is_active = 1

                AND m.stock > 0

              THEN m.stock

              ELSE 0
            END
          ),
          0
        ) AS stock_units,

        IFNULL(
          SUM(
            CASE
              WHEN
                m.product_is_active = 1

                AND m.is_active = 1

              THEN
                m.net_sold_units_30d

              ELSE 0
            END
          ),
          0
        ) AS sold_units_30d,

        IFNULL(
          SUM(
            CASE
              WHEN
                m.product_is_active = 1

                AND m.is_active = 1

                AND m.stock > 0

                AND (
                  m.last_sale_date IS NULL

                  OR m.last_sale_date <
                    date(
                      'now',
                      'localtime',
                      '-90 days'
                    )
                )

              THEN 1

              ELSE 0
            END
          ),
          0
        ) AS dead_stock_variants_90d,

        IFNULL(
          SUM(
            CASE
              WHEN
                m.product_is_active = 1

                AND m.is_active = 1

                AND m.stock > 0

                AND (
                  m.last_sale_date IS NULL

                  OR m.last_sale_date <
                    date(
                      'now',
                      'localtime',
                      '-90 days'
                    )
                )

              THEN m.stock

              ELSE 0
            END
          ),
          0
        ) AS dead_stock_units_90d,

        IFNULL(
          SUM(
            CASE
              WHEN
                m.product_is_active = 1

                AND m.is_active = 1

                AND m.stock > 0

                AND (
                  m.last_sale_date IS NULL

                  OR m.last_sale_date <
                    date(
                      'now',
                      'localtime',
                      '-90 days'
                    )
                )

              THEN m.inventory_value

              ELSE 0
            END
          ),
          0
        ) AS dead_stock_value_90d,

        IFNULL(
          SUM(
            CASE
              WHEN
                m.product_is_active = 1

                AND m.is_active = 1

                AND m.stock > 0

              THEN
                (
                  m.stock *
                  m.sell_price
                )
                -
                m.inventory_value

              ELSE 0
            END
          ),
          0
        ) AS potential_gross_profit,

        (
          SELECT variant_id
          FROM top_mover
        ) AS top_mover_variant_id,

        (
          SELECT product_name
          FROM top_mover
        ) AS top_mover_product_name,

        (
          SELECT barcode
          FROM top_mover
        ) AS top_mover_barcode,

        (
          SELECT size
          FROM top_mover
        ) AS top_mover_size,

        (
          SELECT color
          FROM top_mover
        ) AS top_mover_color,

        (
          SELECT current_stock
          FROM top_mover
        ) AS top_mover_current_stock,

        (
          SELECT sold_units_30d
          FROM top_mover
        ) AS top_mover_sold_units_30d

      FROM metrics m
      `,
    )
    .get(...params) as any;

  return {
    stock_units: Number(analyticsRow?.stock_units || 0),

    sold_units_30d: Number(analyticsRow?.sold_units_30d || 0),

    dead_stock_variants_90d: Number(analyticsRow?.dead_stock_variants_90d || 0),

    dead_stock_units_90d: Number(analyticsRow?.dead_stock_units_90d || 0),

    dead_stock_value_90d: roundMoney(analyticsRow?.dead_stock_value_90d),

    potential_gross_profit: roundMoney(analyticsRow?.potential_gross_profit),

    top_mover:
      analyticsRow?.top_mover_variant_id != null
        ? {
            variant_id: Number(analyticsRow.top_mover_variant_id),

            product_name: String(analyticsRow.top_mover_product_name || ''),

            barcode: analyticsRow.top_mover_barcode ?? null,

            size: analyticsRow.top_mover_size ?? null,

            color: analyticsRow.top_mover_color ?? null,

            current_stock: Number(analyticsRow.top_mover_current_stock || 0),

            sold_units_30d: Number(analyticsRow.top_mover_sold_units_30d || 0),
          }
        : null,
  };
}

export function getVariantStock(variantId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT
        IFNULL(SUM(
          CASE
            WHEN type = 'in' THEN quantity
            WHEN type = 'out' THEN -quantity
            ELSE 0
          END
        ), 0) AS stock
      FROM stock_movements
      WHERE variant_id = ?
    `,
    )
    .get(variantId) as { stock: number } | undefined;

  return Number(row?.stock || 0);
}

export function adjustVariantStock(input: {
  variant_id: number;
  target_stock: number;
  notes?: string | null;
  actor_id?: number | null;
}) {
  const db = getDb();

  const variantId = Number(input.variant_id);
  const targetStock = Number(input.target_stock);

  if (!variantId) {
    throw new Error('رقم الصنف مطلوب');
  }

  if (!Number.isFinite(targetStock) || targetStock < 0) {
    throw new Error('المخزون الجديد غير صحيح');
  }

  const variant = db
    .prepare(
      `
      SELECT
        v.id,
        v.buy_price,
        p.name AS product_name,
        v.size,
        v.color
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
      LIMIT 1
    `,
    )
    .get(variantId) as any;

  if (!variant) {
    throw new Error('الصنف غير موجود');
  }

  const tx = db.transaction(() => {
    const oldStock = getVariantStock(variantId);
    const diff = targetStock - oldStock;

    if (diff === 0) {
      return {
        success: true,
        variant_id: variantId,
        old_stock: oldStock,
        new_stock: targetStock,
        diff: 0,
      };
    }

    if (diff > 0) {
      const costState = getInventoryCostState(db, variantId);

      const inboundUnitCost =
        oldStock > 0 ? costState.average_cost : Number(variant.buy_price || 0);

      receiveStockAtCost(db, {
        variant_id: variantId,

        quantity: diff,

        unit_cost: inboundUnitCost,
        created_by: input.actor_id ?? null,
        reference_id: null,

        reference_type: 'manual_adjust',

        notes:
          input.notes?.trim() ||
          `تسوية مخزون: من ${oldStock} إلى ${targetStock}`,
      });
    } else {
      issueStockAtAverageCost(db, {
        variant_id: variantId,

        quantity: Math.abs(diff),
        created_by: input.actor_id ?? null,
        reference_id: null,

        reference_type: 'manual_adjust',

        notes:
          input.notes?.trim() ||
          `تسوية مخزون: من ${oldStock} إلى ${targetStock}`,
      });
    }

    return {
      success: true,
      variant_id: variantId,
      old_stock: oldStock,
      new_stock: targetStock,
      diff,
    };
  });

  return tx();
}

export function getStockMovements(
  input: {
    variant_id?: number;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const db = getDb();

  const variantId = input.variant_id ? Number(input.variant_id) : null;

  const search = input.search?.trim() || '';

  const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);

  const offset = Math.max(Number(input.offset || 0), 0);

  const where: string[] = [];
  const params: any[] = [];

  if (variantId) {
    where.push(`sm.variant_id = ?`);
    params.push(variantId);
  }

  if (search) {
    where.push(`
      (
        p.name LIKE ?
        OR IFNULL(v.barcode, '') LIKE ?
        OR IFNULL(v.size, '') LIKE ?
        OR IFNULL(v.color, '') LIKE ?
        OR IFNULL(sm.reference_type, '') LIKE ?
        OR IFNULL(sm.notes, '') LIKE ?
      )
    `);

    const q = `%${search}%`;

    params.push(q, q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        sm.id,
        sm.variant_id,
        sm.type,
        sm.quantity,
        sm.unit_cost,
        sm.cost_value,

        CASE
          WHEN sm.type = 'in' THEN sm.quantity
          WHEN sm.type = 'out' THEN -sm.quantity
          ELSE 0
        END AS signed_quantity,

        sm.reference_id,
        sm.reference_type,
        sm.notes,
        sm.created_by,
        sm.created_at,

        creator.name AS created_by_name,

        p.name AS product_name,
        v.barcode,
        v.size,
        v.color

      FROM stock_movements sm

      JOIN product_variants v
        ON v.id = sm.variant_id

      JOIN products p
        ON p.id = v.product_id

      LEFT JOIN users creator
        ON creator.id = sm.created_by

      ${whereSql}

      ORDER BY sm.id DESC

      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total

      FROM stock_movements sm

      JOIN product_variants v
        ON v.id = sm.variant_id

      JOIN products p
        ON p.id = v.product_id

      ${whereSql}
    `,
    )
    .get(...params) as { total: number };

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  };
}
