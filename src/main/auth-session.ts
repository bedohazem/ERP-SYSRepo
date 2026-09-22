import type { IpcMainInvokeEvent, WebContents } from 'electron'

import { getDb } from './database/db'

export const AUTH_IDLE_TIMEOUT_MS = 15 * 60 * 1000

type Session = {
  userId: number
  passwordHash: string
  lastActivityAt: number
}

type AuthUser = {
  id: number
  role: string
  is_active: number
  password: string
  must_change_password: number
}

const sessions = new WeakMap<WebContents, Session>()

const watchedSenders = new WeakSet<WebContents>()

function requireMainFrame(event: IpcMainInvokeEvent): WebContents {
  const sender = event.sender

  if (
    sender.isDestroyed() ||
    !event.senderFrame ||
    event.senderFrame !== sender.mainFrame
  ) {
    throw new Error('غير مصرح بتنفيذ هذه العملية')
  }

  return sender
}

function getAuthUser(userId: number): AuthUser | undefined {
  return getDb()
    .prepare(
      `
      SELECT
        id,
        role,
        is_active,
        password,
        must_change_password

      FROM users

      WHERE id = ?
      `,
    )
    .get(userId) as AuthUser | undefined
}

export function clearAuthSession(event: IpcMainInvokeEvent): void {
  sessions.delete(requireMainFrame(event))
}

export function startAuthSession(
  event: IpcMainInvokeEvent,
  userId: number,
): void {
  const sender = requireMainFrame(event)

  const user = getAuthUser(userId)

  if (!user || user.is_active !== 1) {
    throw new Error('المستخدم غير موجود أو غير مفعل')
  }

  if (!watchedSenders.has(sender)) {
    watchedSenders.add(sender)

    const clear = () => {
      sessions.delete(sender)
    }

    sender.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        clear()
      }
    })

    sender.on('render-process-gone', clear)

    sender.once('destroyed', clear)
  }

  sessions.set(sender, {
    userId: user.id,
    passwordHash: user.password,
    lastActivityAt: Date.now(),
  })
}

function validateSession(
  event: IpcMainInvokeEvent,
  allowPasswordChange: boolean,
): {
  id: number
  role: string
  must_change_password: number
} {
  const sender = requireMainFrame(event)

  const session = sessions.get(sender)

  if (!session) {
    throw new Error('سجل الدخول أولًا')
  }

  const now = Date.now()

  if (now - session.lastActivityAt >= AUTH_IDLE_TIMEOUT_MS) {
    sessions.delete(sender)

    throw new Error('انتهت الجلسة بسبب عدم الاستخدام، سجل الدخول مرة أخرى')
  }

  const user = getAuthUser(session.userId)

  if (!user || user.is_active !== 1 || user.password !== session.passwordHash) {
    sessions.delete(sender)

    throw new Error('انتهت جلسة الدخول، سجل الدخول مرة أخرى')
  }

  if (!allowPasswordChange && Number(user.must_change_password || 0) === 1) {
    throw new Error('يجب تغيير كلمة المرور أولًا')
  }

  /*
   * أي IPC Authenticated حقيقية
   * تعتبر نشاطًا للمستخدم.
   */
  session.lastActivityAt = now

  return {
    id: user.id,
    role: user.role,

    must_change_password: Number(user.must_change_password || 0),
  }
}

export function requireAuthenticatedUser(event: IpcMainInvokeEvent): {
  id: number
  role: string
} {
  const user = validateSession(event, false)

  return {
    id: user.id,
    role: user.role,
  }
}

export function requireAuthenticatedUserForPasswordChange(
  event: IpcMainInvokeEvent,
): {
  id: number
  role: string
  must_change_password: number
} {
  return validateSession(event, true)
}

export function requireAuthenticatedAdmin(event: IpcMainInvokeEvent): number {
  const user = requireAuthenticatedUser(event)

  if (user.role !== 'admin') {
    throw new Error('هذه العملية متاحة لمدير النظام فقط')
  }

  return user.id
}
