import { getDb } from '../db';
import { roundMoney } from '../../../shared/money';
export type CreateHeldSaleInput = {
  user_id: number;

  customer_id?: number | null;

  title?: string | null;

  discount_type?: 'amount' | 'percent';

  discount_value?: number;

  notes?: string | null;

  items: Array<{
    variant_id: number;
    quantity: number;
  }>;
};

type HeldSaleAccessInput = {
  held_sale_id: number;

  actor_id: number;

  is_admin: boolean;
};

function getHeldSaleHeaderForAccess(input: HeldSaleAccessInput) {
  const db = getDb();

  const heldSaleId = Number(input.held_sale_id || 0);

  const actorId = Number(input.actor_id || 0);

  if (!heldSaleId || !actorId) {
    throw new Error('الفاتورة المعلقة غير صحيحة');
  }

  const row = db
    .prepare(
      `
      SELECT
        hs.id,
        hs.user_id,

        u.name AS cashier_name,

        hs.customer_id,

        c.name AS customer_name,
        c.phone AS customer_phone,

        c.email AS customer_email,
        c.address AS customer_address,
        c.notes AS customer_notes,

        c.points_balance
          AS customer_points_balance,

        c.total_spent
          AS customer_total_spent,

        hs.title,

        hs.discount_type,
        hs.discount_value,

        hs.notes,

        hs.created_at,
        hs.updated_at

      FROM held_sales hs

      JOIN users u
        ON u.id = hs.user_id

      LEFT JOIN customers c
        ON c.id = hs.customer_id

      WHERE
        hs.id = ?

        AND (
          ? = 1
          OR hs.user_id = ?
        )

      LIMIT 1
      `,
    )
    .get(
      heldSaleId,

      input.is_admin ? 1 : 0,

      actorId,
    ) as any;

  if (!row) {
    throw new Error('الفاتورة المعلقة غير موجودة أو غير متاحة لهذا المستخدم');
  }

  return row;
}

