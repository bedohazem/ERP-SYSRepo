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
  variants_count: number;
  active_variants_count: number;
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

function getCurrentVariantStock(db: ReturnType<typeof getDb>, variantId: number): number {
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

function zeroVariantStock(
  db: ReturnType<typeof getDb>,
  variantId: number,
  notes: string
) {
  const currentStock = getCurrentVariantStock(db, variantId);

  if (currentStock === 0) return;

  db.prepare(`
    INSERT INTO stock_movements (
      variant_id,
      type,
      quantity,
      reference_id,
      reference_type,
      notes
    )
    VALUES (?, ?, ?, NULL, 'deactivate_zero_stock', ?)
  `).run(
    variantId,
    currentStock > 0 ? 'out' : 'in',
    Math.abs(currentStock),
    notes
  );
}

function zeroProductVariantsStock(
  db: ReturnType<typeof getDb>,
  productId: number
) {
  const variants = db
    .prepare(`SELECT id FROM product_variants WHERE product_id = ?`)
    .all(productId) as Array<{ id: number }>;

  for (const variant of variants) {
    zeroVariantStock(
      db,
      Number(variant.id),
      'تصفير مخزون بسبب تعطيل المنتج'
    );
  }
}

function ensureBarcodeAvailable(barcode: string, exceptVariantId?: number) {
  const db = getDb();
  const cleanBarcode = String(barcode || '').trim();

  if (!cleanBarcode) {
    throw new Error('الباركود مطلوب');
  }

  const existing = exceptVariantId
    ? db
        .prepare(`
          SELECT id
          FROM product_variants
          WHERE barcode = ?
            AND id <> ?
          LIMIT 1
        `)
        .get(cleanBarcode, exceptVariantId)
    : db
        .prepare(`
          SELECT id
          FROM product_variants
          WHERE barcode = ?
          LIMIT 1
        `)
        .get(cleanBarcode);

  if (existing) {
    throw new Error(`الباركود "${cleanBarcode}" مستخدم بالفعل`);
  }
}

function ensureInputBarcodesAreUnique(variants: ProductVariantInput[]) {
  const seen = new Set<string>();

  for (const variant of variants) {
    const barcode = String(variant.barcode || '').trim();

    if (!barcode) {
      throw new Error('الباركود مطلوب');
    }

    if (seen.has(barcode)) {
      throw new Error(`الباركود "${barcode}" مكرر في نفس المنتج`);
    }

    seen.add(barcode);
    ensureBarcodeAvailable(barcode);
  }
}

function validateVariantNumbers(variant: ProductVariantInput | AddProductVariantInput | UpdateVariantInput) {
  const buyPrice = Number(variant.buy_price);
  const sellPrice = Number(variant.sell_price);
  const minStock = Number(variant.min_stock);

  if (!Number.isFinite(buyPrice) || buyPrice < 0) {
    throw new Error('سعر الشراء غير صحيح');
  }

  if (!Number.isFinite(sellPrice) || sellPrice < 0) {
    throw new Error('سعر البيع غير صحيح');
  }

  if (!Number.isFinite(minStock) || minStock < 0) {
    throw new Error('حد المخزون الأدنى غير صحيح');
  }
}

export function getCategories(includeInactive = false): CategoryRow[] {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT id, name, description, is_active, created_at
      FROM categories
      WHERE ${includeInactive ? '1=1' : 'is_active = 1'}
      ORDER BY is_active DESC, name ASC
      `
    )
    .all() as CategoryRow[];
}

export function createCategory(input: {
  name: string;
  description?: string | null;
}) {
  const db = getDb();
  const name = String(input.name || '').trim();

  if (!name) {
    throw new Error('اسم التصنيف مطلوب');
  }

  const existing = db
    .prepare(`SELECT id, is_active FROM categories WHERE name = ? LIMIT 1`)
    .get(name) as { id: number; is_active: number } | undefined;

  if (existing) {
    if (Number(existing.is_active) === 1) {
      throw new Error('التصنيف موجود بالفعل');
    }

    db.prepare(
      `
      UPDATE categories
      SET is_active = 1,
          description = ?
      WHERE id = ?
      `
    ).run(input.description ?? null, existing.id);

    return { success: true, id: existing.id, reactivated: true };
  }

  const result = db
    .prepare(
      `
      INSERT INTO categories (name, description, is_active)
      VALUES (?, ?, 1)
      `
    )
    .run(name, input.description ?? null);

  return {
    success: true,
    id: Number(result.lastInsertRowid)
  };
}

export function updateCategory(input: {
  id: number;
  name: string;
  description?: string | null;
}) {
  const db = getDb();
  const id = Number(input.id);
  const name = String(input.name || '').trim();

  if (!id) {
    throw new Error('التصنيف غير صحيح');
  }

  if (!name) {
    throw new Error('اسم التصنيف مطلوب');
  }

  const duplicate = db
    .prepare(`SELECT id FROM categories WHERE name = ? AND id <> ? LIMIT 1`)
    .get(name, id);

  if (duplicate) {
    throw new Error('يوجد تصنيف آخر بنفس الاسم');
  }

  db.prepare(
    `
    UPDATE categories
    SET name = ?,
        description = ?
    WHERE id = ?
    `
  ).run(name, input.description ?? null, id);

  return { success: true };
}

export function toggleCategoryActive(categoryId: number, isActive: number) {
  const db = getDb();
  const id = Number(categoryId);

  if (!id) {
    throw new Error('التصنيف غير صحيح');
  }

  db.prepare(
    `
    UPDATE categories
    SET is_active = ?
    WHERE id = ?
    `
  ).run(Number(isActive) ? 1 : 0, id);

  return { success: true };
}

export function getProducts(
  search = '',
  includeInactive = false,
  categoryId?: number | string | null
): ProductRow[] {
  const db = getDb();
  const term = search.trim();
  const query = `%${term}%`;

  const selectedCategoryId =
    categoryId && categoryId !== 'all' ? Number(categoryId) : null;

  const categorySql = selectedCategoryId ? `AND p.category_id = ?` : '';

  const params = [
    ...(selectedCategoryId ? [selectedCategoryId] : []),
    query,
    query,
    term,
    query,
    query
  ];

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
        p.created_at,

        (
          SELECT COUNT(*)
          FROM product_variants v
          WHERE v.product_id = p.id
        ) as variants_count,

        (
          SELECT COUNT(*)
          FROM product_variants v
          WHERE v.product_id = p.id
            AND v.is_active = 1
        ) as active_variants_count

      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE
        (${includeInactive ? '1=1' : 'p.is_active = 1'})
        ${categorySql}
        AND (
          p.name LIKE ?
          OR IFNULL(c.name, '') LIKE ?
          OR EXISTS (
            SELECT 1
            FROM product_variants v
            WHERE v.product_id = p.id
              AND (
                IFNULL(v.barcode, '') LIKE ?
                OR IFNULL(v.size, '') LIKE ?
                OR IFNULL(v.color, '') LIKE ?
              )
          )
        )
      ORDER BY p.id DESC
      `
    )
    .all(...params) as ProductRow[];
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
  const nextActive = Number(isActive) ? 1 : 0;

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE product_variants
      SET is_active = ?
      WHERE id = ?
      `
    ).run(nextActive, variantId);

    if (!nextActive) {
      zeroVariantStock(
        db,
        Number(variantId),
        'تصفير مخزون بسبب تعطيل الصنف'
      );
    }
  });

  tx();

  return { success: true };
}

export function createProduct(input: CreateProductInput) {
  const db = getDb();

  if (!input.name?.trim()) {
    throw new Error('اسم المنتج مطلوب');
  }

  if (!input.variants?.length) {
    throw new Error('لازم تضيف صنف واحد على الأقل');
  }

  ensureInputBarcodesAreUnique(input.variants);
  
  for (const variant of input.variants) {
    validateVariantNumbers(variant);
  }

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

  const cleanBarcode = String(input.barcode || '').trim();
  ensureBarcodeAvailable(cleanBarcode);
  validateVariantNumbers(input);

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
        cleanBarcode,
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
  const cleanName = input.name?.trim();
  if (!cleanName) {
    throw new Error('اسم المنتج مطلوب');
  }
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
    cleanName,
    input.category_id,
    input.description ?? null,
    input.image_path ?? null,
    input.id
  );

  return { success: true };
}

export function updateVariant(input: UpdateVariantInput) {
  const db = getDb();

  const cleanBarcode = String(input.barcode || '').trim();
  ensureBarcodeAvailable(cleanBarcode, input.id);
  validateVariantNumbers(input);

  const nextActive = input.is_active ?? 1;

  const tx = db.transaction(() => {
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
      cleanBarcode,
      input.size.trim(),
      input.color.trim(),
      input.buy_price,
      input.sell_price,
      input.min_stock,
      nextActive,
      input.id
    );

    if (!Number(nextActive)) {
      zeroVariantStock(
        db,
        Number(input.id),
        'تصفير مخزون بسبب تعطيل الصنف'
      );
    }
  });

  tx();

  return { success: true };
}

export function toggleProductActive(productId: number, isActive: number) {
  const db = getDb();
  const nextActive = Number(isActive) ? 1 : 0;

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE products
      SET is_active = ?
      WHERE id = ?
      `
    ).run(nextActive, productId);

    if (!nextActive) {
      zeroProductVariantsStock(db, Number(productId));
    }
  });

  tx();

  return { success: true };
}

