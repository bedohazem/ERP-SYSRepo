import { EventEmitter } from 'node:events';

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { registerInventoryIpc } from '../../src/main/ipc/inventory.ipc';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { registerProductsIpc } from '../../src/main/ipc/products.ipc';
import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo';

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo';
import {
  createUser,
  findUserByUsername,
  getEffectiveUserPermissions,
  setUserPermissions,
} from '../../src/main/database/repositories/user.repo';
import { registerActivityIpc } from '../../src/main/ipc/activity.ipc';
import { startAuthSession } from '../../src/main/auth-session';

import { registerCustomersIpc } from '../../src/main/ipc/customers.ipc';

import { registerSuppliersIpc } from '../../src/main/ipc/suppliers.ipc';

import { registerPurchasesIpc } from '../../src/main/ipc/purchases.ipc';

import { registerLiabilitiesIpc } from '../../src/main/ipc/liabilities.ipc';
import { registerSalesIpc } from '../../src/main/ipc/sales.ipc';
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

const handlers = new Map<string, Handler>();

function makeClient() {
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => false,
  });

  const event = {
    sender,
    senderFrame: sender.mainFrame,
  } as unknown as IpcMainInvokeEvent;

  return {
    sender,
    event,
  };
}

async function invoke(
  event: IpcMainInvokeEvent,
  channel: string,
  ...args: any[]
) {
  const handler = handlers.get(channel);

  if (!handler) {
    throw new Error(`Missing handler: ${channel}`);
  }

  return handler(event, ...args);
}

