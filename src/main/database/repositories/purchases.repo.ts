import { getDb } from '../db';
import { createCashMovement } from './cash.repo';

export type CreatePurchaseInput = {
  supplier_id: number;
  paid_amount?: number;
  sub_total?: number;
  discount_type?: 'amount' | 'percent' | string;
  discount_input?: number;
  discount_value?: number;
  payment_method?: string;
  notes?: string | null;
  items: Array<{
    variant_id: number;
    quantity: number;
    unit_cost: number;
  }>;
};

export function createPurchaseInvoice(input: CreatePurchaseInput) {
  const db = getDb();

  const supplierId = Number(input.supplier_id);
  const paidAmountInput = Number(input.paid_amount || 0);

  if (!supplierId) {
    throw new Error('اختار المورد');
  }

  if (!input.items?.length) {
    throw new Error('لا توجد أصناف في فاتورة الشراء');
  }

  const tx = db.transaction(() => {
    const supplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(supplierId) as any;

    if (!supplier) {
      throw new Error('المورد غير موجود');
    }

    const getVariant = db.prepare(`
      SELECT
        v.id,
        v.barcode,
        v.size,
        v.color,
        v.buy_price,
        p.name AS product_name
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
      LIMIT 1
    `);

    const preparedItems = input.items.map((item) => {
      const variant = getVariant.get(Number(item.variant_id)) as any;

      if (!variant) {
        throw new Error('الصنف غير موجود');
      }

      const quantity = Number(item.quantity || 0);
      const unitCost = Number(item.unit_cost || 0);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`كمية غير صحيحة للصنف ${variant.product_name}`);
      }

      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        throw new Error(`سعر شراء غير صحيح للصنف ${variant.product_name}`);
      }

      return {
        variant,
        quantity,
        unitCost,
        lineTotal: quantity * unitCost
      };
    });

    const totalAmount = preparedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discountValueInput = Number(input.discount_value || 0);
    const discountValue = Number.isFinite(discountValueInput)
      ? Math.max(0, discountValueInput)
      : 0;

    const subTotalInput = Number(input.sub_total || 0);
    const subTotal = Number.isFinite(subTotalInput) && subTotalInput > 0
      ? subTotalInput
      : totalAmount + discountValue;

    const discountInput = Number(input.discount_input || 0);
    const discountType = input.discount_type === 'percent' ? 'percent' : 'amount';
    const paidAmount = Math.min(Math.max(paidAmountInput, 0), totalAmount);
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    const paymentStatus =
      remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    const purchaseResult = db
      .prepare(`
        INSERT INTO purchase_invoices (
          supplier_id,
          total_amount,
          sub_total,
          discount_type,
          discount_input,
          discount_value,
          paid_amount,
          remaining_amount,
          payment_status,
          payment_method,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        supplierId,
        totalAmount,
        subTotal,
        discountType,
        discountInput,
        discountValue,
        paidAmount,
        remainingAmount,
        paymentStatus,
        input.payment_method || 'cash',
        input.notes?.trim() || null
      );

    const purchaseId = Number(purchaseResult.lastInsertRowid);

    const insertItem = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id,
        variant_id,
        product_name,
        barcode,
        size,
        color,
        quantity,
        unit_cost,
        line_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      VALUES (?, 'in', ?, ?, 'purchase', ?)
    `);

    const updateVariantCost = db.prepare(`
      UPDATE product_variants
      SET buy_price = ?
      WHERE id = ?
    `);

    for (const item of preparedItems) {
      insertItem.run(
        purchaseId,
        item.variant.id,
        item.variant.product_name,
        item.variant.barcode ?? null,
        item.variant.size ?? null,
        item.variant.color ?? null,
        item.quantity,
        item.unitCost,
        item.lineTotal
      );

      insertStockMovement.run(
        item.variant.id,
        item.quantity,
        purchaseId,
        `دخول مخزون من فاتورة شراء رقم ${purchaseId}`
      );

      updateVariantCost.run(item.unitCost, item.variant.id);
    }

    db.prepare(`
      UPDATE suppliers
      SET
        total_purchased = total_purchased + ?,
        balance = balance + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalAmount, remainingAmount, supplierId);

    if (paidAmount > 0) {
      db.prepare(`
        INSERT INTO supplier_payments (
          supplier_id,
          purchase_id,
          amount,
          payment_method,
          notes
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        supplierId,
        purchaseId,
        paidAmount,
        input.payment_method || 'cash',
        `دفعة عند إنشاء فاتورة شراء رقم ${purchaseId}`
      );

      createCashMovement({
        type: 'supplier_payment',
        direction: 'out',
        amount: paidAmount,
        payment_method: input.payment_method || 'cash',
        reference_id: purchaseId,
        reference_type: 'purchase_invoice',
        notes: `دفع فاتورة شراء رقم ${purchaseId}`,
        created_by: (input as any).actor_id ?? null
      });
    }

    return {
      purchaseId,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus
    };
  });

  return tx();
}

