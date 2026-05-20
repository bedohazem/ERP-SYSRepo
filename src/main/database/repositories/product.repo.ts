import { getDb } from '../db';

export type CategoryRow = {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
  created_at: string;
};

export type ProductRow = {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  image_path: string | null;
  description: string | null;
  is_active: number;
  created_at: string;
};

export type ProductVariantInput = {
  barcode: string;
  size: string;
  color: string;
  buy_price: number;
  sell_price: number;
  min_stock: number;
  opening_qty?: number;
};

export type CreateProductInput = {
  name: string;
  category_id: number | null;
  image_path?: string | null;
  description?: string | null;
  variants: ProductVariantInput[];
};

const STOCK_SUM_SQL = `
  IFNULL(SUM(
    CASE
      WHEN sm.type = 'in' THEN sm.quantity
      WHEN sm.type = 'out' THEN -sm.quantity
      ELSE 0
    END
  ), 0)
`;

export function getCategories(): CategoryRow[] {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT id, name, description, is_active, created_at
      FROM categories
      WHERE is_active = 1
      ORDER BY name ASC
      `
    )
    .all() as CategoryRow[];
}

export function getProducts(search = '', includeInactive = false): ProductRow[] {
  const db = getDb();
  const query = `%${search.trim()}%`;

  return db
    .prepare(
      `
      SELECT
        p.id,
        p.name,
        p.category_id,
        c.name as category_name,
        p.image_path,
        p.description,
        p.is_active,
        p.created_at
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE
        (${includeInactive ? '1=1' : 'p.is_active = 1'})
        AND (
          p.name LIKE ?
          OR IFNULL(c.name, '') LIKE ?
        )
      ORDER BY p.id DESC
      `
    )
    .all(query, query) as ProductRow[];
}

export function getProductVariants(productId: number, includeInactive = true) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT
        v.id,
        v.product_id,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        v.sell_price,
        v.min_stock,
        v.is_active,
        ${STOCK_SUM_SQL} as stock
      FROM product_variants v
      LEFT JOIN stock_movements sm ON sm.variant_id = v.id
      WHERE v.product_id = ?
        AND (${includeInactive ? '1=1' : 'v.is_active = 1'})
      GROUP BY
        v.id,
        v.product_id,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        v.sell_price,
        v.min_stock,
        v.is_active
      ORDER BY v.id ASC
      `
    )
    .all(productId);
}

export function toggleVariantActive(variantId: number, isActive: number) {
  const db = getDb();

  db.prepare(
    `
    UPDATE product_variants
    SET is_active = ?
    WHERE id = ?
    `
  ).run(isActive, variantId);

  return { success: true };
}

export function createProduct(input: CreateProductInput) {
  const db = getDb();

  const tx = db.transaction(() => {
    const productResult = db
      .prepare(
        `
        INSERT INTO products (name, category_id, image_path, description, is_active)
        VALUES (?, ?, ?, ?, 1)
        `
      )
      .run(
        input.name.trim(),
        input.category_id,
        input.image_path ?? null,
        input.description ?? null
      );

    const productId = Number(productResult.lastInsertRowid);

    const insertVariant = db.prepare(
      `
      INSERT INTO product_variants
      (product_id, barcode, size, color, buy_price, sell_price, min_stock, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `
    );

    const insertMovement = db.prepare(
      `
      INSERT INTO stock_movements
      (variant_id, type, quantity, reference_id, reference_type, notes)
      VALUES (?, 'in', ?, ?, 'opening_stock', ?)
      `
    );

    for (const variant of input.variants) {
      const variantResult = insertVariant.run(
        productId,
        variant.barcode.trim(),
        variant.size.trim(),
        variant.color.trim(),
        variant.buy_price,
        variant.sell_price,
        variant.min_stock
      );

      const variantId = Number(variantResult.lastInsertRowid);
      const openingQty = Number(variant.opening_qty ?? 0);

      if (!Number.isFinite(openingQty) || openingQty < 0) {
        throw new Error('كمية المخزون الافتتاحي غير صحيحة');
      }

      if (openingQty > 0) {
        insertMovement.run(
          variantId,
          openingQty,
          productId,
          'رصيد افتتاحي عند إنشاء المنتج'
        );
      }
    }

    return productId;
  });

  const productId = tx();
  return { success: true, productId };
}

export type AddProductVariantInput = {
  product_id: number;
  barcode: string;
  size: string;
  color: string;
  buy_price: number;
  sell_price: number;
  min_stock: number;
  opening_qty?: number;
};

