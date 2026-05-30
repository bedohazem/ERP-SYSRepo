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

export function getInventoryList(input?: {
  search?: string;
  status?: 'all' | 'available' | 'low' | 'out' ;
}) {
  const db = getDb();

  const search = input?.search?.trim() || '';
  const status = input?.status || 'all';

  const params: any[] = [];
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
    havingSql = `HAVING stock > v.min_stock`;
  }

  if (status === 'low') {
    havingSql = `HAVING stock > 0 AND stock <= v.min_stock`;
  }

  if (status === 'out') {
    havingSql = `HAVING stock = 0`;
  }

  return db
    .prepare(`
      SELECT
        v.id AS variant_id,
        p.id AS product_id,
        p.name AS product_name,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        v.sell_price,
        v.min_stock,
        v.is_active,
        p.is_active AS product_is_active,
        ${STOCK_SUM_SQL} AS stock
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN stock_movements sm ON sm.variant_id = v.id
      WHERE 1 = 1
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
    `)
    .all(...params);
}

export function getVariantStock(variantId: number) {
  const db = getDb();

  const row = db
    .prepare(`
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
    `)
    .get(variantId) as { stock: number } | undefined;

  return Number(row?.stock || 0);
}

export function adjustVariantStock(input: {
  variant_id: number;
  target_stock: number;
  notes?: string | null;
}) {
  const db = getDb();

  const variantId = Number(input.variant_id);
  const targetStock = Number(input.target_stock);

  if (!variantId) {
    throw new Error('Variant ID is required');
  }

  if (!Number.isFinite(targetStock) || targetStock < 0) {
    throw new Error('المخزون الجديد غير صحيح');
  }

  const variant = db
    .prepare(`
      SELECT
        v.id,
        p.name AS product_name,
        v.size,
        v.color
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
      LIMIT 1
    `)
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
        diff: 0
      };
    }

    db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, ?, ?, NULL, 'manual_adjust', ?)
    `).run(
      variantId,
      diff > 0 ? 'in' : 'out',
      Math.abs(diff),
      input.notes?.trim() || `تسوية مخزون: من ${oldStock} إلى ${targetStock}`
    );

    return {
      success: true,
      variant_id: variantId,
      old_stock: oldStock,
      new_stock: targetStock,
      diff
    };
  });

  return tx();
}

export function getStockMovements(input: {
  variant_id?: number;
  search?: string;
  limit?: number;
}) {
  const db = getDb();

  const variantId = input.variant_id ? Number(input.variant_id) : null;
  const search = input.search?.trim() || '';
  const limit = Math.min(Math.max(Number(input.limit || 100), 1), 300);

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

  return db
    .prepare(`
      SELECT
        sm.id,
        sm.variant_id,
        sm.type,
        sm.quantity,
        CASE
          WHEN sm.type = 'in' THEN sm.quantity
          WHEN sm.type = 'out' THEN -sm.quantity
          ELSE 0
        END AS signed_quantity,
        sm.reference_id,
        sm.reference_type,
        sm.notes,
        sm.created_at,
        p.name AS product_name,
        v.barcode,
        v.size,
        v.color
      FROM stock_movements sm
      JOIN product_variants v ON v.id = sm.variant_id
      JOIN products p ON p.id = v.product_id
      ${whereSql}
      ORDER BY sm.id DESC
      LIMIT ?
    `)
    .all(...params, limit);
}