import { ipcMain } from 'electron'
import { logAction } from './activity-helper'
import {
  createUser,
  findUserByUsername,
  listUsers,
  listUsersPage,
  resetUserPassword,
  setUserActive,
  updateUser,
  upgradeUserPasswordHash,
} from '../database/repositories/user.repo'
import {
  clearAuthSession,
  startAuthSession,
  requireAuthenticatedAdmin,
} from '../auth-session'
import { isPasswordHashed, verifyPassword } from '../security/password'

type AuthPayload = {
  name?: string
  username: string
  password: string
  role?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'حدث خطأ غير متوقع'
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:login', (event, data: AuthPayload) => {
    try {
      clearAuthSession(event)

      if (
        typeof data?.username !== 'string' ||
        typeof data?.password !== 'string'
      ) {
        throw new Error('اسم المستخدم وكلمة المرور مطلوبان')
      }

      const user = findUserByUsername(data.username)

      if (!user) {
        return {
          success: false,
          message: 'المستخدم غير موجود أو غير مفعل',
        }
      }

      if (!verifyPassword(data.password, user.password)) {
        return {
          success: false,
          message: 'كلمة المرور غير صحيحة',
        }
      }

      if (!isPasswordHashed(user.password)) {
        upgradeUserPasswordHash(user.id, data.password)
      }

      startAuthSession(event, user.id)

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
        },
      }
    } catch (error) {
      return { success: false, message: getErrorMessage(error) }
    }
  })

  ipcMain.handle('auth:logout', (event) => {
    try {
      clearAuthSession(event)
      return { success: true }
    } catch (error) {
      return { success: false, message: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'users:list',
    (event, input?: { search?: string; actor_id?: number }) => {
      try {
        requireAuthenticatedAdmin(event)

        return {
          success: true,
          users: listUsers(input?.search || ''),
        }
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
          users: [],
        }
      }
    },
  )

  ipcMain.handle(
    'users:list-page',
    (
      event,
      input?: {
        search?: string
        limit?: number
        offset?: number
        actor_id?: number
      },
    ) => {
      try {
        requireAuthenticatedAdmin(event)

        const result = listUsersPage(input)

        return {
          success: true,
          users: result.rows,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        }
      } catch (error) {
        return {
          success: false,
          message: getErrorMessage(error),
          users: [],
          total: 0,
          limit: 50,
          offset: 0,
        }
      }
    },
  )

  ipcMain.handle(
    'users:create',
    (event, data: AuthPayload & { actor_id?: number }) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const user = createUser(
          data.name ?? '',
          data.username,
          data.password,
          data.role ?? 'cashier',
        )

        logAction({
          actor_id: actorId,
          action: 'user_created',
          entity: 'users',
          entity_id: user.id,
          details: {
            name: user.name,
            username: user.username,
            role: user.role,
          },
        })

        return { success: true, user }
      } catch (error) {
        return { success: false, message: getErrorMessage(error) }
      }
    },
  )

  ipcMain.handle('users:update', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event)

      const user = updateUser(input)

      logAction({
        actor_id: actorId,
        action: 'user_updated',
        entity: 'users',
        entity_id: user.id,
        details: {
          name: user.name,
          username: user.username,
          role: user.role,
          is_active: user.is_active,
        },
      })

      return { success: true, user }
    } catch (error) {
      return { success: false, message: getErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'users:set-active',
    (event, userId: number, isActive: number) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const user = setUserActive(userId, isActive)

        logAction({
          actor_id: actorId,
          action: isActive ? 'user_activated' : 'user_deactivated',
          entity: 'users',
          entity_id: userId,
          details: {
            username: user.username,
            is_active: user.is_active,
          },
        })

        return { success: true, user }
      } catch (error) {
        return { success: false, message: getErrorMessage(error) }
      }
    },
  )

  ipcMain.handle(
    'users:reset-password',
    (event, userId: number, password: string) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const user = resetUserPassword(userId, password)

        logAction({
          actor_id: actorId,
          action: 'user_password_reset',
          entity: 'users',
          entity_id: userId,
          details: {
            username: user.username,
          },
        })

        return { success: true, user }
      } catch (error) {
        return { success: false, message: getErrorMessage(error) }
      }
    },
  )
}
