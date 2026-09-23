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

export type AdminApprovalIdentity = {
  id: number
  name: string
  username: string
}

export function requireAdminPassword(
  actorId?: number | null,

  password?: string | null,
): AdminApprovalIdentity {
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
      SELECT
        id,
        name,
        username,
        password

      FROM users

      WHERE
        id = ?
        AND role = 'admin'
        AND is_active = 1

      LIMIT 1
      `,
    )
    .get(cleanActorId) as
    | {
        id: number
        name: string
        username: string
        password: string
      }
    | undefined

  if (!user || !verifyPassword(cleanPassword, user.password)) {
    throw new Error('كلمة مرور المدير غير صحيحة')
  }

  return {
    id: Number(user.id),

    name: user.name,

    username: user.username,
  }
}

export function requireAdminApproval(
  username?: string | null,

  password?: string | null,
): AdminApprovalIdentity {
  const cleanUsername = String(username || '').trim()

  const cleanPassword = String(password || '')

  if (!cleanUsername) {
    throw new Error('اكتب اسم مستخدم المدير')
  }

  if (!cleanPassword) {
    throw new Error('اكتب كلمة مرور المدير')
  }

  const db = getDb()

  const admin = db
    .prepare(
      `
      SELECT
        id,
        name,
        username,
        password

      FROM users

      WHERE
        username = ?
        AND role = 'admin'
        AND is_active = 1

      LIMIT 1
      `,
    )
    .get(cleanUsername) as
    | {
        id: number
        name: string
        username: string
        password: string
      }
    | undefined

  /*
   * رسالة موحدة عشان ما نكشفش
   * هل Username المدير موجود.
   */
  if (!admin || !verifyPassword(cleanPassword, admin.password)) {
    throw new Error('بيانات اعتماد المدير غير صحيحة')
  }

  return {
    id: Number(admin.id),

    name: admin.name,

    username: admin.username,
  }
}

export function requireAdminApprovalForActor(
  actor: {
    id: number
    role: string
  },

  adminUsername?: string | null,

  adminPassword?: string | null,
): AdminApprovalIdentity {
  /*
   * لو المستخدم الحالي Admin:
   * لازم يؤكد بباسورده هو.
   */
  if (actor.role === 'admin') {
    return requireAdminPassword(actor.id, adminPassword)
  }

  /*
   * Cashier يحتاج هوية مدير
   * مستقلة: Username + Password.
   */
  return requireAdminApproval(adminUsername, adminPassword)
}
