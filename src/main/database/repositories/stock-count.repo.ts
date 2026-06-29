import { getDb } from '../db';

const STOCK_SUM_SQL = `
  IFNULL(SUM(
    CASE
      WHEN sm.type = 'in' THEN sm.quantity
      WHEN sm.type = 'out' THEN -sm.quantity
      ELSE 0
    END
  ), 0)
`;

export function createStockCountSession(input: {
  title: string;
  notes?: string | null;
  actor_id?: number | null;
  categoryId?: number | string | null;
}) {
  const db = getDb();

  const title = String(input.title || '').trim();

  if (!title) {
    throw new Error('اسم جلسة الجرد مطلوب');
  }

  const rawCategoryId = input.categoryId;
  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null;

  const categorySql =
    categoryId && Number.isFinite(categoryId) && categoryId > 0
      ? `AND p.category_id = ?`
      : '';

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO stock_count_sessions (
          title,
          notes,
          status,
          created_by
        )
        VALUES (?, ?, 'open', ?)
        `
      )
      .run(title, input.notes?.trim() || null, input.actor_id ?? null);

    const sessionId = Number(result.lastInsertRowid);

    db.prepare(
      `
      INSERT INTO stock_count_items (
        session_id,
        variant_id,
        system_stock,
        actual_stock
      )
      SELECT
        ? AS session_id,
        x.variant_id,
        x.stock AS system_stock,
        NULL AS actual_stock
      FROM (
        SELECT
          v.id AS variant_id,
          ${STOCK_SUM_SQL} AS stock
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN stock_movements sm ON sm.variant_id = v.id
        WHERE v.is_active = 1
          AND p.is_active = 1
        ${categorySql}
        GROUP BY v.id
      ) x
      ORDER BY x.variant_id ASC
      `
    ).run(sessionId, ...(categorySql ? [categoryId] : []));

    const countRow = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM stock_count_items
        WHERE session_id = ?
        `
      )
      .get(sessionId) as { count: number };

    return {
      id: sessionId,
      title,
      status: 'open',
      items_count: Number(countRow.count || 0)
    };
  });

  return tx();
}

