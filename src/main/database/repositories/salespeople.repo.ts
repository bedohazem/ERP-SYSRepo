import { getDb } from '../db';
import { roundMoney } from '../../../shared/money';

export type SalespersonRow = {
  id: number;
  user_id: number | null;
  name: string;

  is_active: number;

  created_at: string;

  updated_at: string;
};

function normalizeSalespersonName(value: unknown) {
  const name = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!name) {
    throw new Error('اسم البائع مطلوب');
  }

  if (name.length > 120) {
    throw new Error('اسم البائع طويل جدًا');
  }

  return name;
}

export function getSalespersonById(
  salespersonIdInput: number,
): SalespersonRow | null {
  const salespersonId = Number(salespersonIdInput || 0);

  if (!Number.isInteger(salespersonId) || salespersonId <= 0) {
    return null;
  }

  const row = getDb()
    .prepare(
      `
      SELECT
        id,
        user_id,
        name,
        is_active,
        created_at,
        updated_at

      FROM salespeople

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(salespersonId) as SalespersonRow | undefined;

  return row || null;
}

export function listSalespeople(input?: {
  active_only?: boolean;
}): SalespersonRow[] {
  const activeOnly = input?.active_only === true;

  return getDb()
    .prepare(
      `
      SELECT
        id,
        user_id,
        name,
        is_active,
        created_at,
        updated_at

      FROM salespeople

      ${activeOnly ? 'WHERE is_active = 1' : ''}

      ORDER BY
        is_active DESC,

        name COLLATE NOCASE ASC,

        id ASC
      `,
    )
    .all() as SalespersonRow[];
}

export function createSalesperson(nameInput: string): SalespersonRow {
  const db = getDb();

  const name = normalizeSalespersonName(nameInput);

  const duplicate = db
    .prepare(
      `
      SELECT id

      FROM salespeople

      WHERE name = ?
        COLLATE NOCASE

      LIMIT 1
      `,
    )
    .get(name) as
    | {
        id: number;
      }
    | undefined;

  if (duplicate) {
    throw new Error('اسم البائع مستخدم بالفعل');
  }

  const result = db
    .prepare(
      `
      INSERT INTO salespeople (
        name,
        is_active
      )

      VALUES (?, 1)
      `,
    )
    .run(name);

  const salesperson = getSalespersonById(Number(result.lastInsertRowid));

  if (!salesperson) {
    throw new Error('تعذر إنشاء البائع');
  }

  return salesperson;
}

export function updateSalesperson(
  salespersonIdInput: number,
  nameInput: string,
): SalespersonRow {
  const db = getDb();

  const salespersonId = Number(salespersonIdInput || 0);

  if (!Number.isInteger(salespersonId) || salespersonId <= 0) {
    throw new Error('البائع غير صحيح');
  }

  if (!getSalespersonById(salespersonId)) {
    throw new Error('البائع غير موجود');
  }

  const name = normalizeSalespersonName(nameInput);

  const duplicate = db
    .prepare(
      `
      SELECT id

      FROM salespeople

      WHERE name = ?
        COLLATE NOCASE

        AND id <> ?

      LIMIT 1
      `,
    )
    .get(name, salespersonId) as
    | {
        id: number;
      }
    | undefined;

  if (duplicate) {
    throw new Error('اسم البائع مستخدم بالفعل');
  }

  db.prepare(
    `
    UPDATE salespeople

    SET
      name = ?,
      updated_at =
        CURRENT_TIMESTAMP

    WHERE id = ?
    `,
  ).run(name, salespersonId);

  return getSalespersonById(salespersonId)!;
}

export function setSalespersonActive(
  salespersonIdInput: number,
  isActiveInput: boolean,
): SalespersonRow {
  const db = getDb();

  const salespersonId = Number(salespersonIdInput || 0);

  if (!Number.isInteger(salespersonId) || salespersonId <= 0) {
    throw new Error('البائع غير صحيح');
  }

  const result = db
    .prepare(
      `
      UPDATE salespeople

      SET
        is_active = ?,
        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    )
    .run(isActiveInput ? 1 : 0, salespersonId);

  if (Number(result.changes || 0) === 0) {
    throw new Error('البائع غير موجود');
  }

  return getSalespersonById(salespersonId)!;
}

