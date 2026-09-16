import { EventEmitter } from 'node:events'

import { ipcMain, type IpcMainInvokeEvent } from 'electron'

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

import { createProduct } from '../../src/main/database/repositories/product.repo'

import {
  createStockCountSession,
  updateStockCountItem,
} from '../../src/main/database/repositories/stock-count.repo'

import {
  createUser,
  findUserByUsername,
} from '../../src/main/database/repositories/user.repo'

import { startAuthSession } from '../../src/main/auth-session'

import { registerStockCountIpc } from '../../src/main/ipc/stock-count.ipc'

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

describe('stock count cashier privacy', () => {
  beforeAll(() => {
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    registerStockCountIpc()
  })

  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()

    createProduct({
      name: 'Blind Count Product',

      category_id: null,

      image_path: null,
      description: null,

      variants: [
        {
          barcode: 'BLIND001',

          size: 'M',

          color: 'Black',

          buy_price: 50,

          sell_price: 100,

          min_stock: 1,

          opening_qty: 5,
        },
      ],
    })
  })

  afterAll(() => {
    vi.mocked(ipcMain.handle).mockReset()

    closeDb()
  })

  it('requires authentication for stock count reads', async () => {
    const { event } = makeClient()

    await expect(invoke(event, 'stock-count:list')).rejects.toThrow(
      'سجل الدخول أولًا',
    )
  })

  it('hides system stock and variances from cashiers', async () => {
    const session = createStockCountSession({
      title: 'Blind Count',

      actor_id: 1,
    })

    const db = getDb()

    const item = db
      .prepare(
        `
            SELECT id
            FROM stock_count_items
            WHERE session_id = ?
            LIMIT 1
            `,
      )
      .get(session.id) as {
      id: number
    }

    updateStockCountItem({
      session_id: session.id,

      item_id: item.id,

      actual_stock: 2,
    })

    const cashier = createUser(
      'Blind Count Cashier',

      'blind_count_cashier',

      '5678',

      'cashier',
    )

    const { event } = makeClient()

    startAuthSession(event, cashier.id)

    const details = await invoke(event, 'stock-count:get', session.id)

    expect(details.items).toHaveLength(1)

    expect('system_stock' in details.items[0]).toBe(false)

    expect('difference' in details.items[0]).toBe(false)

    expect('buy_difference_value' in details.items[0]).toBe(false)

    const sessions = await invoke(event, 'stock-count:list')

    expect('shortage_count' in sessions[0]).toBe(false)

    expect('surplus_count' in sessions[0]).toBe(false)

    expect('buy_difference_value' in sessions[0]).toBe(false)
  })

  it('keeps reconciliation details visible to admins', async () => {
    const session = createStockCountSession({
      title: 'Admin Count',

      actor_id: 1,
    })

    const db = getDb()

    const item = db
      .prepare(
        `
            SELECT id
            FROM stock_count_items
            WHERE session_id = ?
            LIMIT 1
            `,
      )
      .get(session.id) as {
      id: number
    }

    updateStockCountItem({
      session_id: session.id,

      item_id: item.id,

      actual_stock: 2,
    })

    const admin = findUserByUsername('admin')!

    const { event } = makeClient()

    startAuthSession(event, admin.id)

    const details = await invoke(event, 'stock-count:get', session.id)

    expect(Number(details.items[0].system_stock)).toBe(5)

    expect(Number(details.items[0].difference)).toBe(-3)

    const sessions = await invoke(event, 'stock-count:list')

    expect(Number(sessions[0].shortage_count)).toBe(1)
  })
})