export function listPurchaseInvoices(input?: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();

  const search = input?.search?.trim() || '';
  const limit = Math.min(Math.max(Number(input?.limit || 100), 1), 300);
  const offset = Math.max(Number(input?.offset || 0), 0);

  const where: string[] = [];
  const params: any[] = [];

  if (search) {
    where.push(`
      (
        CAST(pi.id AS TEXT) LIKE ?
        OR s.name LIKE ?
        OR IFNULL(s.phone, '') LIKE ?
      )
    `);

    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT
        pi.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone,
        COUNT(pii.id) AS items_count
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      LEFT JOIN purchase_items pii ON pii.purchase_id = pi.id
      ${whereSql}
      GROUP BY pi.id
      ORDER BY pi.id DESC
      LIMIT ?
      OFFSET ?
    `)
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      ${whereSql}
    `)
    .get(...params) as { total: number };

  return {
    rows,
    total: Number(totalRow?.total || 0),
    limit,
    offset
  };
}

export function getPurchaseInvoice(purchaseId: number) {
  const db = getDb();

  const purchase = db
    .prepare(`
      SELECT
        pi.*,
        s.name AS supplier_name,
        s.phone AS supplier_phone
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      WHERE pi.id = ?
      LIMIT 1
    `)
    .get(Number(purchaseId));

  if (!purchase) {
    throw new Error('فاتورة الشراء غير موجودة');
  }

  const items = db
    .prepare(`
      SELECT *
      FROM purchase_items
      WHERE purchase_id = ?
      ORDER BY id ASC
    `)
    .all(Number(purchaseId));

  const payments = db
    .prepare(`
      SELECT *
      FROM supplier_payments
      WHERE purchase_id = ?
      ORDER BY id ASC
    `)
    .all(Number(purchaseId));

  return {
    purchase,
    items,
    payments
  };
}

