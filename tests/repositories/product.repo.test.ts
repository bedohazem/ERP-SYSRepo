import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  addProductVariant,
  createProduct,
  getProductVariants,
  getProducts,
  getVariantByBarcode,
  listProductsPage,
  searchSaleVariants,
  updateProduct,
  createCategory,
  toggleProductActive,
  toggleVariantActive,
  updateVariant,
} from '../../src/main/database/repositories/product.repo'

type ProductVariantTestRow = {
  id: number
  product_id: number
  barcode: string
  size: string
  color: string
  buy_price: number
  sell_price: number
  discount_price: number | null
  min_stock: number
  is_active: number
  stock: number
}

describe('product repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('creates a product with one variant and opening stock', () => {
    const result = createProduct({
      name: 'T-Shirt',
      category_id: null,
      image_path: null,
      description: 'Basic shirt',
      variants: [
        {
          barcode: 'TS001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 10,
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.productId).toBeGreaterThan(0)

    const products = getProducts('T-Shirt')
    expect(products).toHaveLength(1)
    expect(products[0].name).toBe('T-Shirt')
    expect(products[0].variants_count).toBe(1)
    expect(products[0].active_variants_count).toBe(1)

    const variants = getProductVariants(
      result.productId,
    ) as ProductVariantTestRow[]
    expect(variants).toHaveLength(1)
    expect(variants[0].barcode).toBe('TS001')
    expect(variants[0].stock).toBe(10)
  })

  it('rejects empty product name', () => {
    expect(() =>
      createProduct({
        name: '   ',
        category_id: null,
        variants: [
          {
            barcode: 'EMPTY001',
            size: 'M',
            color: 'Black',
            buy_price: 100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: 1,
          },
        ],
      }),
    ).toThrow('اسم المنتج مطلوب')
  })

  it('rejects product without variants', () => {
    expect(() =>
      createProduct({
        name: 'No Variants Product',
        category_id: null,
        variants: [],
      }),
    ).toThrow('لازم تضيف صنف واحد على الأقل')
  })

  it('rejects empty barcode', () => {
    expect(() =>
      createProduct({
        name: 'Bad Barcode Product',
        category_id: null,
        variants: [
          {
            barcode: '   ',
            size: 'M',
            color: 'Black',
            buy_price: 100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: 1,
          },
        ],
      }),
    ).toThrow('الباركود مطلوب')
  })

  it('rejects duplicate barcode inside same product', () => {
    expect(() =>
      createProduct({
        name: 'Duplicate Barcode Product',
        category_id: null,
        variants: [
          {
            barcode: 'DUP001',
            size: 'M',
            color: 'Black',
            buy_price: 100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: 1,
          },
          {
            barcode: 'DUP001',
            size: 'L',
            color: 'White',
            buy_price: 100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: 1,
          },
        ],
      }),
    ).toThrow('مكرر في نفس المنتج')
  })

  it('rejects existing barcode in another product', () => {
    createProduct({
      name: 'First Product',
      category_id: null,
      variants: [
        {
          barcode: 'EXIST001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 1,
        },
      ],
    })

    expect(() =>
      createProduct({
        name: 'Second Product',
        category_id: null,
        variants: [
          {
            barcode: 'EXIST001',
            size: 'L',
            color: 'White',
            buy_price: 120,
            sell_price: 180,
            min_stock: 5,
            opening_qty: 1,
          },
        ],
      }),
    ).toThrow('مستخدم بالفعل')
  })

  it('rejects negative opening quantity', () => {
    expect(() =>
      createProduct({
        name: 'Negative Stock Product',
        category_id: null,
        variants: [
          {
            barcode: 'NEG001',
            size: 'M',
            color: 'Black',
            buy_price: 100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: -1,
          },
        ],
      }),
    ).toThrow('كمية المخزون الافتتاحي غير صحيحة')
  })

  it('rolls back product creation when opening stock is invalid', () => {
    expect(() =>
      createProduct({
        name: 'Rollback Product',
        category_id: null,
        variants: [
          {
            barcode: 'ROLL001',
            size: 'M',
            color: 'Black',
            buy_price: 100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: -10,
          },
        ],
      }),
    ).toThrow()

    const products = getProducts('Rollback Product', true)
    expect(products).toHaveLength(0)
  })

  it('adds a variant to an existing product', () => {
    const product = createProduct({
      name: 'Multi Variant Product',
      category_id: null,
      variants: [
        {
          barcode: 'MULTI001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 5,
        },
      ],
    })

    const variant = addProductVariant({
      product_id: product.productId,
      barcode: 'MULTI002',
      size: 'L',
      color: 'White',
      buy_price: 110,
      sell_price: 170,
      min_stock: 4,
      opening_qty: 3,
    })

    expect(variant.success).toBe(true)
    expect(variant.variantId).toBeGreaterThan(0)

    const variants = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]
    expect(variants).toHaveLength(2)
    expect(variants[1].barcode).toBe('MULTI002')
    expect(variants[1].stock).toBe(3)
  })

  it('searches sale variants only when stock is available', () => {
    createProduct({
      name: 'Searchable Product',
      category_id: null,
      variants: [
        {
          barcode: 'SEARCH001',
          size: 'M',
          color: 'Blue',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 7,
        },
        {
          barcode: 'SEARCH002',
          size: 'L',
          color: 'Red',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 0,
        },
      ],
    })

    const results = searchSaleVariants('Searchable')

    expect(results).toHaveLength(1)
    expect(results[0].barcode).toBe('SEARCH001')
    expect(results[0].stock).toBe(7)
  })

  it('gets variant by exact barcode', () => {
    createProduct({
      name: 'Barcode Product',
      category_id: null,
      variants: [
        {
          barcode: 'BAR001',
          size: 'M',
          color: 'Green',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 4,
        },
      ],
    })

    const variant = getVariantByBarcode('BAR001')

    expect(variant).toBeDefined()
    expect(variant?.barcode).toBe('BAR001')
    expect(variant?.stock).toBe(4)
  })

  it('rejects negative buy price', () => {
    expect(() =>
      createProduct({
        name: 'Negative Buy Price Product',
        category_id: null,
        variants: [
          {
            barcode: 'NEGBUY001',
            size: 'M',
            color: 'Black',
            buy_price: -100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: 1,
          },
        ],
      }),
    ).toThrow()
  })

  it('rejects negative sell price', () => {
    expect(() =>
      createProduct({
        name: 'Negative Sell Price Product',
        category_id: null,
        variants: [
          {
            barcode: 'NEGSELL001',
            size: 'M',
            color: 'Black',
            buy_price: 100,
            sell_price: -150,
            min_stock: 5,
            opening_qty: 1,
          },
        ],
      }),
    ).toThrow()
  })

  it('rejects negative minimum stock', () => {
    expect(() =>
      createProduct({
        name: 'Negative Min Stock Product',
        category_id: null,
        variants: [
          {
            barcode: 'NEGMIN001',
            size: 'M',
            color: 'Black',
            buy_price: 100,
            sell_price: 150,
            min_stock: -5,
            opening_qty: 1,
          },
        ],
      }),
    ).toThrow()
  })

  it('rejects updating product with empty name', () => {
    const product = createProduct({
      name: 'Valid Product',
      category_id: null,
      variants: [
        {
          barcode: 'UPD001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 1,
        },
      ],
    })

    expect(() =>
      updateProduct({
        id: product.productId,
        name: '   ',
        category_id: null,
        description: null,
        image_path: null,
      }),
    ).toThrow()
  })

  it('rolls back product and variant edits when one variant update fails', () => {
    const product = createProduct({
      name: 'Atomic Original Product',
      category_id: null,
      variants: [
        {
          barcode: 'ATOMIC-001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 2,
        },
        {
          barcode: 'ATOMIC-002',
          size: 'L',
          color: 'White',
          buy_price: 120,
          sell_price: 180,
          min_stock: 5,
          opening_qty: 3,
        },
      ],
    })

    createProduct({
      name: 'Atomic Other Product',
      category_id: null,
      variants: [
        {
          barcode: 'ATOMIC-DUPLICATE',
          size: 'XL',
          color: 'Blue',
          buy_price: 200,
          sell_price: 300,
          min_stock: 5,
          opening_qty: 1,
        },
      ],
    })

    const before = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(() =>
      updateProduct({
        id: product.productId,
        name: 'Atomic Changed Product',
        category_id: null,
        description: null,
        image_path: null,

        variants: [
          {
            id: before[0].id,
            barcode: 'ATOMIC-001-CHANGED',
            size: 'XXL',
            color: 'Green',
            buy_price: 999,
            sell_price: 1200,
            discount_price: null,
            min_stock: 9,
            is_active: 1,
          },
          {
            id: before[1].id,
            barcode: 'ATOMIC-DUPLICATE',
            size: before[1].size,
            color: before[1].color,
            buy_price: before[1].buy_price,
            sell_price: before[1].sell_price,
            discount_price: before[1].discount_price,
            min_stock: before[1].min_stock,
            is_active: 1,
          },
        ],
      }),
    ).toThrow('مستخدم بالفعل')

    expect(getProducts('Atomic Changed Product', true)).toHaveLength(0)

    const originalProduct = getProducts('Atomic Original Product', true)

    expect(originalProduct).toHaveLength(1)
    expect(originalProduct[0].name).toBe('Atomic Original Product')

    const after = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(after).toHaveLength(2)

    expect(after[0].barcode).toBe('ATOMIC-001')
    expect(after[0].size).toBe('M')
    expect(after[0].color).toBe('Black')
    expect(after[0].buy_price).toBe(100)
    expect(after[0].sell_price).toBe(150)
    expect(after[0].min_stock).toBe(5)
    expect(after[0].stock).toBe(2)

    expect(after[1].barcode).toBe('ATOMIC-002')
    expect(after[1].stock).toBe(3)
  })

  it('keeps stock and inventory value when disabling a variant', () => {
    const product = createProduct({
      name: 'Disable Variant Product',
      category_id: null,
      variants: [
        {
          barcode: 'DISABLE-VARIANT-001',
          size: 'M',
          color: 'Black',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 5,
        },
      ],
    })

    const before = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    const variantId = before[0].id

    const beforeCost = getDb()
      .prepare(
        `
        SELECT
          average_cost,
          inventory_value
        FROM product_variants
        WHERE id = ?
        `,
      )
      .get(variantId) as {
      average_cost: number
      inventory_value: number
    }

    toggleVariantActive(variantId, 0)

    const disabled = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(disabled[0].is_active).toBe(0)
    expect(disabled[0].stock).toBe(5)

    const afterCost = getDb()
      .prepare(
        `
        SELECT
          average_cost,
          inventory_value
        FROM product_variants
        WHERE id = ?
        `,
      )
      .get(variantId) as {
      average_cost: number
      inventory_value: number
    }

    expect(afterCost.average_cost).toBe(beforeCost.average_cost)
    expect(afterCost.inventory_value).toBe(beforeCost.inventory_value)

    const zeroMovements = getDb()
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM stock_movements
        WHERE variant_id = ?
          AND reference_type = 'deactivate_zero_stock'
        `,
      )
      .get(variantId) as { count: number }

    expect(zeroMovements.count).toBe(0)

    expect(searchSaleVariants('Disable Variant Product')).toHaveLength(0)

    toggleVariantActive(variantId, 1)

    const reactivated = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(reactivated[0].stock).toBe(5)
    expect(searchSaleVariants('Disable Variant Product')).toHaveLength(1)
  })

  it('keeps all variant stock when disabling a product', () => {
    const product = createProduct({
      name: 'Disable Whole Product',
      category_id: null,
      variants: [
        {
          barcode: 'DISABLE-PRODUCT-001',
          size: 'M',
          color: 'Black',
          buy_price: 50,
          sell_price: 100,
          min_stock: 2,
          opening_qty: 3,
        },
        {
          barcode: 'DISABLE-PRODUCT-002',
          size: 'L',
          color: 'White',
          buy_price: 80,
          sell_price: 140,
          min_stock: 2,
          opening_qty: 2,
        },
      ],
    })

    const before = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    toggleProductActive(product.productId, 0)

    const after = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(after).toHaveLength(2)

    expect(after.map((variant) => variant.stock)).toEqual(
      before.map((variant) => variant.stock),
    )

    expect(searchSaleVariants('Disable Whole Product')).toHaveLength(0)

    const zeroMovements = getDb()
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM stock_movements
        WHERE variant_id IN (?, ?)
          AND reference_type = 'deactivate_zero_stock'
        `,
      )
      .get(before[0].id, before[1].id) as { count: number }

    expect(zeroMovements.count).toBe(0)

    toggleProductActive(product.productId, 1)

    const reactivated = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(reactivated.map((variant) => variant.stock)).toEqual([3, 2])

    expect(searchSaleVariants('Disable Whole Product')).toHaveLength(2)
  })

  it('keeps stock when variant is disabled through updateVariant', () => {
    const product = createProduct({
      name: 'Update Disable Variant',
      category_id: null,
      variants: [
        {
          barcode: 'UPDATE-DISABLE-001',
          size: 'M',
          color: 'Blue',
          buy_price: 120,
          sell_price: 180,
          min_stock: 3,
          opening_qty: 4,
        },
      ],
    })

    const before = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    const variant = before[0]

    updateVariant({
      id: variant.id,
      barcode: variant.barcode,
      size: variant.size,
      color: variant.color,
      buy_price: variant.buy_price,
      sell_price: variant.sell_price,
      discount_price: variant.discount_price,
      min_stock: variant.min_stock,
      is_active: 0,
    })

    const after = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(after[0].is_active).toBe(0)
    expect(after[0].stock).toBe(4)

    const zeroMovements = getDb()
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM stock_movements
        WHERE variant_id = ?
          AND reference_type = 'deactivate_zero_stock'
        `,
      )
      .get(variant.id) as { count: number }

    expect(zeroMovements.count).toBe(0)
  })

  it('paginates products and returns the filtered total', () => {
    createProduct({
      name: 'Paged Product 1',
      category_id: null,
      variants: [
        {
          barcode: 'PAGE001',
          size: 'M',
          color: 'Black',
          buy_price: 10,
          sell_price: 20,
          min_stock: 1,
          opening_qty: 0,
        },
      ],
    })

    createProduct({
      name: 'Paged Product 2',
      category_id: null,
      variants: [
        {
          barcode: 'PAGE002',
          size: 'M',
          color: 'Black',
          buy_price: 10,
          sell_price: 20,
          min_stock: 1,
          opening_qty: 0,
        },
      ],
    })

    createProduct({
      name: 'Paged Product 3',
      category_id: null,
      variants: [
        {
          barcode: 'PAGE003',
          size: 'M',
          color: 'Black',
          buy_price: 10,
          sell_price: 20,
          min_stock: 1,
          opening_qty: 0,
        },
      ],
    })

    const firstPage = listProductsPage({
      search: 'Paged Product',
      limit: 2,
      offset: 0,
    })

    expect(firstPage.total).toBe(3)
    expect(firstPage.rows).toHaveLength(2)
    expect((firstPage.rows[0] as any).name).toBe('Paged Product 3')
    expect((firstPage.rows[1] as any).name).toBe('Paged Product 2')
    expect(firstPage.limit).toBe(2)
    expect(firstPage.offset).toBe(0)

    const secondPage = listProductsPage({
      search: 'Paged Product',
      limit: 2,
      offset: 2,
    })

    expect(secondPage.total).toBe(3)
    expect(secondPage.rows).toHaveLength(1)
    expect((secondPage.rows[0] as any).name).toBe('Paged Product 1')
    expect(secondPage.limit).toBe(2)
    expect(secondPage.offset).toBe(2)
  })

  it('uses discount price as the active sale price', () => {
    const product = createProduct({
      name: 'Discount Product',

      category_id: null,

      variants: [
        {
          barcode: 'DISCOUNT001',

          size: 'M',
          color: 'Black',

          buy_price: 300,

          sell_price: 900,

          discount_price: 500,

          min_stock: 5,

          opening_qty: 3,
        },
      ],
    })

    const variants = getProductVariants(
      product.productId,
    ) as ProductVariantTestRow[]

    expect(variants[0].sell_price).toBe(900)

    expect(variants[0].discount_price).toBe(500)

    const barcodeVariant = getVariantByBarcode('DISCOUNT001')

    expect(barcodeVariant?.original_sell_price).toBe(900)

    expect(barcodeVariant?.discount_price).toBe(500)

    expect(barcodeVariant?.sell_price).toBe(500)

    const search = searchSaleVariants('Discount Product')

    expect(search[0].sell_price).toBe(500)
  })

  it('filters products without category and returns the filtered total', () => {
    const category = createCategory({
      name: 'Categorized Products',
    })

    createProduct({
      name: 'Product With Category',

      category_id: category.id,

      variants: [
        {
          barcode: 'CAT-FILTER-001',

          size: 'M',
          color: 'Black',

          buy_price: 10,
          sell_price: 20,

          min_stock: 1,
          opening_qty: 0,
        },
      ],
    })

    createProduct({
      name: 'Product Without Category 1',

      category_id: null,

      variants: [
        {
          barcode: 'NO-CAT-001',

          size: 'M',
          color: 'Blue',

          buy_price: 10,
          sell_price: 20,

          min_stock: 1,
          opening_qty: 0,
        },
      ],
    })

    createProduct({
      name: 'Product Without Category 2',

      category_id: null,

      variants: [
        {
          barcode: 'NO-CAT-002',

          size: 'L',
          color: 'Red',

          buy_price: 10,
          sell_price: 20,

          min_stock: 1,
          opening_qty: 0,
        },
      ],
    })

    const result = listProductsPage({
      categoryId: 'uncategorized',

      limit: 50,
      offset: 0,
    })

    expect(result.total).toBe(2)

    expect(result.rows).toHaveLength(2)

    expect(result.rows.every((row: any) => row.category_id === null)).toBe(true)

    const categorized = listProductsPage({
      categoryId: category.id,

      limit: 50,
      offset: 0,
    })

    expect(categorized.total).toBe(1)

    expect((categorized.rows[0] as any).name).toBe('Product With Category')
  })

  it('rejects discount price equal to or above regular price', () => {
    expect(() =>
      createProduct({
        name: 'Bad Discount Product',

        category_id: null,

        variants: [
          {
            barcode: 'BAD-DISCOUNT',

            size: 'M',
            color: 'Black',

            buy_price: 300,

            sell_price: 900,

            discount_price: 900,

            min_stock: 5,

            opening_qty: 1,
          },
        ],
      }),
    ).toThrow('السعر بعد الخصم يجب أن يكون أقل من سعر البيع الأصلي')
  })
})