function normalizeTargetMonth(value: unknown) {
  const month = String(value ?? '').trim();

  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) {
    throw new Error('شهر التارجت غير صحيح');
  }

  const monthNumber = Number(match[2]);

  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error('شهر التارجت غير صحيح');
  }

  return month;
}

export function setSalespersonMonthlyTarget(input: {
  salesperson_id: number;
  month: string;
  target_amount: number;
}) {
  const db = getDb();

  const salespersonId = Number(input.salesperson_id || 0);

  if (!Number.isInteger(salespersonId) || salespersonId <= 0) {
    throw new Error('البائع غير صحيح');
  }

  const salesperson = getSalespersonById(salespersonId);

  if (!salesperson) {
    throw new Error('البائع غير موجود');
  }

  const month = normalizeTargetMonth(input.month);

  const rawTarget = Number(input.target_amount);

  if (!Number.isFinite(rawTarget) || rawTarget < 0) {
    throw new Error('قيمة التارجت غير صحيحة');
  }

  const targetAmount = roundMoney(rawTarget);

  db.prepare(
    `
    INSERT INTO salesperson_targets (
      salesperson_id,
      month,
      target_amount
    )

    VALUES (?, ?, ?)

    ON CONFLICT(
      salesperson_id,
      month
    )

    DO UPDATE SET
      target_amount =
        excluded.target_amount,

      updated_at =
        CURRENT_TIMESTAMP
    `,
  ).run(salespersonId, month, targetAmount);

  return {
    salesperson_id: salespersonId,

    month,

    target_amount: targetAmount,
  };
}

export function getSalespeoplePerformance(monthInput: string) {
  const db = getDb();

  const month = normalizeTargetMonth(monthInput);

  const rows = db
    .prepare(
      `
      SELECT
        sp.id,
        sp.name,
        sp.is_active,

        IFNULL(
          st.target_amount,
          0
        ) AS target_amount,

        IFNULL(
          perf.sales_count,
          0
        ) AS sales_count,

        IFNULL(
          perf.sales_total,
          0
        ) AS sales_total,

        IFNULL(
          perf.returns_count,
          0
        ) AS returns_count,

        IFNULL(
          perf.returns_total,
          0
        ) AS returns_total,

        IFNULL(
          perf.exchange_count,
          0
        ) AS exchange_count,

        IFNULL(
          perf.exchange_adjustment,
          0
        ) AS exchange_adjustment,

        IFNULL(
          perf.net_sales,
          0
        ) AS net_sales

      FROM salespeople sp

      LEFT JOIN
        salesperson_targets st
        ON
          st.salesperson_id =
            sp.id

          AND st.month = ?

      LEFT JOIN (
        SELECT
          x.salesperson_id,

          SUM(
            x.sales_count
          ) AS sales_count,

          SUM(
            x.sale_amount
          ) AS sales_total,

          SUM(
            x.returns_count
          ) AS returns_count,

          SUM(
            x.return_amount
          ) AS returns_total,

          SUM(
            x.exchange_count
          ) AS exchange_count,

          SUM(
            x.exchange_adjustment
          ) AS exchange_adjustment,

          SUM(
            x.sale_amount
            - x.return_amount
            + x.exchange_adjustment
          ) AS net_sales

        FROM (
          /*
           * البيع ينسب للبائع
           * المختار على الفاتورة.
           */
          SELECT
            s.salesperson_id,

            COALESCE(
              (
                SELECT
                  COALESCE(
                    NULLIF(
                      cs.business_date,
                      ''
                    ),

                    date(
                      cs.opened_at,
                      'localtime'
                    )
                  )

                FROM cash_shifts cs

                WHERE
                  cs.id =
                    s.shift_id

                LIMIT 1
              ),

              NULLIF(
                s.business_date,
                ''
              ),

              date(
                s.created_at,
                'localtime'
              )
            ) AS business_date,

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
           * بائع الفاتورة الأصلية،
           * وليس المستخدم الذي
           * نفذ المرتجع.
           */
          SELECT
            os.salesperson_id,

            COALESCE(
              (
                SELECT
                  COALESCE(
                    NULLIF(
                      cs.business_date,
                      ''
                    ),

                    date(
                      cs.opened_at,
                      'localtime'
                    )
                  )

                FROM cash_shifts cs

                WHERE
                  cs.id =
                    sr.shift_id

                LIMIT 1
              ),

              date(
                sr.created_at,
                'localtime'
              )
            ) AS business_date,

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
           * أيضًا لبائع الفاتورة
           * الأصلية.
           */
          SELECT
            os.salesperson_id,

            COALESCE(
              (
                SELECT
                  COALESCE(
                    NULLIF(
                      cs.business_date,
                      ''
                    ),

                    date(
                      cs.opened_at,
                      'localtime'
                    )
                  )

                FROM cash_shifts cs

                WHERE
                  cs.id =
                    se.shift_id

                LIMIT 1
              ),

              NULLIF(
                se.business_date,
                ''
              ),

              date(
                se.created_at,
                'localtime'
              )
            ) AS business_date,

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

        WHERE
          x.salesperson_id
            IS NOT NULL

          AND substr(
            x.business_date,
            1,
            7
          ) = ?

        GROUP BY
          x.salesperson_id
      ) perf

        ON
          perf.salesperson_id =
            sp.id

      ORDER BY
        sp.is_active DESC,

        net_sales DESC,

        sp.name
          COLLATE NOCASE ASC
      `,
    )
    .all(month, month) as any[];

  return rows.map((row) => {
    const targetAmount = roundMoney(row.target_amount);

    const netSales = roundMoney(row.net_sales);

    const achievementPercent =
      targetAmount > 0
        ? Math.round((netSales / targetAmount) * 10000) / 100
        : 0;

    return {
      id: Number(row.id),

      name: String(row.name || ''),

      is_active: Number(row.is_active || 0),

      month,

      target_amount: targetAmount,

      sales_count: Number(row.sales_count || 0),

      sales_total: roundMoney(row.sales_total),

      returns_count: Number(row.returns_count || 0),

      returns_total: roundMoney(row.returns_total),

      exchange_count: Number(row.exchange_count || 0),

      exchange_adjustment: roundMoney(row.exchange_adjustment),

      net_sales: netSales,

      achievement_percent: achievementPercent,

      remaining_target: Math.max(0, roundMoney(targetAmount - netSales)),

      exceeded_target: Math.max(0, roundMoney(netSales - targetAmount)),
    };
  });
}