export function recordSupplierPayment(input: {
  supplier_id: number;
  purchase_id?: number | null;
  amount: number;
  payment_method?: string;
  notes?: string | null;
}) {
  const db = getDb();

  const supplierId = Number(input.supplier_id);
  const purchaseId = input.purchase_id ? Number(input.purchase_id) : null;
  const amountInput = Number(input.amount || 0);

  if (!supplierId) {
    throw new Error('Supplier ID is required');
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح');
  }

  const tx = db.transaction(() => {
    const supplier = db
      .prepare(`SELECT * FROM suppliers WHERE id = ? AND is_active = 1 LIMIT 1`)
      .get(supplierId) as any;

    if (!supplier) {
      throw new Error('المورد غير موجود');
    }

    const insertPayment = db.prepare(`
      INSERT INTO supplier_payments (
        supplier_id,
        purchase_id,
        amount,
        payment_method,
        notes
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    const updatePurchase = db.prepare(`
      UPDATE purchase_invoices
      SET
        paid_amount = ?,
        remaining_amount = ?,
        payment_status = ?
      WHERE id = ?
    `);

    let totalPaid = 0;
    const allocations: Array<{
      purchase_id: number | null;
      amount: number;
    }> = [];

    // لو الدفعة مرتبطة بفاتورة معينة
    if (purchaseId) {
      const purchase = db
        .prepare(`
          SELECT *
          FROM purchase_invoices
          WHERE id = ?
            AND supplier_id = ?
          LIMIT 1
        `)
        .get(purchaseId, supplierId) as any;

      if (!purchase) {
        throw new Error('فاتورة الشراء غير موجودة');
      }

      const remaining = Number(purchase.remaining_amount || 0);

      if (remaining <= 0) {
        throw new Error('الفاتورة مدفوعة بالكامل بالفعل');
      }

      const finalAmount = Math.min(amountInput, remaining);

      const newPaid = Math.min(
        Number(purchase.total_amount || 0),
        Number(purchase.paid_amount || 0) + finalAmount
      );

      const newRemaining = Math.max(0, Number(purchase.total_amount || 0) - newPaid);

      const newStatus =
        newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

      updatePurchase.run(newPaid, newRemaining, newStatus, purchaseId);

      insertPayment.run(
        supplierId,
        purchaseId,
        finalAmount,
        input.payment_method || 'cash',
        input.notes?.trim() || `دفعة على فاتورة شراء رقم ${purchaseId}`
      );

      totalPaid = finalAmount;
      allocations.push({
        purchase_id: purchaseId,
        amount: finalAmount
      });
    } else {
      // دفعة عامة للمورد: تتوزع تلقائيًا على أقدم فواتير مفتوحة
      const supplierBalance = Number(supplier.balance || 0);
      let remainingPayment = Math.min(amountInput, supplierBalance);

      if (remainingPayment <= 0) {
        throw new Error('لا يوجد رصيد مستحق على المورد');
      }

      const openPurchases = db
        .prepare(`
          SELECT *
          FROM purchase_invoices
          WHERE supplier_id = ?
            AND remaining_amount > 0
          ORDER BY id ASC
        `)
        .all(supplierId) as any[];

      if (openPurchases.length === 0) {
        throw new Error('لا توجد فواتير مفتوحة لهذا المورد');
      }

      for (const purchase of openPurchases) {
        if (remainingPayment <= 0) break;

        const purchaseRemaining = Number(purchase.remaining_amount || 0);
        const payNow = Math.min(remainingPayment, purchaseRemaining);

        const newPaid = Math.min(
          Number(purchase.total_amount || 0),
          Number(purchase.paid_amount || 0) + payNow
        );

        const newRemaining = Math.max(0, Number(purchase.total_amount || 0) - newPaid);

        const newStatus =
          newRemaining === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

        updatePurchase.run(newPaid, newRemaining, newStatus, purchase.id);

        insertPayment.run(
          supplierId,
          purchase.id,
          payNow,
          input.payment_method || 'cash',
          input.notes?.trim() || `دفعة عامة موزعة على فاتورة شراء رقم ${purchase.id}`
        );

        totalPaid += payNow;
        remainingPayment -= payNow;

        allocations.push({
          purchase_id: purchase.id,
          amount: payNow
        });
      }
    }

    if (totalPaid <= 0) {
      throw new Error('لم يتم تسجيل أي دفعة');
    }

    db.prepare(`
      UPDATE suppliers
      SET
        balance = MAX(balance - ?, 0),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalPaid, supplierId);

    createCashMovement({
      type: 'supplier_payment',
      direction: 'out',
      amount: totalPaid,
      payment_method: input.payment_method || 'cash',
      reference_id: purchaseId,
      reference_type: purchaseId ? 'purchase_invoice' : 'supplier_payment',
      notes: input.notes?.trim() || 'دفعة للمورد',
      created_by: (input as any).actor_id ?? null
    });

    return {
      ok: true,
      supplier_id: supplierId,
      paid_amount: totalPaid,
      allocations
    };
  });

  return tx();
}

export function getSupplierStatement(supplierId: number) {
  const db = getDb();
  const id = Number(supplierId);

  if (!id) {
    throw new Error('Supplier ID is required');
  }

  const supplier = db
    .prepare(`
      SELECT *
      FROM suppliers
      WHERE id = ?
      LIMIT 1
    `)
    .get(id) as any;

  if (!supplier) {
    throw new Error('المورد غير موجود');
  }

  const purchases = db
    .prepare(`
      SELECT *
      FROM purchase_invoices
      WHERE supplier_id = ?
      ORDER BY created_at DESC, id DESC
    `)
    .all(id) as any[];

  const payments = db
    .prepare(`
      SELECT *
      FROM supplier_payments
      WHERE supplier_id = ?
      ORDER BY created_at DESC, id DESC
    `)
    .all(id) as any[];

  const entries = [
    ...purchases.map((purchase) => ({
      id: `purchase-${purchase.id}`,
      type: 'purchase',
      title: `فاتورة شراء #${purchase.id}`,
      debit: Number(purchase.total_amount || 0),
      credit: 0,
      purchase_id: purchase.id,
      payment_status: purchase.payment_status,
      notes: purchase.notes,
      created_at: purchase.created_at
    })),

    ...payments.map((payment) => ({
      id: `payment-${payment.id}`,
      type: 'payment',
      title: payment.purchase_id
        ? `دفعة على فاتورة #${payment.purchase_id}`
        : 'دفعة مورد',
      debit: 0,
      credit: Number(payment.amount || 0),
      purchase_id: payment.purchase_id,
      payment_method: payment.payment_method,
      notes: payment.notes,
      created_at: payment.created_at
    }))
  ].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return {
    supplier,
    purchases,
    payments,
    entries,
    summary: {
      total_purchased: Number(supplier.total_purchased || 0),
      total_paid: payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      balance: Number(supplier.balance || 0),
      open_purchases: purchases.filter((p) => Number(p.remaining_amount || 0) > 0).length
    }
  };
}