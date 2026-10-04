import { getDb } from '../db';
import { roundMoney } from '../../../shared/money';

export type SupplierInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  credit_days?: number | null;
};

export type SupplierUpdateInput = SupplierInput & {
  id: number;
};

function cleanText(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function normalizeCreditDays(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const days = Number(value);

  if (!Number.isInteger(days) || days < 0) {
    throw new Error('مدة الائتمان يجب أن تكون صفر أو عدد أيام صحيح موجب');
  }

  return days;
}

export function getSupplierAgingSummary(
  supplierId?: number | null,

  search?: string,
) {
  const db = getDb();

  const id = Number(supplierId || 0);

  const searchValue = String(search || '').trim();

  const where: string[] = [
    `
    IFNULL(
      pi.status,
      'active'
    ) != 'cancelled'
    `,

    `
    pi.cancelled_at
      IS NULL
    `,

    `
    ROUND(
      IFNULL(
        pi.remaining_amount,
        0
      ),
      2
    ) > 0
    `,
  ];

  const params: any[] = [];

  if (id > 0) {
    where.push('pi.supplier_id = ?');

    params.push(id);
  } else {
    /*
     * نفس Scope الخاص بقائمة الموردين:
     * الموردون النشطون فقط.
     */
    where.push('s.is_active = 1');

    if (searchValue) {
      where.push(`
        (
          s.name LIKE ?

          OR
          IFNULL(
            s.phone,
            ''
          ) LIKE ?

          OR
          IFNULL(
            s.email,
            ''
          ) LIKE ?

          OR
          IFNULL(
            s.address,
            ''
          ) LIKE ?
        )
      `);

      const q = `%${searchValue}%`;

      params.push(q, q, q, q);
    }
  }

  const row = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN age_days <= 30
              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS days_0_30,

        IFNULL(
          SUM(
            CASE
              WHEN age_days
                BETWEEN 31 AND 60
              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS days_31_60,

        IFNULL(
          SUM(
            CASE
              WHEN age_days
                BETWEEN 61 AND 90
              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS days_61_90,

        IFNULL(
          SUM(
            CASE
              WHEN age_days > 90
              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS days_90_plus,

        IFNULL(
          SUM(
            remaining_amount
          ),
          0
        ) AS total

      FROM (
        SELECT
          ROUND(
            IFNULL(
              pi.remaining_amount,
              0
            ),
            2
          ) AS remaining_amount,

          MAX(
            0,

            CAST(
              julianday(
                date(
                  'now',
                  'localtime'
                )
              )
              -
              julianday(
                COALESCE(
                  NULLIF(
                    pi.business_date,
                    ''
                  ),

                  date(
                    pi.created_at,
                    'localtime'
                  )
                )
              )

              AS INTEGER
            )
          ) AS age_days

        FROM purchase_invoices pi

        JOIN suppliers s
          ON s.id =
             pi.supplier_id

        WHERE
          ${where.join('\nAND ')}
      ) open_purchases
      `,
    )
    .get(...params) as any;

  return {
    days_0_30: roundMoney(row?.days_0_30),

    days_31_60: roundMoney(row?.days_31_60),

    days_61_90: roundMoney(row?.days_61_90),

    days_90_plus: roundMoney(row?.days_90_plus),

    total: roundMoney(row?.total),
  };
}

export function getSupplierDueSummary(
  supplierId?: number | null,
  search?: string,
) {
  const db = getDb();

  const id = Number(supplierId || 0);

  const searchValue = String(search || '').trim();

  const where: string[] = [
    `
    IFNULL(
      pi.status,
      'active'
    ) != 'cancelled'
    `,

    `
    pi.cancelled_at
      IS NULL
    `,

    `
    ROUND(
      IFNULL(
        pi.remaining_amount,
        0
      ),
      2
    ) > 0
    `,
  ];

  const params: any[] = [];

  if (id > 0) {
    where.push('pi.supplier_id = ?');

    params.push(id);
  } else {
    where.push('s.is_active = 1');

    if (searchValue) {
      where.push(`
        (
          s.name LIKE ?

          OR
          IFNULL(
            s.phone,
            ''
          ) LIKE ?

          OR
          IFNULL(
            s.email,
            ''
          ) LIKE ?

          OR
          IFNULL(
            s.address,
            ''
          ) LIKE ?
        )
      `);

      const q = `%${searchValue}%`;

      params.push(q, q, q, q);
    }
  }

  const row = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(
            CASE
              WHEN
                due_date IS NOT NULL
                AND due_date <
                  today_date

              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS overdue,

        IFNULL(
          SUM(
            CASE
              WHEN due_date =
                   today_date
              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS due_today,

        IFNULL(
          SUM(
            CASE
              WHEN
                due_date >
                  today_date

                AND due_date <=
                  date(
                    today_date,
                    '+7 days'
                  )

              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS due_soon,

        IFNULL(
          SUM(
            CASE
              WHEN due_date IS NULL
              THEN remaining_amount
              ELSE 0
            END
          ),
          0
        ) AS without_due_date,

        IFNULL(
          SUM(
            remaining_amount
          ),
          0
        ) AS total_open

      FROM (
        SELECT
          ROUND(
            IFNULL(
              pi.remaining_amount,
              0
            ),
            2
          ) AS remaining_amount,

          date(
            NULLIF(
              pi.due_date,
              ''
            )
          ) AS due_date,

          date(
            'now',
            'localtime'
          ) AS today_date

        FROM purchase_invoices pi

        JOIN suppliers s
          ON s.id =
             pi.supplier_id

        WHERE
          ${where.join('\nAND ')}
      ) open_purchases
      `,
    )
    .get(...params) as any;

  return {
    overdue: roundMoney(row?.overdue),

    due_today: roundMoney(row?.due_today),

    due_soon: roundMoney(row?.due_soon),

    without_due_date: roundMoney(row?.without_due_date),

    total_open: roundMoney(row?.total_open),
  };
}

export function getSuppliers(search = '') {
  const db = getDb();
  const q = `%${search.trim()}%`;

  if (!search.trim()) {
    return db
      .prepare(
        `
        SELECT *
        FROM suppliers
        WHERE is_active = 1
        ORDER BY
        CASE
          WHEN IFNULL(balance, 0) > 0 THEN 0
          ELSE 1
        END ASC,
        IFNULL(balance, 0) DESC,
        id DESC
      `,
      )
      .all();
  }

  return db
    .prepare(
      `
      SELECT *
      FROM suppliers
      WHERE is_active = 1
        AND (
          name LIKE ?
          OR IFNULL(phone, '') LIKE ?
          OR IFNULL(email, '') LIKE ?
          OR IFNULL(address, '') LIKE ?
        )
      ORDER BY
      CASE
        WHEN IFNULL(balance, 0) > 0 THEN 0
        ELSE 1
      END ASC,
      IFNULL(balance, 0) DESC,
      id DESC
    `,
    )
    .all(q, q, q, q);
}

export function listSuppliers(input?: {
  search?: string;

  limit?: number;
  offset?: number;

  include_summary?: boolean;
}) {
  const db = getDb();

  const search = input?.search?.trim() || '';

  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200);

  const offset = Math.max(Number(input?.offset || 0), 0);

  const where: string[] = [`is_active = 1`];

  const params: any[] = [];

  if (search) {
    where.push(`
      (
        name LIKE ?
        OR IFNULL(phone, '') LIKE ?
        OR IFNULL(email, '') LIKE ?
        OR IFNULL(address, '') LIKE ?
      )
    `);

    const q = `%${search}%`;

    params.push(q, q, q, q);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const rows = db
    .prepare(
      `
      SELECT *
      FROM suppliers

      ${whereSql}

      ORDER BY
      CASE
        WHEN IFNULL(balance, 0) > 0 THEN 0
        ELSE 1
      END ASC,
      IFNULL(balance, 0) DESC,
      id DESC

      LIMIT ?
      OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM suppliers

      ${whereSql}
    `,
    )
    .get(...params) as {
    total: number;
  };

  const aging = input?.include_summary
    ? getSupplierAgingSummary(null, search)
    : null;

  const due = input?.include_summary
    ? getSupplierDueSummary(null, search)
    : null;

  return {
    rows,

    total: Number(totalRow?.total || 0),

    limit,
    offset,

    summary: input?.include_summary
      ? {
          aging,
          due,
        }
      : undefined,
  };
}

export function getSupplierById(id: number) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT *
      FROM suppliers
      WHERE id = ?
      LIMIT 1
    `,
    )
    .get(id);
}

export function createSupplier(input: SupplierInput) {
  const db = getDb();

  const name = input.name?.trim();

  if (!name) {
    throw new Error('اسم المورد مطلوب');
  }

  const creditDays = normalizeCreditDays(input.credit_days);

  const result = db
    .prepare(
      `
      INSERT INTO suppliers (
        name,
        phone,
        email,
        address,
        notes,
        credit_days
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      name,
      cleanText(input.phone),
      cleanText(input.email),
      cleanText(input.address),
      cleanText(input.notes),
      creditDays,
    );

  return getSupplierById(Number(result.lastInsertRowid));
}

export function updateSupplier(input: SupplierUpdateInput) {
  const db = getDb();

  const id = Number(input.id);
  const name = input.name?.trim();

  if (!id) {
    throw new Error('Supplier ID is required');
  }

  if (!name) {
    throw new Error('اسم المورد مطلوب');
  }

  const current = db
    .prepare(
      `
    SELECT
      credit_days

    FROM suppliers

    WHERE id = ?

    LIMIT 1
    `,
    )
    .get(id) as
    | {
        credit_days: number | null;
      }
    | undefined;

  if (!current) {
    throw new Error('المورد غير موجود');
  }

  const creditDays =
    input.credit_days === undefined
      ? current.credit_days
      : normalizeCreditDays(input.credit_days);

  db.prepare(
    `
    UPDATE suppliers
    SET
      name = ?,
      phone = ?,
      email = ?,
      address = ?,
      notes = ?,
      credit_days = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(
    name,
    cleanText(input.phone),
    cleanText(input.email),
    cleanText(input.address),
    cleanText(input.notes),
    creditDays,
    id,
  );

  return getSupplierById(id);
}

export function deleteSupplier(id: number) {
  const db = getDb();

  const supplierId = Number(id);

  if (!supplierId) {
    throw new Error('رقم المورد غير صحيح');
  }

  const supplier = db
    .prepare(
      `
      SELECT
        id,
        name,
        IFNULL(balance, 0) AS balance
      FROM suppliers
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
    )
    .get(supplierId) as
    | {
        id: number;
        name: string;
        balance: number;
      }
    | undefined;

  if (!supplier) {
    throw new Error('المورد غير موجود');
  }

  const openDebtRow = db
    .prepare(
      `
      SELECT
        IFNULL(
          SUM(remaining_amount),
          0
        ) AS open_debt
      FROM purchase_invoices
      WHERE supplier_id = ?
        AND cancelled_at IS NULL
        AND remaining_amount > 0
      `,
    )
    .get(supplierId) as
    | {
        open_debt: number;
      }
    | undefined;

  const supplierBalance = roundMoney(supplier.balance);

  if (supplierBalance < 0) {
    throw new Error(
      `لا يمكن حذف المورد لأن له رصيدًا ماليًا غير مسوّى بقيمة ${Math.abs(supplierBalance)} ج.م`,
    );
  }

  const outstandingAmount = roundMoney(
    Math.max(supplierBalance, Number(openDebtRow?.open_debt || 0)),
  );

  if (outstandingAmount > 0) {
    throw new Error(
      `لا يمكن حذف المورد لأن له مستحقات بقيمة ${outstandingAmount} ج.م`,
    );
  }

  db.prepare(
    `
    UPDATE suppliers
    SET
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
  ).run(supplierId);

  return { ok: true };
}