describe('domain IPC session scope', () => {
  beforeAll(() => {
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    registerCustomersIpc();
    registerSuppliersIpc();
    registerPurchasesIpc();
    registerProductsIpc();
    registerLiabilitiesIpc();
    registerInventoryIpc();
    registerActivityIpc();
    registerSalesIpc();
  });

  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  afterAll(() => {
    vi.mocked(ipcMain.handle).mockReset();

    closeDb();
  });

  it('requires login for customer reads', async () => {
    const { event } = makeClient();

    await expect(invoke(event, 'customers:list')).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'customers:list-page', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'customers:search', '')).rejects.toThrow(
      'سجل الدخول أولًا',
    );
  });

  it('allows cashiers to read customers', async () => {
    const cashier = createUser(
      'Customer Cashier',
      'customer_cashier',
      '5678',
      'cashier',
    );

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    const result = await invoke(event, 'customers:list-page', {});

    expect(Array.isArray(result.rows)).toBe(true);
  });

  it('blocks cashiers from domains without the required permissions', async () => {
    const cashier = createUser(
      'Blocked Domain Cashier',
      'blocked_domain_cashier',
      '5678',
      'cashier',
    );

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    await expect(invoke(event, 'suppliers:list', '')).rejects.toThrow(
      'غير مصرح لك بتنفيذ هذه العملية',
    );

    await expect(invoke(event, 'purchases:list', {})).rejects.toThrow(
      'غير مصرح لك بتنفيذ هذه العملية',
    );

    await expect(invoke(event, 'liabilities:list', {})).rejects.toThrow(
      'غير مصرح لك بتنفيذ هذه العملية',
    );

    await expect(invoke(event, 'inventory:list-page', {})).rejects.toThrow(
      'غير مصرح لك بتنفيذ هذه العملية',
    );

    await expect(invoke(event, 'inventory:movements', {})).rejects.toThrow(
      'غير مصرح لك بتنفيذ هذه العملية',
    );

    await expect(
      invoke(event, 'inventory:adjust-stock', {
        variant_id: 1,
        target_stock: 10,
      }),
    ).rejects.toThrow('غير مصرح لك بتنفيذ هذه العملية');

    await expect(invoke(event, 'activity:list', {})).rejects.toThrow(
      'غير مصرح لك بتنفيذ هذه العملية',
    );
  });

  it('allows admins to read admin-only domains', async () => {
    const admin = findUserByUsername('admin')!;

    const { event } = makeClient();

    startAuthSession(event, admin.id);

    const suppliers = await invoke(event, 'suppliers:list', '');

    const purchases = await invoke(event, 'purchases:list', {});

    const liabilities = await invoke(event, 'liabilities:list', {});

    const inventory = await invoke(event, 'inventory:list-page', {});

    const activity = await invoke(event, 'activity:list', {});

    expect(Array.isArray(suppliers)).toBe(true);

    expect(Array.isArray(purchases.rows)).toBe(true);

    expect(Number.isFinite(Number(purchases.total))).toBe(true);

    expect(Array.isArray(liabilities)).toBe(true);

    expect(Array.isArray(inventory.rows)).toBe(true);

    expect(Number.isFinite(Number(inventory.total))).toBe(true);

    expect(Array.isArray(activity.rows)).toBe(true);

    expect(Number.isFinite(Number(activity.total))).toBe(true);
  });

  it('blocks cashier writes without the required domain permissions', async () => {
    const cashier = createUser(
      'Write Blocked Cashier',
      'write_blocked_cashier',
      '5678',
      'cashier',
    );

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    await expect(
      invoke(event, 'suppliers:create', {
        name: 'Unauthorized Supplier',
      }),
    ).rejects.toThrow('غير مصرح لك بتنفيذ هذه العملية');

    await expect(
      invoke(event, 'purchases:create', {
        supplier_id: 1,
        items: [],
      }),
    ).rejects.toThrow('غير مصرح لك بتنفيذ هذه العملية');

    /*
     * عمليات التصحيح الحساسة
     * تظل True Admin Only.
     */
    await expect(
      invoke(event, 'purchases:update', {
        purchase_id: 1,
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط');

    await expect(
      invoke(event, 'purchases:returns:update', {
        return_id: 1,
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط');

    await expect(
      invoke(event, 'purchases:returns:cancel', {
        return_id: 1,
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط');
  });

  it('requires login for sales reads', async () => {
    const { event } = makeClient();

    await expect(
      invoke(event, 'sales:search-variants', 'shirt'),
    ).rejects.toThrow('سجل الدخول أولًا');

    await expect(
      invoke(event, 'sales:get-variant-by-barcode', '123'),
    ).rejects.toThrow('سجل الدخول أولًا');

    await expect(invoke(event, 'sales:list', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'sales:list-returns', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'sales:list-exchanges', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'sales:get-receipt', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'sales:current-state', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'sales:return-history', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'sales:exchange-state', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    );
  });

  it('requires login for held sales operations', async () => {
    const { event } = makeClient();

    await expect(
      invoke(event, 'sales:hold', {
        items: [
          {
            variant_id: 1,
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow('سجل الدخول أولًا');

    await expect(invoke(event, 'sales:list-held')).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(invoke(event, 'sales:get-held', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    );

    await expect(
      invoke(event, 'sales:delete-held', {
        held_sale_id: 1,
        mode: 'discarded',
      }),
    ).rejects.toThrow('سجل الدخول أولًا');
  });

  it('rejects malformed sales payloads before repository coercion', async () => {
    const admin = findUserByUsername('admin')!;

    const { event } = makeClient();

    startAuthSession(event, admin.id);

    await expect(
      invoke(event, 'sales:create', {
        payment_method: 'unknown_method',

        items: [
          {
            variant_id: 1,

            product_name: 'Invalid Sale Item',

            quantity: 1,

            unit_price: 10,
          },
        ],
      }),
    ).rejects.toThrow('طريقة دفع فاتورة البيع غير صحيح');

    /*
     * Number(true) = 1
     * فلا نسمح للـBoolean
     * أن يتحول إلى كمية بيع.
     */
    await expect(
      invoke(event, 'sales:create', {
        payment_method: 'cash',

        items: [
          {
            variant_id: 1,

            product_name: 'Invalid Quantity',

            quantity: true,

            unit_price: 10,
          },
        ],
      }),
    ).rejects.toThrow('كمية صنف البيع غير صحيح');

    await expect(
      invoke(event, 'sales:hold', {
        items: [
          {
            variant_id: true,

            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow('رقم صنف الفاتورة المعلقة غير صحيح');

    await expect(
      invoke(event, 'sales:delete-held', {
        held_sale_id: 1,

        mode: 'invalid-mode',
      }),
    ).rejects.toThrow('وضع حذف الفاتورة المعلقة غير صحيح');

    await expect(invoke(event, 'sales:get-receipt', true)).rejects.toThrow(
      'رقم فاتورة البيع غير صحيح',
    );
  });

  it('rejects malformed return and exchange payloads before repository coercion', async () => {
    const admin = findUserByUsername('admin')!;

    const { event } = makeClient();

    startAuthSession(event, admin.id);

    /*
     * Number(true) = 1
     * فلا نقبل Boolean كرقم فاتورة.
     */
    await expect(
      invoke(event, 'sales:return', {
        original_sale_id: true,

        refund_payment_method: 'cash',

        items: [
          {
            sale_item_id: 1,

            variant_id: 1,

            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow('رقم الفاتورة الأصلية غير صحيح');

    /*
     * طريقة رد مجهولة لا تتحول
     * بصمت إلى store_cash.
     */
    await expect(
      invoke(event, 'sales:return', {
        original_sale_id: 1,

        refund_payment_method: 'fake_refund_account',

        items: [
          {
            sale_item_id: 1,

            variant_id: 1,

            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow('طريقة رد قيمة المرتجع غير صحيح');

    /*
     * Number(true) = 1
     * كذلك في وحدات الاستبدال.
     */
    await expect(
      invoke(event, 'sales:exchange', {
        original_sale_id: 1,

        payment_method: 'cash',

        items: [
          {
            promotion_unit_id: true,

            new_variant_id: 1,
          },
        ],
      }),
    ).rejects.toThrow('رقم قطعة الاستبدال غير صحيح');

    await expect(
      invoke(event, 'sales:exchange', {
        original_sale_id: 1,

        payment_method: 'fake_exchange_account',

        items: [
          {
            promotion_unit_id: 1,

            new_variant_id: 1,
          },
        ],
      }),
    ).rejects.toThrow('طريقة دفع فرق الاستبدال غير صحيح');
  });

  it('rejects malformed customer and liability payloads before repository coercion', async () => {
    const admin = findUserByUsername('admin')!;

    const { event } = makeClient();

    startAuthSession(event, admin.id);

    await expect(invoke(event, 'customers:get-by-id', true)).rejects.toThrow(
      'رقم العميل غير صحيح',
    );

    await expect(
      invoke(event, 'customers:create', {
        name: true,
      }),
    ).rejects.toThrow('اسم العميل');

    await expect(
      invoke(event, 'customers:record-payment', {
        customer_id: 1,
        amount: true,
        payment_method: 'cash',
      }),
    ).rejects.toThrow('مبلغ دفعة العميل غير صحيح');

    await expect(
      invoke(event, 'customers:adjust-points', {
        customer_id: 1,
        points: 1.5,
      }),
    ).rejects.toThrow('عدد النقاط غير صحيح');

    await expect(
      invoke(event, 'liabilities:create', {
        party_name: 'Test Party',

        title: 'Test Liability',

        total_amount: true,
      }),
    ).resolves.toMatchObject({
      success: false,
    });

    await expect(invoke(event, 'liabilities:statement', true)).rejects.toThrow(
      'رقم الالتزام غير صحيح',
    );
  });

  it('rejects malformed purchase order and product payloads before repository coercion', async () => {
    const admin = findUserByUsername('admin')!;

    const { event } = makeClient();

    startAuthSession(event, admin.id);

    await expect(
      invoke(event, 'purchases:create', {
        supplier_id: true,

        payment_method: 'cash',

        items: [
          {
            variant_id: 1,

            quantity: 1,

            unit_cost: 10,
          },
        ],
      }),
    ).rejects.toThrow('رقم المورد غير صحيح');

    await expect(
      invoke(event, 'purchases:create', {
        supplier_id: 1,

        payment_method: 'fake_account',

        items: [
          {
            variant_id: 1,

            quantity: 1,

            unit_cost: 10,
          },
        ],
      }),
    ).rejects.toThrow('طريقة دفع فاتورة الشراء غير صحيح');

    await expect(
      invoke(event, 'purchases:orders:create', {
        supplier_id: 1,

        items: [
          {
            variant_id: 1,

            quantity: true,

            unit_cost: 10,
          },
        ],
      }),
    ).rejects.toThrow('كمية أمر الشراء غير صحيح');

    const badProduct = await invoke(event, 'products:create', {
      name: 'Invalid Product',

      category_id: null,

      variants: [
        {
          barcode: 'INVALID-RUNTIME',

          size: 'M',

          color: 'Black',

          buy_price: true,

          sell_price: 20,

          min_stock: 0,

          opening_qty: 0,
        },
      ],
    });

    expect(badProduct).toMatchObject({
      success: false,
    });

    const badToggle = await invoke(event, 'products:toggle-active', true, 1);

    expect(badToggle).toMatchObject({
      success: false,
    });

    await expect(
      invoke(event, 'products:get-categories', {
        includeInactive: 'yes',
      }),
    ).rejects.toThrow('إظهار التصنيفات المعطلة غير صحيحة');

    await expect(
      invoke(event, 'products:list', {
        categoryId: true,
      }),
    ).rejects.toThrow('رقم التصنيف غير صحيح');

    await expect(
      invoke(event, 'products:list-page', {
        offset: true,
      }),
    ).rejects.toThrow('بداية النتائج غير صحيح');

    await expect(
      invoke(event, 'purchases:orders:list', {
        status: 'fake-status',
      }),
    ).rejects.toThrow('حالة أمر الشراء غير صحيح');
  });

  it('hides product cost from cashier sales reads but keeps it for admins', async () => {
    createProduct({
      name: 'Cost Protected Product',
      category_id: null,
      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'COST-SEC-001',

          size: 'M',
          color: 'Black',

          buy_price: 120,
          sell_price: 200,

          min_stock: 2,
          opening_qty: 5,
        },
      ],
    });

    const variant = getVariantByBarcode('COST-SEC-001') as any;

    expect(Number(variant.buy_price)).toBe(120);

    const cashier = createUser(
      'Cost Hidden Cashier',
      'cost_hidden_cashier',
      '5678',
      'cashier',
    );

    const cashierClient = makeClient();

    startAuthSession(cashierClient.event, cashier.id);

    const cashierSearch = await invoke(
      cashierClient.event,
      'sales:search-variants',
      'COST-SEC-001',
    );

    expect(Number(cashierSearch[0].buy_price)).toBe(0);

    const cashierBarcode = await invoke(
      cashierClient.event,
      'sales:get-variant-by-barcode',
      'COST-SEC-001',
    );

    expect(Number(cashierBarcode.buy_price)).toBe(0);

    /*
     * نثبت كمان إن تكلفة فاتورة محفوظة
     * لا تتسرب للكاشير.
     */
    const db = getDb();

    const saleResult = db
      .prepare(
        `
      INSERT INTO sales (
        type,
        user_id,
        sub_total,
        grand_total,
        paid,
        change_amount,
        payment_method
      )

      VALUES (
        'sale',
        ?,
        200,
        200,
        200,
        0,
        'store_cash'
      )
      `,
      )
      .run(cashier.id);

    const saleId = Number(saleResult.lastInsertRowid);

    db.prepare(
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

    VALUES (
      ?, ?, ?, ?, ?, ?,
      1, 120, 200, 200
    )
    `,
    ).run(
      saleId,
      variant.variant_id,
      variant.product_name,
      variant.barcode,
      variant.size,
      variant.color,
    );

    const cashierReceipt = await invoke(
      cashierClient.event,
      'sales:get-receipt',
      saleId,
    );

    expect(Number(cashierReceipt.items[0].unit_cost)).toBe(0);

    expect(Number(cashierReceipt.items[0].buy_price)).toBe(0);

    const costCashier = createUser(
      'Cost Permission Cashier',
      'cost_permission_cashier',
      '5678',
      'cashier',
    );

    setUserPermissions(costCashier.id, [
      ...getEffectiveUserPermissions(costCashier.id),

      'costs.view',
    ]);

    const costClient = makeClient();

    startAuthSession(costClient.event, costCashier.id);

    const allowedCostSearch = await invoke(
      costClient.event,
      'sales:search-variants',
      'COST-SEC-001',
    );

    expect(Number(allowedCostSearch[0].buy_price)).toBe(120);

    /*
     * الـAdmin يظل يرى التكلفة الحقيقية.
     */
    const admin = findUserByUsername('admin')!;

    const adminClient = makeClient();

    startAuthSession(adminClient.event, admin.id);

    const adminSearch = await invoke(
      adminClient.event,
      'sales:search-variants',
      'COST-SEC-001',
    );

    expect(Number(adminSearch[0].buy_price)).toBe(120);

    const adminReceipt = await invoke(
      adminClient.event,
      'sales:get-receipt',
      saleId,
    );

    expect(Number(adminReceipt.items[0].unit_cost)).toBe(120);
  });

  it('grants admin-domain reads only when the cashier has the explicit custom permission', async () => {
    const cashier = createUser(
      'Custom Permission Cashier',
      'custom_permission_cashier',
      '5678',
      'cashier',
    );

    const current = getEffectiveUserPermissions(cashier.id);

    /*
     * نمنحه عرض المخزون فقط.
     * بدون costs.view.
     */
    setUserPermissions(cashier.id, [...current, 'inventory.view']);

    createProduct({
      name: 'Protected Inventory Cost',

      category_id: null,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'INVENTORY-COST-HIDDEN',

          size: 'M',

          color: 'Black',

          buy_price: 120,

          sell_price: 200,

          min_stock: 1,

          opening_qty: 5,
        },
      ],
    });

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    /*
     * يقدر يشوف المخزون،
     * لكن لا يرى التكلفة.
     */
    const inventory = await invoke(event, 'inventory:list-page', {});

    expect(Array.isArray(inventory.rows)).toBe(true);

    const protectedRow = inventory.rows.find(
      (row: any) => row.barcode === 'INVENTORY-COST-HIDDEN',
    );

    expect(protectedRow).toBeTruthy();

    expect(Number(protectedRow.buy_price)).toBe(0);

    expect(Number(protectedRow.average_cost)).toBe(0);

    expect(Number(inventory.summary.totalBuyValue)).toBe(0);

    const analytics = await invoke(event, 'inventory:analytics', {});

    expect(Number(analytics.dead_stock_value_90d)).toBe(0);

    expect(Number(analytics.potential_gross_profit)).toBe(0);

    /*
     * View لا تعني Adjust.
     */
    await expect(
      invoke(event, 'inventory:adjust-stock', {
        variant_id: 1,
        target_stock: 10,
      }),
    ).rejects.toThrow('غير مصرح لك بتنفيذ هذه العملية');

    /*
     * بعدها نمنحه إدارة المشتريات.
     *
     * purchases.manage تعتمد
     * تلقائيًا على costs.view.
     */
    setUserPermissions(cashier.id, [
      ...getEffectiveUserPermissions(cashier.id),

      'purchases.manage',
    ]);

    expect(getEffectiveUserPermissions(cashier.id)).toContain('costs.view');

    const purchases = await invoke(event, 'purchases:list', {});

    expect(Array.isArray(purchases.rows)).toBe(true);

    /*
     * وبعد منح costs.view
     * يرى تكلفة المخزون الحقيقية.
     */
    const inventoryWithCosts = await invoke(event, 'inventory:list-page', {});

    const visibleCostRow = inventoryWithCosts.rows.find(
      (row: any) => row.barcode === 'INVENTORY-COST-HIDDEN',
    );

    expect(Number(visibleCostRow.buy_price)).toBe(120);

    expect(Number(visibleCostRow.average_cost)).toBe(120);
  });

  it('revokes an operational permission from a cashier immediately', async () => {
    const cashier = createUser(
      'Restricted Sales Cashier',
      'restricted_sales_cashier',
      '5678',
      'cashier',
    );

    const permissions = getEffectiveUserPermissions(cashier.id).filter(
      (permission) => permission !== 'sales.use',
    );

    setUserPermissions(cashier.id, permissions);

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    await expect(
      invoke(event, 'sales:create', {
        items: [],
      }),
    ).rejects.toThrow('غير مصرح لك بتنفيذ هذه العملية');
  });

  it('requires real admin approval to override a customer credit limit', async () => {
    const db = getDb();

    const cashier = createUser(
      'Credit Cashier',
      'credit_cashier',
      '5678',
      'cashier',
    );

    const approver = createUser(
      'Credit Approver',
      'credit_approver',
      'Admin1234',
      'admin',
    );

    openCashShift({
      opening_counted_amount: 0,

      opened_by: cashier.id,
    });

    createProduct({
      name: 'Credit Product',

      category_id: null,

      image_path: null,

      description: null,

      variants: [
        {
          barcode: 'CREDIT-LIMIT-001',

          size: 'M',

          color: 'Black',

          buy_price: 50,

          sell_price: 150,

          min_stock: 1,

          opening_qty: 5,
        },
      ],
    });

    const variant = getVariantByBarcode('CREDIT-LIMIT-001') as any;

    const customerResult = db
      .prepare(
        `
        INSERT INTO customers (
          name,

          phone,

          credit_limit,

          balance
        )

        VALUES (
          'Credit IPC Customer',

          '01088881111',

          100,

          0
        )
        `,
      )
      .run();

    const customerId = Number(customerResult.lastInsertRowid);

    const payload = {
      customer_id: customerId,

      promotion_ids: [],

      sub_total: 150,

      discount_value: 0,

      grand_total: 150,

      paid: 0,

      remaining_amount: 150,

      payment_status: 'unpaid',

      change_amount: 0,

      payment_method: 'cash',

      items: [
        {
          variant_id: variant.variant_id,

          product_name: variant.product_name,

          barcode: variant.barcode,

          size: variant.size,

          color: variant.color,

          quantity: 1,

          unit_price: 150,
        },
      ],
    };

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    const blocked = await invoke(
      event,

      'sales:create',

      payload,
    );

    expect(blocked.success).toBe(false);

    expect(blocked.code).toBe('CREDIT_LIMIT_EXCEEDED');

    expect(blocked.credit).toEqual({
      customer_id: customerId,

      credit_limit: 100,

      current_debt: 0,

      additional_debt: 150,

      projected_debt: 150,

      excess_amount: 50,
    });

    expect(
      (
        db
          .prepare(
            `
          SELECT COUNT(*)
            AS count

          FROM sales
          `,
          )
          .get() as {
          count: number;
        }
      ).count,
    ).toBe(0);

    await expect(
      invoke(
        event,

        'sales:create',

        {
          ...payload,

          credit_limit_override_requested: true,

          admin_username: 'credit_approver',

          admin_password: 'wrong-password',
        },
      ),
    ).rejects.toThrow('بيانات اعتماد المدير غير صحيحة');

    const approved = await invoke(
      event,

      'sales:create',

      {
        ...payload,

        credit_limit_override_requested: true,

        admin_username: 'credit_approver',

        admin_password: 'Admin1234',
      },
    );

    expect(approved.success).toBe(true);

    expect(Number(approved.credit_limit_override_approved_by)).toBe(
      approver.id,
    );

    const savedSale = db
      .prepare(
        `
        SELECT
          credit_limit_at_sale,

          customer_balance_before,

          credit_limit_override_approved_by

        FROM sales

        WHERE id = ?
        `,
      )
      .get(approved.saleId) as any;

    expect(Number(savedSale.credit_limit_at_sale)).toBe(100);

    expect(Number(savedSale.customer_balance_before)).toBe(0);

    expect(Number(savedSale.credit_limit_override_approved_by)).toBe(
      approver.id,
    );
  });

  it('returns stock movements instead of inventory rows', async () => {
    createProduct({
      name: 'Movement Product',

      category_id: null,
      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'MOVEMENT-001',

          size: 'M',
          color: 'Black',

          buy_price: 50,
          sell_price: 100,

          min_stock: 1,

          opening_qty: 3,
        },
      ],
    });

    const variant = getVariantByBarcode('MOVEMENT-001') as any;

    const cashier = createUser(
      'Movement Viewer',
      'movement_viewer',
      '5678',
      'cashier',
    );

    setUserPermissions(cashier.id, [
      ...getEffectiveUserPermissions(cashier.id),

      'inventory.view',
    ]);

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    const result = await invoke(
      event,

      'inventory:movements',

      {
        variant_id: variant.variant_id,
      },
    );

    expect(Array.isArray(result.rows)).toBe(true);

    expect(result.rows.length).toBeGreaterThan(0);

    expect(result.rows[0]).toHaveProperty('signed_quantity');

    expect(
      result.rows.some(
        (row: any) =>
          Number(row.variant_id) === Number(variant.variant_id) &&
          row.reference_type === 'opening_stock',
      ),
    ).toBe(true);
  });

  it('lets purchase managers use supplier and inventory lookup without granting supplier or inventory management', async () => {
    const cashier = createUser(
      'Purchase Manager',
      'purchase_manager',
      '5678',
      'cashier',
    );

    setUserPermissions(cashier.id, [
      ...getEffectiveUserPermissions(cashier.id),

      'purchases.manage',
    ]);

    const { event } = makeClient();

    startAuthSession(event, cashier.id);

    const suppliers = await invoke(event, 'suppliers:list-page', {});

    expect(Array.isArray(suppliers.rows)).toBe(true);

    const inventory = await invoke(event, 'inventory:list-page', {});

    expect(Array.isArray(inventory.rows)).toBe(true);

    await expect(
      invoke(event, 'suppliers:create', {
        name: 'Forbidden Supplier',
      }),
    ).rejects.toThrow('غير مصرح لك بتنفيذ هذه العملية');

    await expect(
      invoke(event, 'inventory:adjust-stock', {
        variant_id: 1,

        target_stock: 1,
      }),
    ).rejects.toThrow('غير مصرح لك بتنفيذ هذه العملية');
  });
});