export function createHeldSale(input: CreateHeldSaleInput) {
  const db = getDb();

  const userId = Number(input.user_id || 0);

  if (!userId) {
    throw new Error('المستخدم غير صحيح');
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('لا يمكن تعليق فاتورة فارغة');
  }

  const discountType = input.discount_type === 'percent' ? 'percent' : 'amount';

  const discountValue = Number(input.discount_value || 0);

  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new Error('قيمة الخصم غير صحيحة');
  }

  if (discountType === 'percent' && discountValue > 100) {
    throw new Error('نسبة الخصم لا يمكن أن تتجاوز 100%');
  }

  const customerId = input.customer_id ? Number(input.customer_id) : null;

  if (customerId) {
    const customer = db
      .prepare(
        `
        SELECT id

        FROM customers

        WHERE id = ?

        LIMIT 1
        `,
      )
      .get(customerId);

    if (!customer) {
      throw new Error('العميل غير موجود');
    }
  }

  const quantities = new Map<number, number>();

  for (const item of input.items) {
    const variantId = Number(item.variant_id || 0);

    const quantity = Number(item.quantity || 0);

    if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('بيانات أحد أصناف الفاتورة غير صحيحة');
    }

    quantities.set(
      variantId,

      Number(quantities.get(variantId) || 0) + quantity,
    );
  }

  const variantIds = Array.from(quantities.keys());

  const placeholders = variantIds.map(() => '?').join(', ');

  const variants = db
    .prepare(
      `
      SELECT
        pv.id,

        pv.is_active,

        p.is_active
          AS product_is_active

      FROM product_variants pv

      JOIN products p
        ON p.id = pv.product_id

      WHERE pv.id IN (
        ${placeholders}
      )
      `,
    )
    .all(...variantIds) as Array<{
    id: number;

    is_active: number;

    product_is_active: number;
  }>;

  const variantMap = new Map(
    variants.map((variant) => [Number(variant.id), variant]),
  );

  for (const variantId of variantIds) {
    const variant = variantMap.get(variantId);

    if (
      !variant ||
      Number(variant.is_active) !== 1 ||
      Number(variant.product_is_active) !== 1
    ) {
      throw new Error('لا يمكن تعليق الفاتورة لأن أحد الأصناف لم يعد متاحًا');
    }
  }

  const title = String(input.title || '').trim() || 'فاتورة معلقة';

  const notes = String(input.notes || '').trim();

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
          INSERT INTO held_sales (
            user_id,

            customer_id,

            title,

            discount_type,

            discount_value,

            notes
          )

          VALUES (
            ?, ?, ?, ?, ?, ?
          )
          `,
      )
      .run(
        userId,

        customerId,

        title,

        discountType,

        discountType === 'amount' ? roundMoney(discountValue) : discountValue,

        notes || null,
      );

    const heldSaleId = Number(result.lastInsertRowid);

    const insertItem = db.prepare(
      `
          INSERT INTO
            held_sale_items (
              held_sale_id,

              variant_id,

              quantity,

              position
            )

          VALUES (
            ?, ?, ?, ?
          )
          `,
    );

    let position = 0;

    for (const [variantId, quantity] of quantities.entries()) {
      insertItem.run(
        heldSaleId,

        variantId,

        quantity,

        position,
      );

      position += 1;
    }

    return {
      success: true,

      heldSaleId,
    };
  });

  return tx();
}

export function listHeldSales(input: {
  actor_id: number;

  is_admin: boolean;
}) {
  const db = getDb();

  const actorId = Number(input.actor_id || 0);

  if (!actorId) {
    throw new Error('المستخدم غير صحيح');
  }

  return db
    .prepare(
      `
      SELECT
        hs.id,

        hs.user_id,

        u.name
          AS cashier_name,

        hs.customer_id,

        c.name
          AS customer_name,

        c.phone
          AS customer_phone,

        hs.title,

        hs.discount_type,

        hs.discount_value,

        hs.notes,

        hs.created_at,

        hs.updated_at,

        (
          SELECT COUNT(*)

          FROM held_sale_items hsi

          WHERE
            hsi.held_sale_id =
            hs.id
        ) AS items_count,

        (
          SELECT
            IFNULL(
              SUM(
                hsi.quantity
              ),
              0
            )

          FROM held_sale_items hsi

          WHERE
            hsi.held_sale_id =
            hs.id
        ) AS total_quantity,

        (
          SELECT
            IFNULL(
              SUM(
                hsi.quantity *
                pv.sell_price
              ),
              0
            )

          FROM held_sale_items hsi

          JOIN product_variants pv
            ON pv.id =
              hsi.variant_id

          WHERE
            hsi.held_sale_id =
            hs.id
        ) AS estimated_sub_total

      FROM held_sales hs

      JOIN users u
        ON u.id =
          hs.user_id

      LEFT JOIN customers c
        ON c.id =
          hs.customer_id

      WHERE (
        ? = 1
        OR hs.user_id = ?
      )

      ORDER BY
        hs.updated_at DESC,
        hs.id DESC
      `,
    )
    .all(
      input.is_admin ? 1 : 0,

      actorId,
    );
}

export function getHeldSale(input: HeldSaleAccessInput) {
  const db = getDb();

  const heldSale = getHeldSaleHeaderForAccess(input);

  const items = db
    .prepare(
      `
      SELECT
        hsi.id,

        hsi.variant_id,

        hsi.quantity,

        hsi.position,

        p.id
          AS product_id,

        p.name
          AS product_name,

        p.category_id,

        c.name
          AS category_name,

        IFNULL(
          pv.barcode,
          ''
        ) AS barcode,

        IFNULL(
          pv.size,
          ''
        ) AS size,

        IFNULL(
          pv.color,
          ''
        ) AS color,

        pv.sell_price,

        pv.buy_price,

        pv.min_stock,

        CASE
          WHEN
            pv.is_active = 1
            AND
            p.is_active = 1
          THEN 1

          ELSE 0
        END AS is_active,

        IFNULL(
          (
            SELECT
              SUM(
                CASE
                  WHEN sm.type =
                    'in'
                  THEN sm.quantity

                  WHEN sm.type =
                    'out'
                  THEN -sm.quantity

                  ELSE 0
                END
              )

            FROM stock_movements sm

            WHERE
              sm.variant_id =
              pv.id
          ),
          0
        ) AS stock

      FROM held_sale_items hsi

      JOIN product_variants pv
        ON pv.id =
          hsi.variant_id

      JOIN products p
        ON p.id =
          pv.product_id

      LEFT JOIN categories c
        ON c.id =
          p.category_id

      WHERE
        hsi.held_sale_id = ?

      ORDER BY
        hsi.position ASC,
        hsi.id ASC
      `,
    )
    .all(heldSale.id);

  return {
    ...heldSale,

    items,
  };
}

export function deleteHeldSale(input: HeldSaleAccessInput) {
  const db = getDb();

  const heldSale = getHeldSaleHeaderForAccess(input);

  db.prepare(
    `
    DELETE FROM held_sales

    WHERE id = ?
    `,
  ).run(heldSale.id);

  return {
    success: true,

    held_sale_id: Number(heldSale.id),

    title: heldSale.title,

    customer_id: heldSale.customer_id,
  };
}
