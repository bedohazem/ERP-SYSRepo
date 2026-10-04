import { getDb } from '../db';

import { createPurchaseInvoice } from './purchases.repo';
import { roundMoney } from '../../../shared/money';

export type SmartReorderInput = {
  categoryId?: number | string | null;

  targetDays?: number;
};

export function getSmartReorderSuggestions(input?: SmartReorderInput) {
  const db = getDb();

  const rawCategoryId = input?.categoryId;

  const categoryId =
    rawCategoryId && rawCategoryId !== 'all' ? Number(rawCategoryId) : null;

  const rawTargetDays = Number(input?.targetDays || 30);

  const targetDays = Number.isFinite(rawTargetDays)
    ? Math.min(Math.max(Math.round(rawTargetDays), 7), 90)
    : 30;

  const params: any[] = [];

  let categorySql = '';

  if (categoryId && Number.isFinite(categoryId) && categoryId > 0) {
    categorySql = 'AND p.category_id = ?';

    params.push(categoryId);
  }

  const rows = db
    .prepare(
      `
      WITH
      inventory AS (
        SELECT
          v.id AS variant_id,

          p.id AS product_id,

          p.name AS product_name,

          p.category_id,

          v.barcode,
          v.size,
          v.color,

          v.buy_price,

          v.min_stock,

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
          ) AS current_stock

        FROM product_variants v

        JOIN products p
          ON p.id =
            v.product_id

        LEFT JOIN stock_movements sm
          ON sm.variant_id =
            v.id

        WHERE
          p.is_active = 1

          AND v.is_active = 1

          ${categorySql}

        GROUP BY v.id
      ),

      activity AS (
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
          ON s.id =
            si.sale_id

        WHERE
          IFNULL(
            s.type,
            'sale'
          ) = 'sale'

          AND
            s.cancelled_at
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
          ON sr.id =
            sri.return_id

        JOIN sales os
          ON os.id =
            sr.original_sale_id

        WHERE
          sr.cancelled_at
            IS NULL

          AND os.cancelled_at
            IS NULL

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
          se.cancelled_at
            IS NULL

          AND os.cancelled_at
            IS NULL

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
          se.cancelled_at
            IS NULL

          AND os.cancelled_at
            IS NULL
      ),

      recent_sales AS (
        SELECT
          variant_id,

          IFNULL(
            SUM(quantity_delta),
            0
          ) AS sold_units_30d

        FROM activity

        WHERE
          activity_date >=
            date(
              'now',
              'localtime',
              '-29 days'
            )

        GROUP BY variant_id
      )

      SELECT
        i.*,

        IFNULL(
          r.sold_units_30d,
          0
        ) AS sold_units_30d

      FROM inventory i

      LEFT JOIN recent_sales r
        ON r.variant_id =
          i.variant_id

      ORDER BY
        i.product_name ASC,
        i.variant_id ASC
      `,
    )
    .all(...params) as any[];

  return rows
    .map((row) => {
      const stock = Number(row.current_stock || 0);

      const minStock = Math.max(0, Number(row.min_stock || 0));

      const sold30 = Math.max(0, Number(row.sold_units_30d || 0));

      const averageDailySales = sold30 / 30;

      const demandTarget = Math.ceil(averageDailySales * targetDays);

      /*
       * Minimum stock يفضل
       * Safety Stock فوق
       * توقع الطلب.
       */
      const targetStock = Math.max(
        minStock,

        demandTarget + minStock,
      );

      const suggestedQuantity = Math.max(
        0,

        Math.ceil(targetStock - stock),
      );

      const unitCost = Math.max(0, Number(row.buy_price || 0));

      const coverageDays =
        averageDailySales > 0 ? Math.max(0, stock) / averageDailySales : null;

      let reason: 'out' | 'low' | 'demand';

      if (stock <= 0) {
        reason = 'out';
      } else if (stock <= minStock) {
        reason = 'low';
      } else {
        reason = 'demand';
      }

      return {
        variant_id: Number(row.variant_id),

        product_id: Number(row.product_id),

        product_name: String(row.product_name || ''),

        category_id: row.category_id == null ? null : Number(row.category_id),

        barcode: row.barcode ?? null,

        size: row.size ?? null,

        color: row.color ?? null,

        current_stock: stock,

        min_stock: minStock,

        sold_units_30d: sold30,

        average_daily_sales: Number(averageDailySales.toFixed(4)),

        target_days: targetDays,

        target_stock: targetStock,

        suggested_quantity: suggestedQuantity,

        coverage_days:
          coverageDays === null ? null : Number(coverageDays.toFixed(2)),

        unit_cost: unitCost,

        estimated_cost: roundMoney(suggestedQuantity * unitCost),

        reason,
      };
    })
    .filter((row) => row.suggested_quantity > 0)
    .sort(
      (a, b) =>
        b.suggested_quantity - a.suggested_quantity ||
        b.sold_units_30d - a.sold_units_30d ||
        a.product_name.localeCompare(b.product_name),
    );
}

