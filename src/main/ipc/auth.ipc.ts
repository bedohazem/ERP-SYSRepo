import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import { logAction } from './activity-helper'
import {
  createAdminPasswordRecoveryRequest,
  recoverAdminPassword,
} from '../security/admin-recovery'

import { isSupportRecoveryConfigured } from '../security/support-recovery-token'
import {
  changeOwnPassword,
  createInitialAdmin,
  createUser,
  findUserByUsername,
  getAuthBootstrapStatus,
  listUsers,
  listUsersPage,
  resetUserPassword,
  setUserActive,
  setUserPasswordChangeRequired,
  updateUser,
  upgradeUserPasswordHash,
} from '../database/repositories/user.repo'

import {
  AUTH_IDLE_TIMEOUT_MS,
  clearAuthSession,
  requireAuthenticatedAdmin,
  requireAuthenticatedUser,
  requireAuthenticatedUserForPasswordChange,
  startAuthSession,
} from '../auth-session'

import { isPasswordHashed, verifyPassword } from '../security/password'

import {
  assertPasswordPolicy,
  getPasswordPolicyError,
} from '../../shared/password-policy'

type AuthPayload = {
  name?: string
  username: string
  password: string
  role?: string
}

type LoginAttemptState = {
  failures: number
  lockedUntil: number
}

const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MS = 30 * 1000

const loginAttempts = new WeakMap<object, LoginAttemptState>()

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'حدث خطأ غير متوقع'
}

function getLoginRetrySeconds(event: IpcMainInvokeEvent) {
  const state = loginAttempts.get(event.sender)

  if (!state) {
    return 0
  }

  const remaining = state.lockedUntil - Date.now()

  if (remaining <= 0) {
    if (state.lockedUntil > 0) {
      loginAttempts.delete(event.sender)
    }

    return 0
  }

  return Math.max(1, Math.ceil(remaining / 1000))
}

function registerLoginFailure(event: IpcMainInvokeEvent) {
  const current = loginAttempts.get(event.sender)

  const failures = Number(current?.failures || 0) + 1

  if (failures >= MAX_LOGIN_FAILURES) {
    loginAttempts.set(event.sender, {
      failures: 0,

      lockedUntil: Date.now() + LOGIN_LOCK_MS,
    })

    return Math.ceil(LOGIN_LOCK_MS / 1000)
  }

  loginAttempts.set(event.sender, {
    failures,
    lockedUntil: 0,
  })

  return 0
}

function clearLoginFailures(event: IpcMainInvokeEvent) {
  loginAttempts.delete(event.sender)
}

function getLockMessage(seconds: number) {
  return `محاولات دخول كثيرة. حاول مرة أخرى بعد ${seconds} ثانية`
}

