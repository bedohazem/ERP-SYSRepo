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

import {
  createUser,
  findUserByUsername,
} from '../../src/main/database/repositories/user.repo'

import { startAuthSession } from '../../src/main/auth-session'

import { registerCustomersIpc } from '../../src/main/ipc/customers.ipc'

import { registerSuppliersIpc } from '../../src/main/ipc/suppliers.ipc'

import { registerPurchasesIpc } from '../../src/main/ipc/purchases.ipc'

import { registerLiabilitiesIpc } from '../../src/main/ipc/liabilities.ipc'

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
  })

  it('allows admins to read admin-only domains', async () => {
    const admin = findUserByUsername('admin')!

    const { event } = makeClient()

    startAuthSession(event, admin.id)

    const suppliers = await invoke(event, 'suppliers:list', '')

    const purchases = await invoke(event, 'purchases:list', {})

    const liabilities = await invoke(event, 'liabilities:list', {})

    expect(Array.isArray(suppliers)).toBe(true)

    expect(Array.isArray(purchases.rows)).toBe(true)

    expect(Number.isFinite(Number(purchases.total))).toBe(true)

    expect(Array.isArray(liabilities)).toBe(true)
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
})
