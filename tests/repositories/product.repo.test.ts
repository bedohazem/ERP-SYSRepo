import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  addProductVariant,
  createProduct,
  getProductVariants,
  getProducts,
  getVariantByBarcode,
  searchSaleVariants,
  updateProduct
} from '../../src/main/database/repositories/product.repo';

type ProductVariantTestRow = {
  id: number;
  product_id: number;
  barcode: string;
  size: string;
  color: string;
  buy_price: number;
  sell_price: number;
  min_stock: number;
  is_active: number;
  stock: number;
};

describe('product repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

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
          opening_qty: 10
        }
      ]
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBeGreaterThan(0);

    const products = getProducts('T-Shirt');
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('T-Shirt');
    expect(products[0].variants_count).toBe(1);
    expect(products[0].active_variants_count).toBe(1);

    const variants = getProductVariants(result.productId) as ProductVariantTestRow[];
    expect(variants).toHaveLength(1);
    expect(variants[0].barcode).toBe('TS001');
    expect(variants[0].stock).toBe(10);
  });

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
            opening_qty: 1
          }
        ]
      })
    ).toThrow('اسم المنتج مطلوب');
  });

  it('rejects product without variants', () => {
    expect(() =>
      createProduct({
        name: 'No Variants Product',
        category_id: null,
        variants: []
      })
    ).toThrow('لازم تضيف صنف واحد على الأقل');
  });

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
            opening_qty: 1
          }
        ]
      })
    ).toThrow('الباركود مطلوب');
  });

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
            opening_qty: 1
          },
          {
            barcode: 'DUP001',
            size: 'L',
            color: 'White',
            buy_price: 100,
            sell_price: 150,
            min_stock: 5,
            opening_qty: 1
          }
        ]
      })
    ).toThrow('مكرر في نفس المنتج');
  });

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
          opening_qty: 1
        }
      ]
    });

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
            opening_qty: 1
          }
        ]
      })
    ).toThrow('مستخدم بالفعل');
  });

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
            opening_qty: -1
          }
        ]
      })
    ).toThrow('كمية المخزون الافتتاحي غير صحيحة');
  });

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
            opening_qty: -10
          }
        ]
      })
    ).toThrow();

    const products = getProducts('Rollback Product', true);
    expect(products).toHaveLength(0);
  });

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
          opening_qty: 5
        }
      ]
    });

    const variant = addProductVariant({
      product_id: product.productId,
      barcode: 'MULTI002',
      size: 'L',
      color: 'White',
      buy_price: 110,
      sell_price: 170,
      min_stock: 4,
      opening_qty: 3
    });

    expect(variant.success).toBe(true);
    expect(variant.variantId).toBeGreaterThan(0);

    const variants = getProductVariants(product.productId) as ProductVariantTestRow[];
    expect(variants).toHaveLength(2);
    expect(variants[1].barcode).toBe('MULTI002');
    expect(variants[1].stock).toBe(3);
  });

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
          opening_qty: 7
        },
        {
          barcode: 'SEARCH002',
          size: 'L',
          color: 'Red',
          buy_price: 100,
          sell_price: 150,
          min_stock: 5,
          opening_qty: 0
        }
      ]
    });

    const results = searchSaleVariants('Searchable');

    expect(results).toHaveLength(1);
    expect(results[0].barcode).toBe('SEARCH001');
    expect(results[0].stock).toBe(7);
  });

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
          opening_qty: 4
        }
      ]
    });

    const variant = getVariantByBarcode('BAR001');

    expect(variant).toBeDefined();
    expect(variant?.barcode).toBe('BAR001');
    expect(variant?.stock).toBe(4);
  });

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
            opening_qty: 1
            }
        ]
        })
    ).toThrow();
  });

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
            opening_qty: 1
            }
        ]
        })
    ).toThrow();
  });

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
            opening_qty: 1
            }
        ]
        })
    ).toThrow();
  });

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
            opening_qty: 1
        }
        ]
    });

    expect(() =>
        updateProduct({
        id: product.productId,
        name: '   ',
        category_id: null,
        description: null,
        image_path: null
        })
    ).toThrow();
  });

});