export type PurchaseOrderItemInput = {
  variant_id: number;
  quantity: number;
  unit_cost?: number;
};

export type CreatePurchaseOrderInput = {
  supplier_id: number;

  notes?: string | null;

  actor_id?: number | null;

  items: PurchaseOrderItemInput[];
};

function preparePurchaseOrderItems(input: PurchaseOrderItemInput[]) {
  const db = getDb();

  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('أضف صنفًا واحدًا على الأقل لأمر الشراء');
  }

  const getVariant = db.prepare(
    `
      SELECT
        v.id,

        v.barcode,
        v.size,
        v.color,

        v.buy_price,

        v.is_active,

        p.name
          AS product_name,

        p.is_active
          AS product_is_active

      FROM product_variants v

      JOIN products p
        ON p.id =
          v.product_id

      WHERE
        v.id = ?

      LIMIT 1
      `,
  );

  const seen = new Set<number>();

  return input.map((item) => {
    const variantId = Number(item.variant_id);

    if (!variantId || seen.has(variantId)) {
      throw new Error('يوجد صنف مكرر أو غير صحيح في أمر الشراء');
    }

    seen.add(variantId);

    const variant = getVariant.get(variantId) as any;

    if (!variant) {
      throw new Error('الصنف غير موجود');
    }

    if (
      Number(variant.is_active) !== 1 ||
      Number(variant.product_is_active) !== 1
    ) {
      throw new Error(`الصنف ${variant.product_name} متعطل`);
    }

    const quantity = Number(item.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`كمية غير صحيحة للصنف ${variant.product_name}`);
    }

    const inputCost =
      item.unit_cost == null
        ? Number(variant.buy_price || 0)
        : Number(item.unit_cost);

    if (!Number.isFinite(inputCost) || inputCost < 0) {
      throw new Error(`تكلفة غير صحيحة للصنف ${variant.product_name}`);
    }

    const unitCost = roundMoney(inputCost);

    return {
      variant_id: variantId,

      product_name: String(variant.product_name),

      barcode: variant.barcode ?? null,

      size: variant.size ?? null,

      color: variant.color ?? null,

      quantity,

      unit_cost: unitCost,

      line_total: roundMoney(quantity * unitCost),
    };
  });
}

