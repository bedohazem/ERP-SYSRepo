import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { getDb } from './database/db'

type Session = { userId: number; passwordHash: string }

type AuthUser = {
  id: number
  role: string
  is_active: number
  password: string
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
    .prepare('SELECT id, role, is_active, password FROM users WHERE id = ?')
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
      if (details.isMainFrame && !details.isSameDocument) clear()
    })

    sender.on('render-process-gone', clear)
    sender.once('destroyed', clear)
  }

  sessions.set(sender, {
    userId: user.id,
    passwordHash: user.password,
  })
}

export function requireAuthenticatedAdmin(event: IpcMainInvokeEvent): number {
  const sender = requireMainFrame(event)
  const session = sessions.get(sender)

  if (!session) {
    throw new Error('سجل الدخول أولًا')
  }

  const user = getAuthUser(session.userId)

  if (!user || user.is_active !== 1 || user.password !== session.passwordHash) {
    sessions.delete(sender)
    throw new Error('انتهت جلسة الدخول، سجل الدخول مرة أخرى')
  }

  if (user.role !== 'admin') {
    throw new Error('هذه العملية متاحة لمدير النظام فقط')
  }

  return user.id
}
