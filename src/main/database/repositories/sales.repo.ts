import { getDb } from '../db';
import { createCashMovement } from './cash.repo';

export type CreateSaleLineInput = {
  variant_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  unit_price: number;
};

type CreateSaleInput = {
  user_id: number;
  customer_id?: number | null;

  sub_total: number;
  discount_value: number;
  grand_total: number;
  change_amount: number;
  payment_method: string;
  notes?: string | null;

  loyalty_points_redeemed?: number;
  loyalty_discount_value?: number;
  paid?: number;
  remaining_amount?: number;
  payment_status?: string;

  items: Array<{
    variant_id: number;
    product_name: string;
    barcode?: string | null;
    size?: string | null;
    color?: string | null;
    quantity: number;
    unit_price: number;
  }>;
};

function getSetting(key: string, fallback: string) {
  const db = getDb();

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? fallback;
}

function getLoyaltySettingsForSale() {
  return {
    enabled: getSetting('loyalty_enabled', 'true') === 'true',
    earnAmount: Number(getSetting('loyalty_earn_amount', '100')),
    earnPoints: Number(getSetting('loyalty_earn_points', '1')),
    pointValue: Number(getSetting('loyalty_point_value', '1')),
    minRedeemPoints: Number(getSetting('loyalty_min_redeem_points', '1'))
  };
}

