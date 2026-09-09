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
  resetUserPassword,
  setUserActive,
  updateUser,
} from '../../src/main/database/repositories/user.repo'
import { registerAuthIpc } from '../../src/main/ipc/auth.ipc'
import {
  isPasswordHashed,
  verifyPassword,
} from '../../src/main/security/password'

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

  return { sender, event }
}

async function invoke(
  event: IpcMainInvokeEvent,
  channel: string,
  ...args: any[]
) {
  const handler = handlers.get(channel)

  if (!handler) {
    throw new Error('Missing handler: ' + channel)
  }

  return handler(event, ...args)
}

async function login(
  event: IpcMainInvokeEvent,
  username = 'admin',
  password = '1234',
) {
  const result = await invoke(event, 'auth:login', {
    username,
    password,
  })

  expect(result.success).toBe(true)
  expect(result.user.password).toBeUndefined()

  return result.user
}

describe('auth IPC authorization', () => {
  beforeAll(() => {
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler)
    })

    registerAuthIpc()
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

  it('does not expose public registration', () => {
    expect(handlers.has('auth:register')).toBe(false)
  })

  it.each(['anonymous', 'cashier'])(
    'rejects forged admin IDs from %s without changing users',
    async (kind) => {
      const { event } = makeClient()
      const admin = findUserByUsername('admin')!
      const cashier = createUser('Cashier', 'cashier_test', '5678', 'cashier')

      if (kind === 'cashier') {
        await login(event, cashier.username, '5678')
      }

      const before = getDb().prepare('SELECT * FROM users ORDER BY id').all()

      const attempts: Array<[string, ...any[]]> = [
        ['users:list', { actor_id: admin.id }],
        ['users:list-page', { actor_id: admin.id }],
        [
          'users:create',
          {
            name: 'Unauthorized',
            username: 'unauthorized',
            password: '5678',
            role: 'admin',
            actor_id: admin.id,
          },
        ],
        [
          'users:update',
          {
            id: cashier.id,
            name: cashier.name,
            username: cashier.username,
            role: 'admin',
            is_active: 1,
            actor_id: admin.id,
          },
        ],
        ['users:set-active', cashier.id, 0, admin.id],
        ['users:reset-password', admin.id, '5678', admin.id],
      ]

      for (const [channel, ...args] of attempts) {
        const result = await invoke(event, channel, ...args)
        expect(result.success).toBe(false)
      }

      expect(getDb().prepare('SELECT * FROM users ORDER BY id').all()).toEqual(
        before,
      )

      expect(getDb().prepare('SELECT * FROM activity_logs').all()).toHaveLength(
        0,
      )
    },
  )

  it('lets the authenticated admin manage users and records the real actor', async () => {
    const { event } = makeClient()
    const admin = await login(event)

    const created = await invoke(event, 'users:create', {
      name: 'Managed',
      username: 'managed',
      password: '5678',
      role: 'admin',
      actor_id: 999999,
    })

    expect(created.success).toBe(true)
    expect(created.user.password).toBeUndefined()

    const id = created.user.id

    const updated = await invoke(event, 'users:update', {
      id,
      name: 'Managed Updated',
      username: 'managed',
      role: 'cashier',
      is_active: 1,
      actor_id: 999999,
    })

    expect(updated.success).toBe(true)

    expect(
      (await invoke(event, 'users:set-active', id, 0, 999999)).success,
    ).toBe(true)

    expect(
      (await invoke(event, 'users:set-active', id, 1, 999999)).success,
    ).toBe(true)

    expect(
      (await invoke(event, 'users:reset-password', id, '9012', 999999)).success,
    ).toBe(true)

    const listed = await invoke(event, 'users:list')
    const paged = await invoke(event, 'users:list-page', {
      limit: 1,
      offset: 0,
    })

    expect(listed.success).toBe(true)
    expect(listed.users).toHaveLength(2)
    expect(paged.success).toBe(true)
    expect(paged.total).toBe(2)
    expect(paged.users).toHaveLength(1)

    for (const user of [...listed.users, ...paged.users]) {
      expect(user.password).toBeUndefined()
    }

    expect(
      verifyPassword('9012', findUserByUsername('managed')!.password),
    ).toBe(true)

    const logs = getDb()
      .prepare('SELECT user_id FROM activity_logs ORDER BY id')
      .all() as Array<{ user_id: number }>

    expect(logs).toHaveLength(5)

    for (const row of logs) {
      expect(row.user_id).toBe(admin.id)
    }
  })

  it.each(['logout', 'failed login'])(
    'clears the session after %s',
    async (action) => {
      const { event } = makeClient()
      const admin = await login(event)

      if (action === 'logout') {
        expect((await invoke(event, 'auth:logout')).success).toBe(true)
      } else {
        expect(
          (
            await invoke(event, 'auth:login', {
              username: 'admin',
              password: 'wrong',
            })
          ).success,
        ).toBe(false)
      }

      expect(
        (
          await invoke(event, 'users:list', {
            actor_id: admin.id,
          })
        ).success,
      ).toBe(false)
    },
  )

  it('does not share an admin session with another window or a child frame', async () => {
    const { event } = makeClient()
    const admin = await login(event)
    const other = makeClient()

    const child = {
      ...event,
      senderFrame: {},
    } as unknown as IpcMainInvokeEvent

    const detached = {
      ...event,
      senderFrame: null,
    } as unknown as IpcMainInvokeEvent

    for (const caller of [other.event, child, detached]) {
      expect(
        (
          await invoke(caller, 'users:list', {
            actor_id: admin.id,
          })
        ).success,
      ).toBe(false)
    }

    expect(
      (
        await invoke(child, 'auth:login', {
          username: 'admin',
          password: '1234',
        })
      ).success,
    ).toBe(false)

    expect((await invoke(child, 'auth:logout')).success).toBe(false)

    expect((await invoke(event, 'users:list')).success).toBe(true)
  })

  it.each(['role', 'active', 'password'])(
    'rechecks the admin after a %s change',
    async (change) => {
      const user = createUser('Second Admin', 'second_admin', '5678', 'admin')

      const { event } = makeClient()
      await login(event, user.username, '5678')

      if (change === 'role') {
        updateUser({ ...user, role: 'cashier' })
      } else if (change === 'active') {
        setUserActive(user.id, 0)
      } else {
        resetUserPassword(user.id, '9012')
      }

      expect(
        (
          await invoke(event, 'users:list', {
            actor_id: user.id,
          })
        ).success,
      ).toBe(false)
    },
  )

  it('keeps the session during hash routing and child-frame navigation', async () => {
    const { event, sender } = makeClient()
    await login(event)

    sender.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: true,
    })

    sender.emit('did-start-navigation', {
      isMainFrame: false,
      isSameDocument: false,
    })

    expect((await invoke(event, 'users:list')).success).toBe(true)
  })

  it.each(['reload', 'crash', 'destroy'])(
    'clears the session after %s',
    async (action) => {
      const { event, sender } = makeClient()
      const admin = await login(event)

      if (action === 'reload') {
        sender.emit('did-start-navigation', {
          isMainFrame: true,
          isSameDocument: false,
        })
      } else {
        sender.emit(action === 'crash' ? 'render-process-gone' : 'destroyed')
      }

      expect(
        (
          await invoke(event, 'users:list', {
            actor_id: admin.id,
          })
        ).success,
      ).toBe(false)
    },
  )

  it('preserves legacy password migration and creates a valid session', async () => {
    getDb()
      .prepare("UPDATE users SET password = '1234' WHERE username = 'admin'")
      .run()

    const { event } = makeClient()
    await login(event)

    expect(isPasswordHashed(findUserByUsername('admin')!.password)).toBe(true)

    expect((await invoke(event, 'users:list')).success).toBe(true)
  })
})
