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

import {
  closeCashShift,
  openCashShift,
} from '../../src/main/database/repositories/cash-shifts.repo'

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

  it('blocks cashiers from seeing expected shift balances', async () => {
    const cashier = createUser(
      'Blind Cashier',
      'blind_cashier',
      '5678',
      'cashier',
    )

    const shift = openCashShift({
      opening_counted_amount: 100,

      opened_by: cashier.id,
    })

    const cashierClient = makeClient()

    startAuthSession(cashierClient.event, cashier.id)

    await expect(
      invoke(cashierClient.event, 'cash-shifts:preview', shift.id),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')

    await expect(
      invoke(cashierClient.event, 'cash-shifts:day-summary', {
        business_date: '2026-09-16',
      }),
    ).rejects.toThrow('هذه العملية متاحة لمدير النظام فقط')
  })

  it('redacts reconciliation targets from cashier shift responses', async () => {
    const admin = findUserByUsername('admin')!

    const previousShift = openCashShift({
      opening_counted_amount: 100,

      opened_by: admin.id,
    })

    closeCashShift({
      shift_id: previousShift.id,

      closing_counted_amount: 100,

      left_for_next_shift: 80,

      closed_by: admin.id,
    })

    const cashier = createUser(
      'Blind Reconciliation Cashier',
      'blind_reconciliation_cashier',
      '5678',
      'cashier',
    )

    const cashierClient = makeClient()

    startAuthSession(cashierClient.event, cashier.id)

    const preview = await invoke(
      cashierClient.event,
      'cash-shifts:opening-preview',
    )

    expect(preview.expected_opening_amount).toBeNull()

    expect(preview.previous_shift_id).toBeNull()

    const opened = await invoke(cashierClient.event, 'cash-shifts:open', {
      opening_counted_amount: 70,
    })

    expect('expected_opening_amount' in opened).toBe(false)

    expect('opening_difference' in opened).toBe(false)

    const current = await invoke(cashierClient.event, 'cash-shifts:get-open')

    expect(current.id).toBe(opened.id)

    expect('opening_difference' in current).toBe(false)

    const closed = await invoke(cashierClient.event, 'cash-shifts:close', {
      shift_id: opened.id,

      closing_counted_amount: 60,

      left_for_next_shift: 50,
    })

    expect(closed.status).toBe('closed')

    expect('expected_closing_amount' in closed).toBe(false)

    expect('closing_difference' in closed).toBe(false)
  })

  it('keeps reconciliation details available to admins', async () => {
    const admin = findUserByUsername('admin')!

    const shift = openCashShift({
      opening_counted_amount: 250,

      opened_by: admin.id,
    })

    const adminClient = makeClient()

    startAuthSession(adminClient.event, admin.id)

    const preview = await invoke(
      adminClient.event,
      'cash-shifts:preview',
      shift.id,
    )

    expect(preview.shift_id).toBe(shift.id)

    expect(preview.expected_closing_amount).toBe(250)
  })
})