export function listStockCountSessions() {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT
        scs.*,
        creator.name AS created_by_name,
        approver.name AS approved_by_name,

        COUNT(sci.id) AS items_count,

        SUM(
          CASE
            WHEN sci.actual_stock IS NOT NULL THEN 1
            ELSE 0
          END
        ) AS counted_count,

        SUM(
          CASE
            WHEN sci.actual_stock IS NOT NULL
             AND sci.actual_stock = sci.system_stock THEN 1
            ELSE 0
          END
        ) AS matched_count,

        SUM(
          CASE
            WHEN sci.actual_stock IS NOT NULL
             AND sci.actual_stock < sci.system_stock THEN 1
            ELSE 0
          END
        ) AS shortage_count,

        SUM(
          CASE
            WHEN sci.actual_stock IS NOT NULL
             AND sci.actual_stock > sci.system_stock THEN 1
            ELSE 0
          END
        ) AS surplus_count,

        SUM(
          CASE
            WHEN sci.actual_stock IS NOT NULL
            THEN (sci.actual_stock - sci.system_stock) * IFNULL(v.buy_price, 0)
            ELSE 0
          END
        ) AS buy_difference_value,

        SUM(
          CASE
            WHEN sci.actual_stock IS NOT NULL
            THEN (sci.actual_stock - sci.system_stock) * IFNULL(v.sell_price, 0)
            ELSE 0
          END
        ) AS sell_difference_value

      FROM stock_count_sessions scs
      LEFT JOIN stock_count_items sci ON sci.session_id = scs.id
      LEFT JOIN product_variants v ON v.id = sci.variant_id
      LEFT JOIN users creator ON creator.id = scs.created_by
      LEFT JOIN users approver ON approver.id = scs.approved_by
      GROUP BY scs.id
      ORDER BY scs.id DESC
      `
    )
    .all();
}

export function getStockCountSession(sessionId: number) {
  const db = getDb();

  const session = db
    .prepare(
      `
      SELECT
        scs.*,
        creator.name AS created_by_name,
        approver.name AS approved_by_name
      FROM stock_count_sessions scs
      LEFT JOIN users creator ON creator.id = scs.created_by
      LEFT JOIN users approver ON approver.id = scs.approved_by
      WHERE scs.id = ?
      LIMIT 1
      `
    )
    .get(Number(sessionId)) as any;

  if (!session) {
    throw new Error('جلسة الجرد غير موجودة');
  }

  const items = db
    .prepare(
      `
      SELECT
        sci.*,
        p.name AS product_name,
        p.category_id AS category_id,
        c.name AS category_name,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        v.sell_price,
        (IFNULL(sci.actual_stock, 0) - sci.system_stock) AS difference,
        ((IFNULL(sci.actual_stock, 0) - sci.system_stock) * IFNULL(v.buy_price, 0)) AS buy_difference_value,
        ((IFNULL(sci.actual_stock, 0) - sci.system_stock) * IFNULL(v.sell_price, 0)) AS sell_difference_value
      FROM stock_count_items sci
      JOIN product_variants v ON v.id = sci.variant_id
      JOIN products p ON p.id = v.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE sci.session_id = ?
      ORDER BY p.name ASC, v.size ASC, v.color ASC
      `
    )
    .all(Number(sessionId));

  return {
    session,
    items
  };
}

export function updateStockCountItem(input: {
  session_id: number;
  item_id: number;
  actual_stock: number;
  notes?: string | null;
}) {
  const db = getDb();

  const session = db
    .prepare(`SELECT id, status FROM stock_count_sessions WHERE id = ? LIMIT 1`)
    .get(Number(input.session_id)) as any;

  if (!session) {
    throw new Error('جلسة الجرد غير موجودة');
  }

  if (session.status !== 'open') {
    throw new Error('لا يمكن تعديل جرد غير مفتوح');
  }

  const actualStock = Number(input.actual_stock);

  if (!Number.isFinite(actualStock) || actualStock < 0) {
    throw new Error('الكمية الفعلية غير صحيحة');
  }

  const result = db
    .prepare(
      `
      UPDATE stock_count_items
      SET
        actual_stock = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND session_id = ?
      `
    )
    .run(
      actualStock,
      input.notes?.trim() || null,
      Number(input.item_id),
      Number(input.session_id)
    );

  if (result.changes === 0) {
    throw new Error('بند الجرد غير موجود');
  }

  return {
    success: true
  };
}

export function scanStockCountBarcode(input: {
  session_id: number;
  barcode: string;
  quantity?: number;
}) {
  const db = getDb();

  const sessionId = Number(input.session_id);
  const barcode = String(input.barcode || '').trim();
  const quantity = input.quantity == null ? 1 : Number(input.quantity);

  if (!barcode) {
    throw new Error('الباركود مطلوب');
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('الكمية غير صحيحة');
  }

  const session = db
    .prepare(`SELECT id, status FROM stock_count_sessions WHERE id = ? LIMIT 1`)
    .get(sessionId) as any;

  if (!session) {
    throw new Error('جلسة الجرد غير موجودة');
  }

  if (session.status !== 'open') {
    throw new Error('لا يمكن التعديل على جرد غير مفتوح');
  }

  const item = db
    .prepare(
      `
      SELECT
        sci.id,
        sci.actual_stock,
        sci.system_stock,
        p.name AS product_name,
        v.barcode,
        v.size,
        v.color
      FROM stock_count_items sci
      JOIN product_variants v ON v.id = sci.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE sci.session_id = ?
        AND (
          IFNULL(v.barcode, '') = ?
          OR p.name LIKE ?
          OR IFNULL(v.size, '') LIKE ?
          OR IFNULL(v.color, '') LIKE ?
        )
      ORDER BY
        CASE WHEN IFNULL(v.barcode, '') = ? THEN 0 ELSE 1 END,
        p.name ASC
      LIMIT 1
      `
    )
    .get(
      sessionId,
      barcode,
      `%${barcode}%`,
      `%${barcode}%`,
      `%${barcode}%`,
      barcode
    ) as any;

    if (!item) {
      throw new Error('لم يتم العثور على صنف بهذا الباركود أو الاسم داخل جلسة الجرد');
    }

  const nextActual = Number(item.actual_stock || 0) + quantity;

  db.prepare(
    `
    UPDATE stock_count_items
    SET
      actual_stock = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `
  ).run(nextActual, Number(item.id));

  return {
    success: true,
    item_id: Number(item.id),
    actual_stock: nextActual,
    product_name: item.product_name,
    barcode: item.barcode,
    size: item.size,
    color: item.color
  };
}

export function approveStockCountSession(input: {
  session_id: number;
  actor_id?: number | null;
}) {
  const db = getDb();

  const sessionId = Number(input.session_id);

  const tx = db.transaction(() => {
    const session = db
      .prepare(`SELECT id, title, status FROM stock_count_sessions WHERE id = ? LIMIT 1`)
      .get(sessionId) as any;

    if (!session) {
      throw new Error('جلسة الجرد غير موجودة');
    }

    if (session.status !== 'open') {
      throw new Error('جلسة الجرد ليست مفتوحة');
    }

    const uncounted = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM stock_count_items
        WHERE session_id = ?
          AND actual_stock IS NULL
        `
      )
      .get(sessionId) as { count: number };

    if (Number(uncounted.count || 0) > 0) {
      throw new Error(`يوجد ${uncounted.count} صنف لم يتم جرده`);
    }

    const items = db
      .prepare(
        `
        SELECT
          sci.id,
          sci.variant_id,
          sci.system_stock,
          sci.actual_stock,
          p.name AS product_name,
          v.barcode,
          v.size,
          v.color
        FROM stock_count_items sci
        JOIN product_variants v ON v.id = sci.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE sci.session_id = ?
        `
      )
      .all(sessionId) as any[];

    const insertMovement = db.prepare(
      `
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, ?, ?, ?, 'stock_count', ?)
      `
    );

    let changedItems = 0;
    let shortageItems = 0;
    let surplusItems = 0;
    let totalShortageQty = 0;
    let totalSurplusQty = 0;

    for (const item of items) {
      const systemStock = Number(item.system_stock || 0);
      const actualStock = Number(item.actual_stock || 0);
      const diff = actualStock - systemStock;

      if (diff === 0) {
        continue;
      }

      changedItems += 1;

      if (diff > 0) {
        surplusItems += 1;
        totalSurplusQty += diff;

        insertMovement.run(
          Number(item.variant_id),
          'in',
          Math.abs(diff),
          sessionId,
          `تسوية جرد #${sessionId}: زيادة ${diff}`
        );
      } else {
        shortageItems += 1;
        totalShortageQty += Math.abs(diff);

        insertMovement.run(
          Number(item.variant_id),
          'out',
          Math.abs(diff),
          sessionId,
          `تسوية جرد #${sessionId}: عجز ${Math.abs(diff)}`
        );
      }
    }

    db.prepare(
      `
      UPDATE stock_count_sessions
      SET
        status = 'approved',
        approved_by = ?,
        approved_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    ).run(input.actor_id ?? null, sessionId);

    return {
      success: true,
      session_id: sessionId,
      changed_items: changedItems,
      shortage_items: shortageItems,
      surplus_items: surplusItems,
      total_shortage_qty: totalShortageQty,
      total_surplus_qty: totalSurplusQty
    };
  });

  return tx();
}

export function cancelStockCountSession(input: {
  session_id: number;
  actor_id?: number | null;
}) {
  const db = getDb();

  const result = db
    .prepare(
      `
      UPDATE stock_count_sessions
      SET
        status = 'canceled',
        canceled_by = ?,
        canceled_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'open'
      `
    )
    .run(input.actor_id ?? null, Number(input.session_id));

  if (result.changes === 0) {
    throw new Error('لا يمكن إلغاء جلسة الجرد');
  }

  return {
    success: true,
    session_id: Number(input.session_id)
  };
}