export function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  const db = getDb();

  const supplierId = Number(input.supplier_id);

  const supplier = db
    .prepare(
      `
      SELECT id

      FROM suppliers

      WHERE
        id = ?

        AND is_active = 1

      LIMIT 1
      `,
    )
    .get(supplierId);

  if (!supplier) {
    throw new Error('المورد غير موجود أو متعطل');
  }

  const items = preparePurchaseOrderItems(input.items);

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
          INSERT INTO
            purchase_orders (
              supplier_id,

              status,

              notes,

              created_by
            )

          VALUES (
            ?,
            'draft',
            ?,
            ?
          )
          `,
      )
      .run(
        supplierId,

        input.notes?.trim() || null,

        input.actor_id ?? null,
      );

    const orderId = Number(result.lastInsertRowid);

    const insertItem = db.prepare(
      `
          INSERT INTO
            purchase_order_items (
              purchase_order_id,

              variant_id,

              product_name,

              barcode,
              size,
              color,

              quantity,

              unit_cost,

              line_total
            )

          VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?
          )
          `,
    );

    for (const item of items) {
      insertItem.run(
        orderId,

        item.variant_id,

        item.product_name,

        item.barcode,
        item.size,
        item.color,

        item.quantity,

        item.unit_cost,

        item.line_total,
      );
    }

    return {
      purchase_order_id: orderId,

      status: 'draft',

      total_amount: roundMoney(
        items.reduce(
          (sum, item) => sum + item.line_total,

          0,
        ),
      ),

      items_count: items.length,
    };
  });

  return tx();
}

export function getPurchaseOrder(orderIdInput: number) {
  const db = getDb();

  const orderId = Number(orderIdInput);

  const order = db
    .prepare(
      `
      SELECT
        po.*,

        s.name
          AS supplier_name,

        u.name
          AS created_by_name,

        (
          SELECT
            COUNT(*)

          FROM
            purchase_order_items poi

          WHERE
            poi.purchase_order_id =
              po.id
        ) AS items_count,

        (
          SELECT
            IFNULL(
              SUM(line_total),
              0
            )

          FROM
            purchase_order_items poi

          WHERE
            poi.purchase_order_id =
              po.id
        ) AS total_amount

      FROM purchase_orders po

      JOIN suppliers s
        ON s.id =
          po.supplier_id

      LEFT JOIN users u
        ON u.id =
          po.created_by

      WHERE
        po.id = ?

      LIMIT 1
      `,
    )
    .get(orderId) as any;

  if (!order) {
    throw new Error('أمر الشراء غير موجود');
  }

  const items = db
    .prepare(
      `
      SELECT *

      FROM purchase_order_items

      WHERE
        purchase_order_id = ?

      ORDER BY id ASC
      `,
    )
    .all(orderId);

  return {
    order: {
      ...order,

      items_count: Number(order.items_count || 0),

      total_amount: Number(order.total_amount || 0),
    },

    items,
  };
}

export function listPurchaseOrders(input?: {
  status?: string;
  supplier_id?: number;
}) {
  const db = getDb();

  const where: string[] = [];

  const params: any[] = [];

  const status = String(input?.status || '').trim();

  if (status && status !== 'all') {
    where.push('po.status = ?');

    params.push(status);
  }

  const supplierId = Number(input?.supplier_id || 0);

  if (supplierId > 0) {
    where.push('po.supplier_id = ?');

    params.push(supplierId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return db
    .prepare(
      `
      SELECT
        po.*,

        s.name
          AS supplier_name,

        u.name
          AS created_by_name,

        COUNT(poi.id)
          AS items_count,

        IFNULL(
          SUM(
            poi.line_total
          ),
          0
        ) AS total_amount

      FROM purchase_orders po

      JOIN suppliers s
        ON s.id =
          po.supplier_id

      LEFT JOIN users u
        ON u.id =
          po.created_by

      LEFT JOIN
        purchase_order_items poi
        ON
          poi.purchase_order_id =
            po.id

      ${whereSql}

      GROUP BY po.id

      ORDER BY po.id DESC
      `,
    )
    .all(...params);
}

export function updatePurchaseOrder(input: {
  purchase_order_id: number;

  supplier_id: number;

  notes?: string | null;

  items: PurchaseOrderItemInput[];
}) {
  const db = getDb();

  const orderId = Number(input.purchase_order_id);

  const current = getPurchaseOrder(orderId).order;

  if (current.status !== 'draft') {
    throw new Error('لا يمكن تعديل أمر شراء بعد اعتماده');
  }

  const supplierId = Number(input.supplier_id);

  const supplier = db
    .prepare(
      `
      SELECT id

      FROM suppliers

      WHERE
        id = ?

        AND is_active = 1

      LIMIT 1
      `,
    )
    .get(supplierId);

  if (!supplier) {
    throw new Error('المورد غير موجود أو متعطل');
  }

  const items = preparePurchaseOrderItems(input.items);

  const tx = db.transaction(() => {
    db.prepare(
      `
        UPDATE purchase_orders

        SET
          supplier_id = ?,

          notes = ?,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
        `,
    ).run(
      supplierId,

      input.notes?.trim() || null,

      orderId,
    );

    db.prepare(
      `
        DELETE FROM
          purchase_order_items

        WHERE
          purchase_order_id = ?
        `,
    ).run(orderId);

    const insertItem = db.prepare(
      `
          INSERT INTO
            purchase_order_items (
              purchase_order_id,

              variant_id,

              product_name,

              barcode,
              size,
              color,

              quantity,

              unit_cost,

              line_total
            )

          VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?
          )
          `,
    );

    for (const item of items) {
      insertItem.run(
        orderId,

        item.variant_id,

        item.product_name,

        item.barcode,
        item.size,
        item.color,

        item.quantity,

        item.unit_cost,

        item.line_total,
      );
    }
  });

  tx();

  return getPurchaseOrder(orderId);
}

export function markPurchaseOrderOrdered(input: {
  purchase_order_id: number;

  actor_id?: number | null;
}) {
  const db = getDb();

  const orderId = Number(input.purchase_order_id);

  const current = getPurchaseOrder(orderId).order;

  if (current.status !== 'draft') {
    throw new Error('يمكن اعتماد أمر الشراء من المسودة فقط');
  }

  db.prepare(
    `
    UPDATE purchase_orders

    SET
      status = 'ordered',

      ordered_by = ?,

      ordered_at =
        CURRENT_TIMESTAMP,

      updated_at =
        CURRENT_TIMESTAMP

    WHERE id = ?
    `,
  ).run(
    input.actor_id ?? null,

    orderId,
  );

  return getPurchaseOrder(orderId);
}

export function cancelPurchaseOrder(input: {
  purchase_order_id: number;

  reason?: string | null;

  actor_id?: number | null;
}) {
  const db = getDb();

  const orderId = Number(input.purchase_order_id);

  const current = getPurchaseOrder(orderId).order;

  if (current.status === 'received') {
    throw new Error('لا يمكن إلغاء أمر شراء تم استلامه');
  }

  if (current.status === 'cancelled') {
    throw new Error('أمر الشراء ملغى بالفعل');
  }

  const reason = String(input.reason || '').trim() || 'إلغاء أمر الشراء';

  db.prepare(
    `
    UPDATE purchase_orders

    SET
      status =
        'cancelled',

      cancelled_by = ?,

      cancelled_at =
        CURRENT_TIMESTAMP,

      cancel_reason = ?,

      updated_at =
        CURRENT_TIMESTAMP

    WHERE id = ?
    `,
  ).run(
    input.actor_id ?? null,

    reason,

    orderId,
  );

  return {
    success: true,

    purchase_order_id: orderId,

    reason,
  };
}

export function receivePurchaseOrder(input: {
  purchase_order_id: number;

  actor_id: number;

  paid_amount?: number;

  payment_method?: string;

  discount_type?: 'amount' | 'percent';

  discount_input?: number;

  discount_value?: number;

  notes?: string | null;
}) {
  const db = getDb();

  const orderId = Number(input.purchase_order_id);

  const snapshot = getPurchaseOrder(orderId);

  if (snapshot.order.status === 'received') {
    throw new Error('أمر الشراء تم استلامه بالفعل');
  }

  if (snapshot.order.status === 'cancelled') {
    throw new Error('لا يمكن استلام أمر شراء ملغى');
  }

  const items = snapshot.items.map((item: any) => {
    const unitCost = Number(item.unit_cost || 0);

    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      throw new Error(`حدد تكلفة شراء صحيحة للصنف ${item.product_name}`);
    }

    return {
      variant_id: Number(item.variant_id),

      quantity: Number(item.quantity),

      unit_cost: unitCost,
    };
  });

  const tx = db.transaction(() => {
    const purchase = createPurchaseInvoice({
      actor_id: input.actor_id,

      supplier_id: Number(snapshot.order.supplier_id),

      paid_amount: input.paid_amount,

      discount_type: input.discount_type,

      discount_input: input.discount_input,

      discount_value: input.discount_value,

      payment_method: input.payment_method,

      notes: input.notes?.trim() || `استلام أمر شراء #${orderId}`,

      items,
    });

    db.prepare(
      `
        UPDATE purchase_orders

        SET
          status =
            'received',

          purchase_id = ?,

          received_by = ?,

          received_at =
            CURRENT_TIMESTAMP,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
        `,
    ).run(
      purchase.purchaseId,

      input.actor_id,

      orderId,
    );

    return {
      ...purchase,

      purchase_order_id: orderId,
    };
  });

  return tx();
}