function failedLoginResponse(
  event: IpcMainInvokeEvent,
  username: string,
  reason: string,
) {
  logAction({
    actor_id: null,

    action: 'auth_login_failed',

    entity: 'auth',

    entity_id: null,

    details: {
      username,
      reason,
    },
  })

  const retryAfterSeconds = registerLoginFailure(event)

  if (retryAfterSeconds > 0) {
    return {
      success: false,

      message: getLockMessage(retryAfterSeconds),

      retry_after_seconds: retryAfterSeconds,
    }
  }

  return {
    success: false,

    /*
     * رسالة موحدة:
     * لا نكشف هل اسم المستخدم
     * موجود أم لا.
     */
    message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
  }
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:bootstrap-status', () => {
    const status = getAuthBootstrapStatus()

    return {
      success: true,

      ...status,

      message: status.blocked
        ? 'لا يوجد مدير نظام فعال. استرجع نسخة احتياطية سليمة أو تواصل مع الدعم.'
        : undefined,
    }
  })

  ipcMain.handle('auth:bootstrap-admin', (event, data: AuthPayload) => {
    try {
      clearAuthSession(event)

      const status = getAuthBootstrapStatus()

      if (!status.needs_setup) {
        throw new Error('تم إعداد حساب مدير للنظام بالفعل')
      }

      const name = String(data?.name || '').trim()

      const username = String(data?.username || '').trim()

      const password = assertPasswordPolicy(data?.password)

      if (!name) {
        throw new Error('اسم المدير مطلوب')
      }

      if (!username) {
        throw new Error('اسم الدخول مطلوب')
      }

      const user = createInitialAdmin(name, username, password)

      startAuthSession(event, user.id)

      clearLoginFailures(event)

      logAction({
        actor_id: user.id,

        action: 'auth_initial_admin_created',

        entity: 'auth',

        entity_id: user.id,

        details: {
          name: user.name,

          username: user.username,
        },
      })

      return {
        success: true,
        user,
      }
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('auth:recovery-request', () => {
    try {
      if (!isSupportRecoveryConfigured()) {
        throw new Error('خاصية استرجاع كلمة المرور غير مفعلة في هذه النسخة')
      }

      const request = createAdminPasswordRecoveryRequest()

      logAction({
        actor_id: null,

        action: 'auth_recovery_requested',

        entity: 'auth',

        entity_id: null,

        details: {
          request_id: request.request_id,

          device_code: request.device_code,

          expires_at: request.expires_at,
        },
      })

      return {
        success: true,
        ...request,
      }
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle(
    'auth:recover-admin',
    (
      event,
      input: {
        request_id?: string
        username?: string
        recovery_code?: string
        new_password?: string
      },
    ) => {
      try {
        if (!isSupportRecoveryConfigured()) {
          throw new Error('خاصية استرجاع كلمة المرور غير مفعلة في هذه النسخة')
        }

        const result = recoverAdminPassword(input)

        /*
         * أي Session قديمة لنفس
         * الـRenderer تنتهي.
         */
        clearAuthSession(event)

        /*
         * لو العميل وصل للـRecovery
         * بعد 5 محاولات Login خاطئة،
         * نفك الـLogin lock بعد نجاح
         * الاسترجاع.
         */
        clearLoginFailures(event)

        logAction({
          actor_id: null,

          action: 'admin_password_recovered',

          entity: 'users',

          entity_id: result.user.id,

          details: {
            username: result.user.username,

            request_id: result.request_id,

            method: 'support_signed_recovery',
          },
        })

        return {
          success: true,

          message: 'تم تغيير كلمة مرور المدير بنجاح. يمكنك تسجيل الدخول الآن.',
        }
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle('auth:login', (event, data: AuthPayload) => {
    try {
      /*
       * أي Login جديد
       * يلغي Session قديمة.
       */
      clearAuthSession(event)

      const retry = getLoginRetrySeconds(event)

      if (retry > 0) {
        return {
          success: false,

          message: getLockMessage(retry),

          retry_after_seconds: retry,
        }
      }

      const username =
        typeof data?.username === 'string' ? data.username.trim() : ''

      const password = typeof data?.password === 'string' ? data.password : ''

      if (!username || !password) {
        return failedLoginResponse(event, username, 'بيانات دخول غير مكتملة')
      }

      const user = findUserByUsername(username)

      if (!user) {
        return failedLoginResponse(
          event,
          username,
          'المستخدم غير موجود أو غير مفعل',
        )
      }

      if (!verifyPassword(password, user.password)) {
        return failedLoginResponse(event, username, 'كلمة المرور غير صحيحة')
      }

      /*
       * ترقية الباسوردات
       * القديمة النصية إلى Scrypt.
       */
      if (!isPasswordHashed(user.password)) {
        upgradeUserPasswordHash(user.id, password)
      }

      /*
       * أي باسورد قديم لا يحقق
       * السياسة الجديدة لا نمنع
       * صاحبه من الدخول نهائيًا،
       * لكن نجبره على تغييره.
       */
      const passwordPolicyError = getPasswordPolicyError(password)

      if (passwordPolicyError) {
        setUserPasswordChangeRequired(user.id, true)

        user.must_change_password = 1
      }

      clearLoginFailures(event)

      startAuthSession(event, user.id)

      logAction({
        actor_id: user.id,

        action: 'auth_login_succeeded',

        entity: 'auth',

        entity_id: user.id,

        details: {
          name: user.name,

          username: user.username,

          role: user.role,

          requires_password_change:
            Number(user.must_change_password || 0) === 1,
        },
      })

      return {
        success: true,

        requires_password_change: Number(user.must_change_password || 0) === 1,

        user: {
          id: user.id,

          name: user.name,

          username: user.username,

          role: user.role,
        },
      }
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle(
    'auth:change-password',
    (
      event,
      input: {
        password?: string
      },
    ) => {
      try {
        const actor = requireAuthenticatedUserForPasswordChange(event)

        const password = assertPasswordPolicy(input?.password)

        const user = changeOwnPassword(actor.id, password)

        /*
         * الباسورد Hash اتغير،
         * لذلك نجدد Session
         * بالـHash الجديد فورًا.
         */
        startAuthSession(event, actor.id)

        logAction({
          actor_id: actor.id,

          action: 'auth_password_changed',

          entity: 'users',

          entity_id: actor.id,

          details: {},
        })

        return {
          success: true,
          user,
        }
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle('auth:touch', (event) => {
    try {
      const user = requireAuthenticatedUser(event)

      return {
        success: true,

        user_id: user.id,

        idle_timeout_seconds: Math.floor(AUTH_IDLE_TIMEOUT_MS / 1000),
      }
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('auth:lock', (event) => {
    let actorId: number | null = null

    try {
      actorId = requireAuthenticatedUserForPasswordChange(event).id
    } catch {
      actorId = null
    }

    try {
      if (actorId) {
        logAction({
          actor_id: actorId,

          action: 'auth_auto_locked',

          entity: 'auth',

          entity_id: actorId,

          details: {
            reason: 'idle_timeout',
          },
        })
      }

      clearAuthSession(event)

      return {
        success: true,
      }
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('auth:logout', (event) => {
    let actorId: number | null = null

    try {
      actorId = requireAuthenticatedUserForPasswordChange(event).id
    } catch {
      actorId = null
    }

    try {
      if (actorId) {
        logAction({
          actor_id: actorId,

          action: 'auth_logout',

          entity: 'auth',

          entity_id: actorId,

          details: {},
        })
      }

      clearAuthSession(event)

      return {
        success: true,
      }
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle(
    'users:list',
    (
      event,
      input?: {
        search?: string
        actor_id?: number
      },
    ) => {
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
    (
      event,
      data: AuthPayload & {
        actor_id?: number
      },
    ) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const password = assertPasswordPolicy(data.password)

        const user = createUser(
          data.name ?? '',
          data.username,
          password,
          data.role ?? 'cashier',
          {
            /*
             * الباسورد الذي يضعه
             * المدير Temporary.
             */
            mustChangePassword: true,
          },
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

            must_change_password: true,
          },
        })

        return {
          success: true,
          user,
        }
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        }
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

      return {
        success: true,
        user,
      }
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      }
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

        return {
          success: true,
          user,
        }
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        }
      }
    },
  )

  ipcMain.handle(
    'users:reset-password',
    (event, userId: number, password: string) => {
      try {
        const actorId = requireAuthenticatedAdmin(event)

        const strongPassword = assertPasswordPolicy(password)

        const isSelf = Number(userId) === Number(actorId)

        const user = resetUserPassword(
          userId,
          strongPassword,

          /*
           * لو المدير غير باسورده
           * بنفسه لا نجبره على
           * تغييره مرة ثانية.
           *
           * باقي المستخدمين:
           * Temporary password.
           */
          !isSelf,
        )

        if (isSelf) {
          startAuthSession(event, actorId)
        }

        logAction({
          actor_id: actorId,

          action: 'user_password_reset',

          entity: 'users',

          entity_id: userId,

          details: {
            username: user.username,

            requires_change: !isSelf,
          },
        })

        return {
          success: true,
          user,
        }
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        }
      }
    },
  )
}
