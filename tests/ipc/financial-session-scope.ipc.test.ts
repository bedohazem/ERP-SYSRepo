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

import { createCashMovement } from '../../src/main/database/repositories/cash.repo'

import { openCashShift } from '../../src/main/database/repositories/cash-shifts.repo'

import { startAuthSession } from '../../src/main/auth-session'

import { registerCashIpc } from '../../src/main/ipc/cash.ipc'

import { registerReportsIpc } from '../../src/main/ipc/reports.ipc'

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

describe('financial IPC session scope', () => {
  beforeAll(() => {
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    registerCashIpc()
    registerReportsIpc()
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

  it('requires authentication for cash and reports summaries', async () => {
    const { event } = makeClient()

    await expect(invoke(event, 'cash:summary', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    )

    await expect(invoke(event, 'reports:summary', {})).rejects.toThrow(
      'سجل الدخول أولًا',
    )
  })

  it('forces cashiers to their own cash summary', async () => {
    const admin = findUserByUsername('admin')!

    const cashier = createUser(
      'Scoped Cashier',
      'scoped_cashier',
      '5678',
      'cashier',
    )

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 100,
      payment_method: 'owner_bank',
      created_by: admin.id,
    })

    createCashMovement({
      type: 'sale',
      direction: 'in',
      amount: 40,
      payment_method: 'owner_bank',
      created_by: cashier.id,
    })

    const { event } = makeClient()

    startAuthSession(event, cashier.id)

    const result = await invoke(event, 'cash:summary', {
      /*
       * محاولة تزوير ID المدير.
       * الـIPC لازم يتجاهله.
       */
      created_by: admin.id,

      payment_method: 'owner_bank',
    })

    expect(Number(result.total_in)).toBe(40)

    expect(Number(result.balance)).toBe(40)
  })

  it('forces cashiers to their own reports', async () => {
    const db = getDb()

    const admin = findUserByUsername('admin')!

    const cashier = createUser(
      'Report Cashier',
      'report_cashier',
      '5678',
      'cashier',
    )

    const insertSale = db.prepare(
      `
            INSERT INTO sales (
              type,
              user_id,
              sub_total,
              discount_value,
              grand_total,
              paid,
              change_amount,
              payment_method
            )

            VALUES (
              'sale',
              ?,
              ?,
              0,
              ?,
              ?,
              0,
              'cash'
            )
            `,
    )

    insertSale.run(admin.id, 100, 100, 100)

    insertSale.run(cashier.id, 40, 40, 40)

    const { event } = makeClient()

    startAuthSession(event, cashier.id)

    const result = await invoke(event, 'reports:summary', {
      /*
       * محاولة قراءة تقرير المدير.
       */
      user_id: admin.id,
    })

    expect(Number(result.summary.sales_count)).toBe(1)

    expect(Number(result.summary.gross_sales)).toBe(40)
  })

  it('blocks cashiers from admin cash operations', async () => {
    const cashier = createUser(
      'Blocked Cashier',
      'blocked_cashier',
      '5678',
      'cashier',
    )

    const { event } = makeClient()

    startAuthSession(event, cashier.id)

    await expect(invoke(event, 'cash:list', {})).rejects.toThrow(
      'هذه العملية متاحة لمدير النظام فقط',
    )

    await expect(
      invoke(event, 'cash:create-movement', {
        type: 'deposit',

        amount: 100,

        payment_method: 'store_cash',
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    await expect(
      invoke(event, 'cash:transfer', {
        from_account: 'owner_cash',

        to_account: 'owner_bank',

        amount: 50,
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')
  })

  it('prevents a cashier from previewing another user shift', async () => {
    const admin = findUserByUsername('admin')!

    const cashier = createUser(
      'Preview Cashier',
      'preview_cashier',
      '5678',
      'cashier',
    )

    const shift = openCashShift({
      opening_counted_amount: 100,

      opened_by: admin.id,
    })

    const cashierClient = makeClient()

    startAuthSession(cashierClient.event, cashier.id)

    await expect(
      invoke(cashierClient.event, 'cash-shifts:preview', shift.id),
    ).rejects.toThrow('غير مصرح لك بعرض تفاصيل هذا الشفت')

    const adminClient = makeClient()

    startAuthSession(adminClient.event, admin.id)

    const preview = await invoke(
      adminClient.event,
      'cash-shifts:preview',
      shift.id,
    )

    expect(preview.shift_id).toBe(shift.id)
  })
})
