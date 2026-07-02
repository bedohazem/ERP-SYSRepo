import express from 'express';
import { pool, query } from '../db.js';

const router = express.Router();

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function groupProducts(rows: any[]) {
  const map = new Map<string, any>();

  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        sku: row.sku,
        description: row.description,
        category_id: row.category_id,
        category_name: row.category_name,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        variants: []
      });
    }

    if (row.variant_id) {
      map.get(row.id).variants.push({
        id: row.variant_id,
        product_id: row.id,
        barcode: row.barcode,
        size: row.size,
        color: row.color,
        buy_price: toNumber(row.buy_price),
        sale_price: toNumber(row.sale_price),
        wholesale_price: toNumber(row.wholesale_price),
        min_stock: toNumber(row.min_stock),
        stock_quantity: toNumber(row.stock_quantity),
        is_active: row.variant_is_active,
        created_at: row.variant_created_at,
        updated_at: row.variant_updated_at
      });
    }
  }

  return Array.from(map.values());
}

router.get('/', async (req, res) => {
  const search = String(req.query.search || '').trim();
  const warehouseId = req.query.warehouse_id
    ? String(req.query.warehouse_id)
    : 'main-warehouse';

  const activeOnly = String(req.query.active ?? 'true') !== 'false';

  const params: any[] = [warehouseId];
  const where: string[] = [];

  if (activeOnly) {
    where.push('p.is_active = TRUE');
  }

  if (search) {
    params.push(`%${search}%`);
    params.push(search);

    where.push(`
      (
        p.name ILIKE $${params.length - 1}
        OR p.sku ILIKE $${params.length - 1}
        OR pv.barcode = $${params.length}
      )
    `);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const result = await query(
    `
    SELECT
      p.id,
      p.name,
      p.sku,
      p.description,
      p.category_id,
      c.name AS category_name,
      p.is_active,
      p.created_at,
      p.updated_at,

      pv.id AS variant_id,
      pv.barcode,
      pv.size,
      pv.color,
      pv.buy_price,
      pv.sale_price,
      pv.wholesale_price,
      pv.min_stock,
      pv.is_active AS variant_is_active,
      pv.created_at AS variant_created_at,
      pv.updated_at AS variant_updated_at,

      COALESCE(sb.quantity, 0) AS stock_quantity
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_variants pv ON pv.product_id = p.id
    LEFT JOIN stock_balances sb
      ON sb.variant_id = pv.id
     AND sb.warehouse_id = $1
    ${whereSql}
    ORDER BY p.name ASC, pv.created_at ASC
    LIMIT 500
    `,
    params
  );

  res.json({
    success: true,
    products: groupProducts(result.rows)
  });
});

router.get('/variants/by-barcode/:barcode', async (req, res) => {
  const barcode = String(req.params.barcode || '').trim();
  const warehouseId = req.query.warehouse_id
    ? String(req.query.warehouse_id)
    : 'main-warehouse';

  if (!barcode) {
    return res.status(400).json({
      success: false,
      message: 'barcode is required'
    });
  }

  const result = await query(
    `
    SELECT
      pv.id,
      pv.product_id,
      p.name AS product_name,
      p.sku,
      pv.barcode,
      pv.size,
      pv.color,
      pv.buy_price,
      pv.sale_price,
      pv.wholesale_price,
      pv.min_stock,
      COALESCE(sb.quantity, 0) AS stock_quantity,
      pv.is_active,
      pv.created_at,
      pv.updated_at
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN stock_balances sb
      ON sb.variant_id = pv.id
     AND sb.warehouse_id = $2
    WHERE pv.barcode = $1
    LIMIT 1
    `,
    [barcode, warehouseId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({
      success: false,
      message: 'Variant not found'
    });
  }

  const row = result.rows[0];

  res.json({
    success: true,
    variant: {
      ...row,
      buy_price: toNumber(row.buy_price),
      sale_price: toNumber(row.sale_price),
      wholesale_price: toNumber(row.wholesale_price),
      min_stock: toNumber(row.min_stock),
      stock_quantity: toNumber(row.stock_quantity)
    }
  });
});

router.post('/', async (req, res) => {
  const body = req.body || {};

  const name = String(body.name || '').trim();
  const sku = body.sku == null ? null : String(body.sku).trim() || null;
  const description = body.description == null ? null : String(body.description).trim() || null;

  const categoryIdInput =
    body.category_id == null ? null : String(body.category_id).trim() || null;

  const categoryName =
    body.category_name == null ? null : String(body.category_name).trim() || null;

  const branchId = body.branch_id == null ? 'main' : String(body.branch_id).trim() || 'main';
  const warehouseId =
    body.warehouse_id == null
      ? 'main-warehouse'
      : String(body.warehouse_id).trim() || 'main-warehouse';

  const variants = Array.isArray(body.variants) ? body.variants : [];

  if (!name) {
    return res.status(400).json({
      success: false,
      message: 'اسم المنتج مطلوب'
    });
  }

  if (variants.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'لازم تضيف variant واحد على الأقل للمنتج'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let categoryId = categoryIdInput;

    if (!categoryId && categoryName) {
      const categoryResult = await client.query<{ id: string }>(
        `
        INSERT INTO categories (name, is_active)
        VALUES ($1, TRUE)
        ON CONFLICT (name) DO UPDATE SET
          name = EXCLUDED.name
        RETURNING id
        `,
        [categoryName]
      );

      categoryId = categoryResult.rows[0].id;
    }

    const productResult = await client.query<{ id: string }>(
      `
      INSERT INTO products (
        category_id,
        name,
        sku,
        description,
        is_active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, TRUE, NOW())
      RETURNING *
      `,
      [categoryId, name, sku, description]
    );

    const product = productResult.rows[0];

    const createdVariants: any[] = [];

    for (const variantInput of variants) {
      const barcode =
        variantInput.barcode == null
          ? null
          : String(variantInput.barcode).trim() || null;

      const size =
        variantInput.size == null
          ? null
          : String(variantInput.size).trim() || null;

      const color =
        variantInput.color == null
          ? null
          : String(variantInput.color).trim() || null;

      const buyPrice = toNumber(variantInput.buy_price);
      const salePrice = toNumber(variantInput.sale_price);
      const wholesalePrice = toNumber(variantInput.wholesale_price);
      const minStock = toNumber(variantInput.min_stock);
      const openingQuantity = toNumber(variantInput.opening_quantity);

      const variantResult = await client.query(
        `
        INSERT INTO product_variants (
          product_id,
          barcode,
          size,
          color,
          buy_price,
          sale_price,
          wholesale_price,
          min_stock,
          is_active,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())
        RETURNING *
        `,
        [
          product.id,
          barcode,
          size,
          color,
          buyPrice,
          salePrice,
          wholesalePrice,
          minStock
        ]
      );

      const variant = variantResult.rows[0];

      if (openingQuantity > 0) {
        await client.query(
          `
          INSERT INTO stock_balances (
            warehouse_id,
            variant_id,
            quantity,
            updated_at
          )
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (warehouse_id, variant_id) DO UPDATE SET
            quantity = stock_balances.quantity + EXCLUDED.quantity,
            updated_at = NOW()
          `,
          [warehouseId, variant.id, openingQuantity]
        );

        await client.query(
          `
          INSERT INTO stock_movements (
            branch_id,
            warehouse_id,
            variant_id,
            type,
            quantity,
            unit_cost,
            reference_type,
            reference_id,
            notes
          )
          VALUES ($1, $2, $3, 'in', $4, $5, 'opening_stock', $6, $7)
          `,
          [
            branchId,
            warehouseId,
            variant.id,
            openingQuantity,
            buyPrice,
            product.id,
            'رصيد افتتاحي من إنشاء المنتج'
          ]
        );
      }

      createdVariants.push({
        ...variant,
        buy_price: buyPrice,
        sale_price: salePrice,
        wholesale_price: wholesalePrice,
        min_stock: minStock,
        stock_quantity: openingQuantity
      });
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      product: {
        ...product,
        variants: createdVariants
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');

    const code = (error as any)?.code;

    if (code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'يوجد منتج أو باركود مكرر'
      });
    }

    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create product'
    });
  } finally {
    client.release();
  }
});

export default router;