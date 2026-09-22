import { EventEmitter } from 'node:events'

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { registerInventoryIpc } from '../../src/main/ipc/inventory.ipc'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  createProduct,
  getVariantByBarcode,
} from '../../src/main/database/repositories/product.repo'
import {
  createUser,
  findUserByUsername,
} from '../../src/main/database/repositories/user.repo'
import { registerActivityIpc } from '../../src/main/ipc/activity.ipc'
import { startAuthSession } from '../../src/main/auth-session'

import { registerCustomersIpc } from '../../src/main/ipc/customers.ipc'

import { registerSuppliersIpc } from '../../src/main/ipc/suppliers.ipc'

import { registerPurchasesIpc } from '../../src/main/ipc/purchases.ipc'

import { registerLiabilitiesIpc } from '../../src/main/ipc/liabilities.ipc'
import { registerSalesIpc } from '../../src/main/ipc/sales.ipc'
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => any

const handlers = new Map<string, Handler>()

function makeClient() {
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => false,
  })

  const event = {
    sender,
    senderFrame: sender.mainFrame,
  } as unknown as IpcMainInvokeEvent

  return {
    sender,
    event,
  }
}

async function invoke(
  event: IpcMainInvokeEvent,
  channel: string,
  ...args: any[]
) {
  const handler = handlers.get(channel)

  if (!handler) {
    throw new Error(`Missing handler: ${channel}`)
  }

  return handler(event, ...args)
}

describe('domain IPC session scope', () => {
  beforeAll(() => {
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    registerCustomersIpc()
    registerSuppliersIpc()
    registerPurchasesIpc()
    registerLiabilitiesIpc()
    registerInventoryIpc()
    registerActivityIpc()
    registerSalesIpc()
  })

  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  afterAll(() => {
    vi.mocked(ipcMain.handle).mockReset()

    closeDb()
  })

  it('requires login for customer reads', async () => {
    const { event } = makeClient()

    await expect(invoke(event, 'customers:list')).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'customers:list-page', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'customers:search', '')).rejects.toThrow(
      'سجل الدخول أولًا',
    )
  })

  it('allows cashiers to read customers', async () => {
    const cashier = createUser(
      'Customer Cashier',
      'customer_cashier',
      '5678',
      'cashier',
    )

    const { event } = makeClient()

    startAuthSession(event, cashier.id)

    const result = await invoke(event, 'customers:list-page', {})

    expect(Array.isArray(result.rows)).toBe(true)
  })

  it('blocks cashiers from admin-only domains', async () => {
    const cashier = createUser(
      'Blocked Domain Cashier',
      'blocked_domain_cashier',
      '5678',
      'cashier',
    )

    const { event } = makeClient()

    startAuthSession(event, cashier.id)

    await expect(invoke(event, 'suppliers:list', '')).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    await expect(invoke(event, 'purchases:list', {})).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    await expect(invoke(event, 'liabilities:list', {})).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )
    await expect(invoke(event, 'inventory:list-page', {})).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    await expect(invoke(event, 'inventory:movements', {})).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    await expect(
      invoke(event, 'inventory:adjust-stock', {
        variant_id: 1,
        target_stock: 10,
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    await expect(invoke(event, 'activity:list', {})).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )
  })

  it('allows admins to read admin-only domains', async () => {
    const admin = findUserByUsername('admin')!

    const { event } = makeClient()

    startAuthSession(event, admin.id)

    const suppliers = await invoke(event, 'suppliers:list', '')

    const purchases = await invoke(event, 'purchases:list', {})

    const liabilities = await invoke(event, 'liabilities:list', {})

    const inventory = await invoke(event, 'inventory:list-page', {})

    const activity = await invoke(event, 'activity:list', {})

    expect(Array.isArray(suppliers)).toBe(true)

    expect(Array.isArray(purchases.rows)).toBe(true)

    expect(Number.isFinite(Number(purchases.total))).toBe(true)

    expect(Array.isArray(liabilities)).toBe(true)

    expect(Array.isArray(inventory.rows)).toBe(true)

    expect(Number.isFinite(Number(inventory.total))).toBe(true)

    expect(Array.isArray(activity.rows)).toBe(true)

    expect(Number.isFinite(Number(activity.total))).toBe(true)
  })

  it('blocks cashier writes to supplier and purchase domains', async () => {
    const cashier = createUser(
      'Write Blocked Cashier',
      'write_blocked_cashier',
      '5678',
      'cashier',
    )

    const { event } = makeClient()

    startAuthSession(event, cashier.id)

    await expect(
      invoke(event, 'suppliers:create', {
        name: 'Unauthorized Supplier',
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    await expect(
      invoke(event, 'purchases:create', {
        supplier_id: 1,
        items: [],
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')
  })

  it('requires login for sales reads', async () => {
    const { event } = makeClient()

    await expect(
      invoke(event, 'sales:search-variants', 'shirt'),
    ).rejects.toThrow('سجل الدخول أولًا')

    await expect(
      invoke(event, 'sales:get-variant-by-barcode', '123'),
    ).rejects.toThrow('سجل الدخول أولًا')

    await expect(invoke(event, 'sales:list', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'sales:list-returns', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'sales:list-exchanges', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'sales:get-receipt', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'sales:current-state', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'sales:return-history', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'sales:exchange-state', 1)).rejects.toThrow(
      'سجل الدخول أولًا',
    )
  })

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
    })

    const variant = getVariantByBarcode('COST-SEC-001') as any

    expect(Number(variant.buy_price)).toBe(120)

    const cashier = createUser(
      'Cost Hidden Cashier',
      'cost_hidden_cashier',
      '5678',
      'cashier',
    )

    const cashierClient = makeClient()

    startAuthSession(cashierClient.event, cashier.id)

    const cashierSearch = await invoke(
      cashierClient.event,
      'sales:search-variants',
      'COST-SEC-001',
    )

    expect(Number(cashierSearch[0].buy_price)).toBe(0)

    const cashierBarcode = await invoke(
      cashierClient.event,
      'sales:get-variant-by-barcode',
      'COST-SEC-001',
    )

    expect(Number(cashierBarcode.buy_price)).toBe(0)

    /*
     * نثبت كمان إن تكلفة فاتورة محفوظة
     * لا تتسرب للكاشير.
     */
    const db = getDb()

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
      .run(cashier.id)

    const saleId = Number(saleResult.lastInsertRowid)

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
    )

    const cashierReceipt = await invoke(
      cashierClient.event,
      'sales:get-receipt',
      saleId,
    )

    expect(Number(cashierReceipt.items[0].unit_cost)).toBe(0)

    expect(Number(cashierReceipt.items[0].buy_price)).toBe(0)

    /*
     * الـAdmin يظل يرى التكلفة الحقيقية.
     */
    const admin = findUserByUsername('admin')!

    const adminClient = makeClient()

    startAuthSession(adminClient.event, admin.id)

    const adminSearch = await invoke(
      adminClient.event,
      'sales:search-variants',
      'COST-SEC-001',
    )

    expect(Number(adminSearch[0].buy_price)).toBe(120)

    const adminReceipt = await invoke(
      adminClient.event,
      'sales:get-receipt',
      saleId,
    )

    expect(Number(adminReceipt.items[0].unit_cost)).toBe(120)
  })
})
