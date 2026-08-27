import { getDb } from '../database/db'
import { verifyPassword } from '../security/password'

export function requireAdmin(actorId?: number | null): void {
  const cleanActorId = Number(actorId || 0)

  if (!cleanActorId) {
    throw new Error('غير مصرح بتنفيذ هذه العملية')
  }

  const db = getDb()

  const user = db
    .prepare(
      `
      SELECT id, role, is_active
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(cleanActorId) as
    | {
        id: number
        role: string
        is_active: number
      }
    | undefined

  if (!user || user.is_active !== 1 || user.role !== 'admin') {
    throw new Error('هذه العملية متاحة لمدير النظام فقط')
  }
}

export function requireAdminPassword(
  actorId?: number | null,
  password?: string | null,
): void {
  requireAdmin(actorId)

  const cleanActorId = Number(actorId || 0)
  const cleanPassword = String(password || '')

  if (!cleanPassword) {
    throw new Error('اكتب كلمة مرور المدير')
  }

  const db = getDb()

  const user = db
    .prepare(
      `
      SELECT id, password
      FROM users
      WHERE id = ?
        AND role = 'admin'
        AND is_active = 1
      LIMIT 1
      `,
    )
    .get(cleanActorId) as
    | {
        id: number
        password: string
      }
    | undefined

  if (!user || !verifyPassword(cleanPassword, user.password)) {
    throw new Error('كلمة مرور المدير غير صحيحة')
  }
}

export function requireAnyAdminPassword(password?: string | null): void {
  const cleanPassword = String(password || '')

  if (!cleanPassword) {
    throw new Error('اكتب كلمة مرور المدير')
  }

  const db = getDb()

  const admins = db
    .prepare(
      `
      SELECT password
      FROM users
      WHERE role = 'admin'
        AND is_active = 1
      `,
    )
    .all() as Array<{ password: string }>

  const valid = admins.some((admin) =>
    verifyPassword(cleanPassword, admin.password),
  )

  if (!valid) {
    throw new Error('كلمة مرور المدير غير صحيحة')
  }
}
