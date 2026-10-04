import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo'

import { createSupplier } from '../../src/main/database/repositories/suppliers.repo'

import { createSale } from '../../src/main/database/repositories/sales.repo'

import { getVariantStock } from '../../src/main/database/repositories/inventory.repo'

import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo'

import {
  createPurchaseOrder,
  getPurchaseOrder,
  getSmartReorderSuggestions,
  receivePurchaseOrder,
} from '../../src/main/database/repositories/purchase-orders.repo'

function seedVariant(input: {
  name: string
  barcode: string
  openingQty: number
  minStock: number
  buyPrice?: number
  sellPrice?: number
}) {
  createProduct({
    name: input.name,

    category_id: null,

    image_path: null,

    description: null,

    variants: [
      {
        barcode: input.barcode,

        size: 'M',

        color: 'Black',

        buy_price: input.buyPrice ?? 100,

        sell_price: input.sellPrice ?? 150,

        min_stock: input.minStock,

        opening_qty: input.openingQty,
      },
    ],
  })

  const variant = getVariantByBarcode(input.barcode) as any

  if (!variant) {
    throw new Error('Failed to seed variant')
  }

  return variant
}

describe('purchase orders repository', () => {
  beforeEach(() => {
    closeDb()

    getDb()

    resetDatabaseData()

    openCashShift({
      opening_counted_amount: 0,

      opened_by: 1,
    })
  })

  it('builds smart reorder suggestions from stock and recent demand', () => {
    const mover = seedVariant({
      name: 'Fast Mover',

      barcode: 'PO-FAST',

      openingQty: 10,

      minStock: 2,
    })

    seedVariant({
      name: 'Low No Sales',

      barcode: 'PO-LOW',

      openingQty: 1,

      minStock: 5,
    })

    createSale({
      user_id: 1,

      sub_total: 900,

      discount_value: 0,

      grand_total: 900,

      paid: 900,

      change_amount: 0,

      payment_method: 'store_cash',

      items: [
        {
          variant_id: mover.variant_id,

          product_name: mover.product_name,

          barcode: mover.barcode,

          size: mover.size,

          color: mover.color,

          quantity: 6,

          unit_price: 150,
        },
      ],
    })

    const rows = getSmartReorderSuggestions({
      targetDays: 30,
    })

    const fast = rows.find((row) => row.variant_id === mover.variant_id)

    const low = rows.find((row) => row.barcode === 'PO-LOW')

    expect(fast).toBeTruthy()

    expect(fast?.current_stock).toBe(4)

    expect(fast?.sold_units_30d).toBe(6)

    expect(fast?.target_stock).toBe(8)

    expect(fast?.suggested_quantity).toBe(4)

    expect(low).toBeTruthy()

    expect(low?.suggested_quantity).toBe(4)

    expect(low?.reason).toBe('low')
  })

  it('converts purchase order into real purchase invoice and stock', () => {
    const supplier = createSupplier({
      name: 'PO Supplier',

      phone: '01055551111',
    }) as any

    const variant = seedVariant({
      name: 'PO Product',

      barcode: 'PO-RECEIVE',

      openingQty: 0,

      minStock: 2,

      buyPrice: 80,
    })

    const order = createPurchaseOrder({
      supplier_id: supplier.id,

      actor_id: 1,

      notes: 'Smart reorder',

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 5,

          unit_cost: 90,
        },
      ],
    })

    expect(order.status).toBe('draft')

    expect(getVariantStock(variant.variant_id)).toBe(0)

    const received = receivePurchaseOrder({
      purchase_order_id: order.purchase_order_id,

      actor_id: 1,

      paid_amount: 0,
    })

    expect(received.purchaseId).toBeGreaterThan(0)

    expect(received.total_amount).toBe(450)

    expect(getVariantStock(variant.variant_id)).toBe(5)

    const snapshot = getPurchaseOrder(order.purchase_order_id)

    expect(snapshot.order.status).toBe('received')

    expect(Number(snapshot.order.purchase_id)).toBe(received.purchaseId)

    const db = getDb()

    const supplierRow = db
      .prepare(
        `
            SELECT
              balance

            FROM suppliers

            WHERE id = ?
            `,
      )
      .get(supplier.id) as {
      balance: number
    }

    expect(Number(supplierRow.balance)).toBe(450)
  })

  it('stores purchase order costs as whole pounds', () => {
    const supplier = createSupplier({
      name: 'Rounded PO Supplier',
    }) as any

    const variant = seedVariant({
      name: 'Rounded PO Product',

      barcode: 'PO-ROUND-MONEY',

      openingQty: 0,

      minStock: 1,

      buyPrice: 80,
    })

    const order = createPurchaseOrder({
      supplier_id: supplier.id,

      actor_id: 1,

      items: [
        {
          variant_id: variant.variant_id,

          quantity: 2,

          unit_cost: 90.5,
        },
      ],
    })

    const snapshot = getPurchaseOrder(order.purchase_order_id) as any

    expect(snapshot.items[0].unit_cost).toBe(91)

    expect(snapshot.items[0].line_total).toBe(182)
  })
})