export function addProductVariant(input: AddProductVariantInput) {
  const db = getDb();

  const tx = db.transaction(() => {
    const product = db
      .prepare(`SELECT id FROM products WHERE id = ? LIMIT 1`)
      .get(input.product_id);

    if (!product) {
      throw new Error('المنتج غير موجود');
    }

    const variantResult = db
      .prepare(
        `
        INSERT INTO product_variants
        (product_id, barcode, size, color, buy_price, sell_price, min_stock, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `
      )
      .run(
        input.product_id,
        input.barcode.trim(),
        input.size.trim(),
        input.color.trim(),
        input.buy_price,
        input.sell_price,
        input.min_stock
      );

    const variantId = Number(variantResult.lastInsertRowid);
    const openingQty = Number(input.opening_qty ?? 0);

    if (!Number.isFinite(openingQty) || openingQty < 0) {
      throw new Error('كمية المخزون الافتتاحي غير صحيحة');
    }

    if (openingQty > 0) {
      db.prepare(
        `
        INSERT INTO stock_movements
        (variant_id, type, quantity, reference_id, reference_type, notes)
        VALUES (?, 'in', ?, ?, 'opening_stock', ?)
        `
      ).run(
        variantId,
        openingQty,
        input.product_id,
        'رصيد افتتاحي عند إضافة صنف جديد'
      );
    }

    return variantId;
  });

  const variantId = tx();

  return {
    success: true,
    variantId
  };
}


export type UpdateProductInput = {
  id: number;
  name: string;
  category_id: number | null;
  description?: string | null;
  image_path?: string | null;
};

export type UpdateVariantInput = {
  id: number;
  barcode: string;
  size: string;
  color: string;
  buy_price: number;
  sell_price: number;
  min_stock: number;
  is_active?: number;
};

export function updateProduct(input: UpdateProductInput) {
  const db = getDb();

  db.prepare(
    `
    UPDATE products
    SET
      name = ?,
      category_id = ?,
      description = ?,
      image_path = ?
    WHERE id = ?
    `
  ).run(
    input.name.trim(),
    input.category_id,
    input.description ?? null,
    input.image_path ?? null,
    input.id
  );

  return { success: true };
}

export function updateVariant(input: UpdateVariantInput) {
  const db = getDb();

  db.prepare(
    `
    UPDATE product_variants
    SET
      barcode = ?,
      size = ?,
      color = ?,
      buy_price = ?,
      sell_price = ?,
      min_stock = ?,
      is_active = ?
    WHERE id = ?
    `
  ).run(
    input.barcode.trim(),
    input.size.trim(),
    input.color.trim(),
    input.buy_price,
    input.sell_price,
    input.min_stock,
    input.is_active ?? 1,
    input.id
  );

  return { success: true };
}

export function toggleProductActive(productId: number, isActive: number) {
  const db = getDb();

  db.prepare(
    `
    UPDATE products
    SET is_active = ?
    WHERE id = ?
    `
  ).run(isActive, productId);

  return { success: true };
}

export type SaleSearchVariantRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
  buy_price: number;
  stock: number;
  min_stock: number;
  is_active: number;
};

export function searchSaleVariants(query: string, limit = 30): SaleSearchVariantRow[] {
  const db = getDb();
  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  const likeQuery = `%${trimmed}%`;

  return db
    .prepare(
      `
      SELECT
        v.id as variant_id,
        p.id as product_id,
        p.name as product_name,
        v.barcode,
        v.size,
        v.color,
        v.sell_price,
        v.buy_price,
        v.min_stock,
        v.is_active,
        ${STOCK_SUM_SQL} as stock
      FROM product_variants v
      INNER JOIN products p ON p.id = v.product_id
      LEFT JOIN stock_movements sm ON sm.variant_id = v.id
      WHERE p.is_active = 1
        AND v.is_active = 1
        AND (
          v.barcode LIKE ?
          OR p.name LIKE ?
          OR IFNULL(v.size, '') LIKE ?
          OR IFNULL(v.color, '') LIKE ?
        )
      GROUP BY
        v.id,
        p.id,
        p.name,
        v.barcode,
        v.size,
        v.color,
        v.sell_price,
        v.buy_price,
        v.min_stock,
        v.is_active
      HAVING stock > 0
      ORDER BY
        CASE WHEN v.barcode = ? THEN 0 ELSE 1 END,
        p.name ASC
      LIMIT ?
      `
    )
    .all(likeQuery, likeQuery, likeQuery, likeQuery, trimmed, limit) as SaleSearchVariantRow[];
}

export function getVariantByBarcode(barcode: string): SaleSearchVariantRow | undefined {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT
        v.id as variant_id,
        p.id as product_id,
        p.name as product_name,
        v.barcode,
        v.size,
        v.color,
        v.sell_price,
        v.buy_price,
        v.min_stock,
        v.is_active,
        ${STOCK_SUM_SQL} as stock
      FROM product_variants v
      INNER JOIN products p ON p.id = v.product_id
      LEFT JOIN stock_movements sm ON sm.variant_id = v.id
      WHERE p.is_active = 1
        AND v.is_active = 1
        AND v.barcode = ?
      GROUP BY
        v.id,
        p.id,
        p.name,
        v.barcode,
        v.size,
        v.color,
        v.sell_price,
        v.buy_price,
        v.min_stock,
        v.is_active
      LIMIT 1
      `
    )
    .get(barcode) as SaleSearchVariantRow | undefined;
}