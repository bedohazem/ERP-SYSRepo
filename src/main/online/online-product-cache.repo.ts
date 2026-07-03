import { getDb } from '../database/db';

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function normalizeCachedVariant(row: any) {
  if (!row) return null;

  return {
    variant_id: row.variant_id,
    product_id: row.product_id,
    product_name: row.product_name,
    category_id: row.category_id,
    category_name: row.category_name,
    barcode: row.barcode || '',
    size: row.size || '',
    color: row.color || '',
    sell_price: toNumber(row.sell_price),
    buy_price: toNumber(row.buy_price),
    stock: toNumber(row.stock),
    min_stock: toNumber(row.min_stock),
    is_active: Number(row.is_active ?? 1),
    online: true,
    cached: true
  };
}

export function saveOnlineVariantCache(variant: any) {
  const db = getDb();

  const variantId = String(variant.variant_id || variant.id || '').trim();

  if (!variantId) {
    return { success: false, message: 'variant_id is required' };
  }

  db.prepare(`
    INSERT INTO online_product_cache (
      variant_id,
      product_id,
      product_name,
      category_id,
      category_name,
      barcode,
      size,
      color,
      sell_price,
      buy_price,
      stock,
      min_stock,
      is_active,
      cached_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(variant_id) DO UPDATE SET
      product_id = excluded.product_id,
      product_name = excluded.product_name,
      category_id = excluded.category_id,
      category_name = excluded.category_name,
      barcode = excluded.barcode,
      size = excluded.size,
      color = excluded.color,
      sell_price = excluded.sell_price,
      buy_price = excluded.buy_price,
      stock = excluded.stock,
      min_stock = excluded.min_stock,
      is_active = excluded.is_active,
      cached_at = CURRENT_TIMESTAMP
  `).run(
    variantId,
    variant.product_id == null ? null : String(variant.product_id),
    String(variant.product_name || variant.name || ''),
    variant.category_id == null ? null : String(variant.category_id),
    variant.category_name == null ? null : String(variant.category_name),
    variant.barcode == null ? null : String(variant.barcode),
    variant.size == null ? null : String(variant.size),
    variant.color == null ? null : String(variant.color),
    toNumber(variant.sell_price ?? variant.sale_price),
    toNumber(variant.buy_price),
    toNumber(variant.stock ?? variant.stock_quantity),
    toNumber(variant.min_stock),
    Number(variant.is_active ?? 1)
  );

  return { success: true };
}

export function saveOnlineVariantsCache(variants: any[]) {
  const items = Array.isArray(variants) ? variants : [];

  for (const variant of items) {
    saveOnlineVariantCache(variant);
  }

  return { success: true, count: items.length };
}

export function getCachedOnlineVariantByBarcode(barcode: string) {
  const db = getDb();
  const cleanBarcode = String(barcode || '').trim();

  if (!cleanBarcode) return null;

  const row = db
    .prepare(`
      SELECT *
      FROM online_product_cache
      WHERE barcode = ?
        AND is_active = 1
      LIMIT 1
    `)
    .get(cleanBarcode);

  return normalizeCachedVariant(row);
}

export function searchCachedOnlineSaleVariants(input: any) {
  const db = getDb();

  const query =
    typeof input === 'string'
      ? input.trim()
      : String(input?.query || '').trim();

  if (!query) {
    return db
      .prepare(`
        SELECT *
        FROM online_product_cache
        WHERE is_active = 1
        ORDER BY cached_at DESC
        LIMIT 50
      `)
      .all()
      .map(normalizeCachedVariant)
      .filter(Boolean);
  }

  const like = `%${query}%`;

  return db
    .prepare(`
      SELECT *
      FROM online_product_cache
      WHERE is_active = 1
        AND (
          product_name LIKE ?
          OR barcode = ?
          OR size LIKE ?
          OR color LIKE ?
        )
      ORDER BY product_name ASC
      LIMIT 50
    `)
    .all(like, query, like, like)
    .map(normalizeCachedVariant)
    .filter(Boolean);
}