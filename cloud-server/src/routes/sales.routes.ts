import express from 'express';
import { pool, query } from '../db.js';

const router = express.Router();

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function buildInvoiceNo(branchId: string, number: number) {
  return `${branchId.toUpperCase()}-${String(number).padStart(6, '0')}`;
}

router.post('/', async (req, res) => {
  const body = req.body || {};

  const branchId = String(body.branch_id || 'main').trim();
  const warehouseId = String(body.warehouse_id || 'main-warehouse').trim();
  const cashRegisterId = body.cash_register_id
    ? String(body.cash_register_id).trim()
    : 'main-cashier-1';

  const cashierId = body.cashier_id ? String(body.cashier_id).trim() : null;
  const customerId = body.customer_id ? String(body.customer_id).trim() : null;
  const clientOperationId = body.client_operation_id
    ? String(body.client_operation_id).trim()
    : null;

  const paymentMethod = String(body.payment_method || 'cash').trim();
  const notes = body.notes == null ? null : String(body.notes).trim() || null;
  const items = Array.isArray(body.items) ? body.items : [];

  if (!branchId) {
    return res.status(400).json({
      success: false,
      message: 'branch_id مطلوب'
    });
  }

  if (!warehouseId) {
    return res.status(400).json({
      success: false,
      message: 'warehouse_id مطلوب'
    });
  }

  if (items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'الفاتورة بدون أصناف'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (clientOperationId) {
      const existingSale = await client.query(
        `
        SELECT *
        FROM sales
        WHERE client_operation_id = $1
        LIMIT 1
        `,
        [clientOperationId]
      );

      if (existingSale.rows[0]) {
        await client.query('COMMIT');

        return res.json({
          success: true,
          duplicate: true,
          sale: existingSale.rows[0],
          message: 'الفاتورة مسجلة قبل كده'
        });
      }
    }

    const counterResult = await client.query<{ last_sale_number: string }>(
      `
      INSERT INTO invoice_counters (branch_id, last_sale_number, updated_at)
      VALUES ($1, 1, NOW())
      ON CONFLICT (branch_id) DO UPDATE SET
        last_sale_number = invoice_counters.last_sale_number + 1,
        updated_at = NOW()
      RETURNING last_sale_number
      `,
      [branchId]
    );

    const invoiceNo = buildInvoiceNo(
      branchId,
      Number(counterResult.rows[0].last_sale_number)
    );

    const preparedItems: any[] = [];
    let subTotal = 0;

    for (const item of items) {
      const variantId = item.variant_id ? String(item.variant_id).trim() : null;
      const barcode = item.barcode ? String(item.barcode).trim() : null;
      const quantity = toNumber(item.quantity);

      if (!variantId && !barcode) {
        throw new Error('كل صنف لازم يكون له variant_id أو barcode');
      }

      if (quantity <= 0) {
        throw new Error('كمية الصنف غير صحيحة');
      }

      const variantResult = await client.query(
        `
        SELECT
          pv.id,
          pv.product_id,
          pv.barcode,
          pv.size,
          pv.color,
          pv.buy_price,
          pv.sale_price,
          pv.wholesale_price,
          pv.is_active,
          p.name AS product_name,
          p.is_active AS product_is_active
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE
          (
            ($1::text IS NOT NULL AND pv.id = $1)
            OR
            ($2::text IS NOT NULL AND pv.barcode = $2)
          )
        LIMIT 1
        `,
        [variantId, barcode]
      );

      const variant = variantResult.rows[0];

      if (!variant) {
        throw new Error(`الصنف غير موجود: ${barcode || variantId}`);
      }

      if (!variant.is_active || !variant.product_is_active) {
        throw new Error(`الصنف غير مفعل: ${variant.product_name}`);
      }

      await client.query(
        `
        INSERT INTO stock_balances (warehouse_id, variant_id, quantity, updated_at)
        VALUES ($1, $2, 0, NOW())
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING
        `,
        [warehouseId, variant.id]
      );

      const balanceResult = await client.query(
        `
        SELECT quantity
        FROM stock_balances
        WHERE warehouse_id = $1
          AND variant_id = $2
        FOR UPDATE
        `,
        [warehouseId, variant.id]
      );

      const availableQuantity = toNumber(balanceResult.rows[0]?.quantity);

      if (availableQuantity < quantity) {
        return res.status(409).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: `الكمية غير كافية للصنف ${variant.product_name}. المتاح ${availableQuantity} والمطلوب ${quantity}`,
          item: {
            variant_id: variant.id,
            barcode: variant.barcode,
            product_name: variant.product_name,
            available_quantity: availableQuantity,
            requested_quantity: quantity
          }
        });
      }

      const unitCost = toNumber(variant.buy_price);
      const unitPrice =
        item.unit_price == null
          ? toNumber(variant.sale_price)
          : toNumber(item.unit_price);

      if (unitPrice < 0) {
        throw new Error('سعر البيع غير صحيح');
      }

      const lineTotal = roundMoney(quantity * unitPrice);

      preparedItems.push({
        variant,
        quantity,
        unit_cost: unitCost,
        unit_price: unitPrice,
        line_total: lineTotal
      });

      subTotal += lineTotal;
    }

    subTotal = roundMoney(subTotal);

    const discountValue = Math.min(
      Math.max(toNumber(body.discount_value), 0),
      subTotal
    );

    const grandTotal = roundMoney(subTotal - discountValue);
    const paidAmount = Math.min(
      Math.max(
        body.paid_amount == null ? grandTotal : toNumber(body.paid_amount),
        0
      ),
      grandTotal
    );

    const remainingAmount = roundMoney(grandTotal - paidAmount);

    const paymentStatus =
      remainingAmount <= 0
        ? 'paid'
        : paidAmount > 0
          ? 'partial'
          : 'unpaid';

    if (remainingAmount > 0 && !customerId) {
      throw new Error('لازم تختار عميل لو الفاتورة عليها مبلغ متبقي');
    }

    const saleResult = await client.query(
      `
      INSERT INTO sales (
        branch_id,
        warehouse_id,
        cash_register_id,
        cashier_id,
        customer_id,
        invoice_no,
        client_operation_id,
        status,
        sub_total,
        discount_value,
        grand_total,
        paid_amount,
        remaining_amount,
        payment_status,
        payment_method,
        notes
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, 'completed',
        $8, $9, $10, $11, $12,
        $13, $14, $15
      )
      RETURNING *
      `,
      [
        branchId,
        warehouseId,
        cashRegisterId,
        cashierId,
        customerId,
        invoiceNo,
        clientOperationId,
        subTotal,
        discountValue,
        grandTotal,
        paidAmount,
        remainingAmount,
        paymentStatus,
        paymentMethod,
        notes
      ]
    );

    const sale = saleResult.rows[0];

    const createdItems: any[] = [];

    for (const item of preparedItems) {
      const variant = item.variant;

      await client.query(
        `
        UPDATE stock_balances
        SET quantity = quantity - $3,
            updated_at = NOW()
        WHERE warehouse_id = $1
          AND variant_id = $2
        `,
        [warehouseId, variant.id, item.quantity]
      );

      const saleItemResult = await client.query(
        `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        `,
        [
          sale.id,
          variant.id,
          variant.product_name,
          variant.barcode,
          variant.size,
          variant.color,
          item.quantity,
          item.unit_cost,
          item.unit_price,
          item.line_total
        ]
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
          notes,
          created_by
        )
        VALUES ($1, $2, $3, 'out', $4, $5, 'sale', $6, $7, $8)
        `,
        [
          branchId,
          warehouseId,
          variant.id,
          item.quantity,
          item.unit_cost,
          sale.id,
          `بيع فاتورة ${invoiceNo}`,
          cashierId
        ]
      );

      createdItems.push(saleItemResult.rows[0]);
    }

    if (paidAmount > 0) {
      await client.query(
        `
        INSERT INTO cash_movements (
          branch_id,
          cash_register_id,
          type,
          direction,
          amount,
          payment_method,
          reference_type,
          reference_id,
          notes,
          created_by
        )
        VALUES ($1, $2, 'sale', 'in', $3, $4, 'sale', $5, $6, $7)
        `,
        [
          branchId,
          cashRegisterId,
          paidAmount,
          paymentMethod,
          sale.id,
          `تحصيل فاتورة ${invoiceNo}`,
          cashierId
        ]
      );
    }

    if (customerId) {
      await client.query(
        `
        UPDATE customers
        SET total_spent = total_spent + $2,
            balance = balance + $3,
            updated_at = NOW()
        WHERE id = $1
        `,
        [customerId, grandTotal, remainingAmount]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      sale: {
        ...sale,
        items: createdItems
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');

    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create sale'
    });
  } finally {
    client.release();
  }
});

router.get('/', async (req, res) => {
  const branchId = String(req.query.branch_id || 'main').trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 300);

  const result = await query(
    `
    SELECT
      s.*,
      cr.name AS cash_register_name,
      c.name AS customer_name
    FROM sales s
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.branch_id = $1
    ORDER BY s.created_at DESC
    LIMIT $2
    `,
    [branchId, limit]
  );

  res.json({
    success: true,
    sales: result.rows
  });
});

router.get('/:saleId', async (req, res) => {
  const saleId = String(req.params.saleId || '').trim();

  const saleResult = await query(
    `
    SELECT
      s.*,
      cr.name AS cash_register_name,
      c.name AS customer_name
    FROM sales s
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = $1
    LIMIT 1
    `,
    [saleId]
  );

  const sale = saleResult.rows[0];

  if (!sale) {
    return res.status(404).json({
      success: false,
      message: 'الفاتورة غير موجودة'
    });
  }

  const itemsResult = await query(
    `
    SELECT *
    FROM sale_items
    WHERE sale_id = $1
    ORDER BY product_name ASC
    `,
    [saleId]
  );

  res.json({
    success: true,
    sale: {
      ...sale,
      items: itemsResult.rows
    }
  });
});

export default router;