export type SaleSearchVariantRow = {
  variant_id: number;
  product_id: number;
  product_name: string;
  category_id: number | null;
  category_name: string | null;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
  buy_price: number;
  stock: number;
  min_stock: number;
  is_active: number;
};

export function searchSaleVariants(
  input: string | { query?: string; categoryId?: number | string | null; limit?: number },
  limit = 30
): SaleSearchVariantRow[] {
  const db = getDb();

  const trimmed =
    typeof input === 'string'
      ? input.trim()
      : String(input?.query || '').trim();

  if (!trimmed) {
    return [];
  }

  const rawCategoryId = typeof input === 'string' ? null : input?.categoryId;
  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null;

  const safeLimit =
    typeof input === 'string'
      ? limit
      : Math.min(Math.max(Number(input?.limit || limit), 1), 100);

  const params: any[] = [];

  let categorySql = '';

  if (categoryId && Number.isFinite(categoryId) && categoryId > 0) {
    categorySql = `AND p.category_id = ?`;
    params.push(categoryId);
  }

  const likeQuery = `%${trimmed}%`;

  params.push(likeQuery, likeQuery, likeQuery, likeQuery, trimmed, safeLimit);

  return db
    .prepare(
      `
      SELECT
        v.id as variant_id,
        p.id as product_id,
        p.name as product_name,
        p.category_id as category_id,
        c.name as category_name,
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
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock_movements sm ON sm.variant_id = v.id
      WHERE p.is_active = 1
        AND v.is_active = 1
        ${categorySql}
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
        p.category_id,
        c.name,
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
    .all(...params) as SaleSearchVariantRow[];
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