export function createSale(input: CreateSaleInput) {
  const db = getDb();

  if (!input.user_id) {
    throw new Error('User ID is required');
  }

  if (!input.items?.length) {
    throw new Error('Sale items are required');
  }

  const loyalty = getLoyaltySettingsForSale();

  const customerId = input.customer_id ? Number(input.customer_id) : null;
  const requestedRedeemPoints = Number(input.loyalty_points_redeemed || 0);

  const tx = db.transaction(() => {
    let redeemPoints = 0;
    let loyaltyDiscountValue = 0;

    if (loyalty.enabled && customerId && requestedRedeemPoints > 0) {
      const customer = db
        .prepare(`SELECT points_balance FROM customers WHERE id = ? LIMIT 1`)
        .get(customerId) as { points_balance: number } | undefined;

      if (!customer) {
        throw new Error('العميل غير موجود');
      }

      if (requestedRedeemPoints < loyalty.minRedeemPoints) {
        throw new Error(`أقل عدد نقاط للاستخدام هو ${loyalty.minRedeemPoints}`);
      }

      if (requestedRedeemPoints > Number(customer.points_balance || 0)) {
        throw new Error('رصيد نقاط العميل غير كافي');
      }

      redeemPoints = requestedRedeemPoints;
      loyaltyDiscountValue = redeemPoints * loyalty.pointValue;
    }

    const subTotal = Number(input.sub_total || 0);
    const normalDiscount = Number(input.discount_value || 0);
    const grandTotal = Math.max(0, subTotal - normalDiscount - loyaltyDiscountValue);

    const paidAmount = Math.min(
      Math.max(Number(input.paid ?? grandTotal), 0),
      grandTotal
    );

    const remainingAmount = Math.max(0, grandTotal - paidAmount);

    const paymentStatus =
      remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    if (remainingAmount > 0 && !customerId) {
      throw new Error('لا يمكن البيع آجل بدون اختيار عميل');
    }

    const earnedPoints =
      loyalty.enabled && customerId
        ? Math.floor(grandTotal / loyalty.earnAmount) * loyalty.earnPoints
        : 0;

    const saleResult = db
      .prepare(`
        INSERT INTO sales (
          type,
          customer_id,
          user_id,
          sub_total,
          discount_value,
          grand_total,
          paid,
          remaining_amount,
          payment_status, 
          change_amount,
          payment_method,
          notes,
          loyalty_points_earned,
          loyalty_points_redeemed,
          loyalty_discount_value
        )
        VALUES (
          'sale',
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)
      .run(
        customerId,
        input.user_id,
        subTotal,
        normalDiscount,
        grandTotal,
        paidAmount,
        remainingAmount,
        paymentStatus,
        Number(input.change_amount || 0),
        input.payment_method || 'cash',
        input.notes ?? null,
        earnedPoints,
        redeemPoints,
        loyaltyDiscountValue
      );

    const saleId = Number(saleResult.lastInsertRowid);

    if (paidAmount > 0) {
      createCashMovement({
        type: 'sale',
        direction: 'in',
        amount: paidAmount,
        payment_method: input.payment_method || 'cash',
        reference_id: saleId,
        reference_type: 'sale',
        notes: `تحصيل فاتورة بيع رقم ${saleId}`,
        created_by: input.user_id
      });
    }

    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        unit_price,
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'out', ?, ?, 'sale', ?)
    `);

    const getVariantCost = db.prepare(`
      SELECT buy_price
      FROM product_variants
      WHERE id = ?
      LIMIT 1
    `);

    const getCurrentStock = db.prepare(`
      SELECT IFNULL(SUM(
        CASE
          WHEN type = 'in' THEN quantity
          WHEN type = 'out' THEN -quantity
          ELSE 0
        END
      ), 0) AS stock
      FROM stock_movements
      WHERE variant_id = ?
    `);

    for (const item of input.items) {
      const qty = Number(item.quantity || 0);

      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`كمية غير صحيحة للصنف ${item.product_name}`);
      }
      const price = Number(item.unit_price || 0);
      const lineTotal = qty * price;

      const variant = getVariantCost.get(item.variant_id) as
        | { buy_price: number }
        | undefined;

        

        // const getCurrentStock = db.prepare(`
        //   SELECT IFNULL(SUM(
        //     CASE
        //       WHEN type = 'in' THEN quantity
        //       WHEN type = 'out' THEN -quantity
        //       ELSE 0
        //     END
        //   ), 0) AS stock
        //   FROM stock_movements
        //   WHERE variant_id = ?
        // `);

        const stockRow = getCurrentStock.get(item.variant_id) as { stock: number };
        const availableStock = Number(stockRow?.stock || 0);

        if (qty > availableStock) {
          throw new Error(
            `المخزون غير كافي للصنف ${item.product_name}. المتاح: ${availableStock}`
          );
        }

      insertItem.run(
        saleId,
        item.variant_id,
        item.product_name,
        item.barcode ?? null,
        item.size ?? null,
        item.color ?? null,
        qty,
        Number(variant?.buy_price || 0),
        price,
        lineTotal
      );

      updateStock.run(
        item.variant_id,
        qty,
        saleId,
        `بيع فاتورة رقم ${saleId}`
      );
    }

    if (customerId && loyalty.enabled) {
      db.prepare(`
        UPDATE customers
        SET
          points_balance = points_balance + ? - ?,
          total_spent = total_spent + ?,
          balance = IFNULL(balance, 0) + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(earnedPoints, redeemPoints, grandTotal, remainingAmount, customerId);

      if (earnedPoints > 0) {
        db.prepare(`
          INSERT INTO loyalty_transactions (
            customer_id,
            sale_id,
            type,
            points,
            amount,
            notes
          )
          VALUES (?, ?, 'earn', ?, ?, ?)
        `).run(
          customerId,
          saleId,
          earnedPoints,
          grandTotal,
          `اكتساب نقاط من فاتورة رقم ${saleId}`
        );
      }

      if (redeemPoints > 0) {
        db.prepare(`
          INSERT INTO loyalty_transactions (
            customer_id,
            sale_id,
            type,
            points,
            amount,
            notes
          )
          VALUES (?, ?, 'redeem', ?, ?, ?)
        `).run(
          customerId,
          saleId,
          -redeemPoints,
          loyaltyDiscountValue,
          `استخدام نقاط في فاتورة رقم ${saleId}`
        );
      }
    }

    return {
      saleId,
      loyalty_points_earned: earnedPoints,
      loyalty_points_redeemed: redeemPoints,
      loyalty_discount_value: loyaltyDiscountValue,
      grand_total: grandTotal,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus
    };
  });

  return tx();
}

export function getSaleReceipt(saleId: number) {
  const db = getDb();

  const sale = db
    .prepare(`
      SELECT
        s.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        u.name AS cashier_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
      LIMIT 1
    `)
    .get(saleId);

  if (!sale) {
    throw new Error('الفاتورة غير موجودة');
  }

const items = db
  .prepare(`
    SELECT
      si.id,
      si.sale_id,
      si.variant_id,
      si.product_name,
      si.barcode,
      si.size,
      si.color,
      si.quantity,
      si.unit_price,
      si.line_total,
      IFNULL((
        SELECT SUM(rsi.quantity)
        FROM sales rs
        JOIN sale_items rsi ON rsi.sale_id = rs.id
        WHERE rs.parent_sale_id = si.sale_id
          AND IFNULL(rs.type, '') = 'return'
          AND rsi.variant_id = si.variant_id
      ), 0) AS returned_quantity
    FROM sale_items si
    WHERE si.sale_id = ?
    ORDER BY si.id ASC
  `)
  .all(saleId);

  const loyalty = db
    .prepare(`
      SELECT
        id,
        customer_id,
        sale_id,
        type,
        points,
        amount,
        notes,
        created_at
      FROM loyalty_transactions
      WHERE sale_id = ?
      ORDER BY id ASC
    `)
    .all(saleId);

  return {
    sale,
    items,
    loyalty
  };
}

export function listSales(input?: {
  search?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();

  const search = input?.search?.trim() || '';
  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const where: string[] = [`s.type = 'sale'`];
  const params: any[] = [];

  if (search) {
    where.push(`
      (
        CAST(s.id AS TEXT) LIKE ?
        OR c.name LIKE ?
        OR c.phone LIKE ?
        OR u.name LIKE ?
      )
    `);

    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  if (input?.date_from) {
    where.push(`s.created_at >= ?`);
    params.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    where.push(`s.created_at <= ?`);
    params.push(`${input.date_to} 23:59:59`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT
        s.id,
        s.customer_id,
        s.user_id,
        s.sub_total,
        s.discount_value,
        s.grand_total,
        s.paid,
        s.change_amount,
        s.payment_method,
        s.notes,
        s.loyalty_points_earned,
        s.loyalty_points_redeemed,
        s.loyalty_discount_value,
        s.created_at,
        c.name AS customer_name,
        c.phone AS customer_phone,
        u.name AS cashier_name,
        COUNT(si.id) AS items_count
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN sale_items si ON si.sale_id = s.id
      ${whereSql}
      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT ?
      OFFSET ?
    `)
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      ${whereSql}
    `)
    .get(...params) as { total: number };

  return {
    rows,
    total: totalRow.total,
    limit,
    offset
  };
}

export function createSaleReturn(input: {
  original_sale_id: number;
  user_id: number;
  reason?: string | null;
  items: Array<{
    sale_item_id: number;
    variant_id: number;
    quantity: number;
  }>;
}) {
  const db = getDb();

  const originalSaleId = Number(input.original_sale_id);
  const userId = Number(input.user_id);
  const reason = input.reason?.trim() || null;

  if (!originalSaleId) {
    throw new Error('رقم الفاتورة الأصلية مطلوب');
  }

  if (!userId) {
    throw new Error('المستخدم مطلوب');
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف للمرتجع');
  }

  const tx = db.transaction(() => {
    const originalSale = db
      .prepare(`
        SELECT *
        FROM sales
        WHERE id = ?
          AND IFNULL(type, 'sale') = 'sale'
        LIMIT 1
      `)
      .get(originalSaleId) as any;

    if (!originalSale) {
      throw new Error('الفاتورة الأصلية غير موجودة');
    }

    const getOriginalItem = db.prepare(`
      SELECT *
      FROM sale_items
      WHERE id = ?
        AND sale_id = ?
      LIMIT 1
    `);

    const getAlreadyReturnedQty = db.prepare(`
      SELECT IFNULL(SUM(si.quantity), 0) AS returned_qty
      FROM sales r
      JOIN sale_items si ON si.sale_id = r.id
      WHERE r.parent_sale_id = ?
        AND IFNULL(r.type, '') = 'return'
        AND si.variant_id = ?
    `);

    let returnSubTotal = 0;
    

    const preparedItems = input.items
      .map((item) => {
        const originalItem = getOriginalItem.get(
          item.sale_item_id,
          originalSaleId
        ) as any;

        if (!originalItem) {
          throw new Error('صنف المرتجع غير موجود في الفاتورة الأصلية');
        }

        const requestedQty = Number(item.quantity || 0);

        if (requestedQty <= 0) {
          return null;
        }

        const alreadyReturned = getAlreadyReturnedQty.get(
          originalSaleId,
          originalItem.variant_id
        ) as { returned_qty: number };

        const maxReturnable =
          Number(originalItem.quantity || 0) -
          Number(alreadyReturned?.returned_qty || 0);

        if (requestedQty > maxReturnable) {
          throw new Error(
            `الكمية المطلوبة أكبر من المتاح للمرتجع للصنف: ${originalItem.product_name}`
          );
        }

        const unitPrice = Number(originalItem.unit_price || 0);
        const lineTotal = requestedQty * unitPrice;

        returnSubTotal += lineTotal;

        return {
          originalItem,
          quantity: requestedQty,
          unitPrice,
          lineTotal
        };
      })
      .filter(Boolean) as Array<{
        originalItem: any;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
      }>;

    if (preparedItems.length === 0) {
      throw new Error('لا توجد كميات صالحة للمرتجع');
    }

    
    const originalGrandTotal = Number(originalSale.grand_total || 0);
    const originalSubTotal = Number(originalSale.sub_total || 0);

    const ratio =
      originalSubTotal > 0
        ? Math.min(returnSubTotal / originalSubTotal, 1)
        : 0;

    const loyaltyPointsToReverse = Math.floor(
      Number(originalSale.loyalty_points_earned || 0) * ratio
    );

    const loyaltyDiscountPart = Number(
      (Number(originalSale.loyalty_discount_value || 0) * ratio).toFixed(2)
    );

    const refundAmount = Math.max(0, returnSubTotal - loyaltyDiscountPart);

    const returnSaleResult = db
      .prepare(`
        INSERT INTO sales (
          type,
          parent_sale_id,
          customer_id,
          user_id,
          sub_total,
          discount_value,
          grand_total,
          paid,
          change_amount,
          payment_method,
          notes,
          return_reason,
          loyalty_points_earned,
          loyalty_points_redeemed,
          loyalty_discount_value
        )
        VALUES (
          'return',
          ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 0, ?
        )
      `)
      .run(
        originalSaleId,
        originalSale.customer_id ?? null,
        userId,
        returnSubTotal,
        refundAmount,
        refundAmount,
        originalSale.payment_method || 'cash',
        `مرتجع من فاتورة رقم ${originalSaleId}`,
        reason,
        -loyaltyPointsToReverse,
        loyaltyDiscountPart
      );

    const returnSaleId = Number(returnSaleResult.lastInsertRowid);

    if (refundAmount > 0) {
      createCashMovement({
        type: 'sale_return',
        direction: 'out',
        amount: refundAmount,
        payment_method: originalSale.payment_method || 'cash',
        reference_id: returnSaleId,
        reference_type: 'sale_return',
        notes: `مرتجع فاتورة رقم ${originalSaleId}`,
        created_by: userId
      });
    }

    const insertReturnItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        unit_price,
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertStockMovement = db.prepare(`
      INSERT INTO stock_movements (
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes
      )
      VALUES (?, 'in', ?, ?, 'return', ?)
    `);

    for (const item of preparedItems) {
      insertReturnItem.run(
        returnSaleId,
        item.originalItem.variant_id,
        item.originalItem.product_name,
        item.originalItem.barcode ?? null,
        item.originalItem.size ?? null,
        item.originalItem.color ?? null,
        item.quantity,
        Number(item.originalItem.unit_cost || 0),
        item.unitPrice,
        item.lineTotal
      );

      insertStockMovement.run(
        item.originalItem.variant_id,
        item.quantity,
        returnSaleId,
        `مرتجع من فاتورة رقم ${originalSaleId}`
      );
    }

    if (originalSale.customer_id && loyaltyPointsToReverse > 0) {
      db.prepare(`
        UPDATE customers
        SET
          points_balance = MAX(points_balance - ?, 0),
          total_spent = MAX(total_spent - ?, 0),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        loyaltyPointsToReverse,
        refundAmount,
        originalSale.customer_id
      );

      db.prepare(`
        INSERT INTO loyalty_transactions (
          customer_id,
          sale_id,
          type,
          points,
          amount,
          notes
        )
        VALUES (?, ?, 'adjust', ?, ?, ?)
      `).run(
        originalSale.customer_id,
        returnSaleId,
        -loyaltyPointsToReverse,
        refundAmount,
        `خصم نقاط بسبب مرتجع فاتورة رقم ${originalSaleId}`
      );
    }

    return {
      returnSaleId,
      originalSaleId,
      refundAmount,
      loyalty_points_reversed: loyaltyPointsToReverse
    };
  });

  return tx();
}