export function getOrCreateSalespersonForUser(
  userIdInput: number,
): SalespersonRow {
  const db = getDb();

  const userId = Number(userIdInput || 0);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('الكاشير غير صحيح');
  }

  const user = db
    .prepare(
      `
      SELECT
        id,
        name,
        is_active

      FROM users

      WHERE id = ?

      LIMIT 1
      `,
    )
    .get(userId) as
    | {
        id: number;
        name: string;
        is_active: number;
      }
    | undefined;

  if (!user || Number(user.is_active) !== 1) {
    throw new Error('الكاشير غير موجود أو غير مفعل');
  }

  const linked = db
    .prepare(
      `
      SELECT id

      FROM salespeople

      WHERE user_id = ?

      LIMIT 1
      `,
    )
    .get(userId) as
    | {
        id: number;
      }
    | undefined;

  if (linked) {
    return getSalespersonById(linked.id)!;
  }

  const name = normalizeSalespersonName(user.name);

  const sameName = db
    .prepare(
      `
      SELECT
        id,
        user_id

      FROM salespeople

      WHERE name = ?
        COLLATE NOCASE

      LIMIT 1
      `,
    )
    .get(name) as
    | {
        id: number;
        user_id: number | null;
      }
    | undefined;

  if (sameName) {
    if (sameName.user_id !== null && Number(sameName.user_id) !== userId) {
      throw new Error('يوجد بائع بنفس اسم الكاشير مرتبط بمستخدم آخر');
    }

    db.prepare(
      `
      UPDATE salespeople

      SET
        user_id = ?,
        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
      `,
    ).run(userId, sameName.id);

    return getSalespersonById(sameName.id)!;
  }

  const result = db
    .prepare(
      `
      INSERT INTO salespeople (
        user_id,
        name,
        is_active
      )

      VALUES (?, ?, 1)
      `,
    )
    .run(userId, name);

  const salesperson = getSalespersonById(Number(result.lastInsertRowid));

  if (!salesperson) {
    throw new Error('تعذر ربط الكاشير كبائع');
  }

  return salesperson;
}
