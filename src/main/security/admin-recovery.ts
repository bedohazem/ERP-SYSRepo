import crypto from 'node:crypto'

import { getDb } from '../database/db'

import {
  resetUserPassword,
  type PublicUserRow,
} from '../database/repositories/user.repo'

import { getSupportDeviceCode } from './device-license'

import { assertPasswordPolicy } from '../../shared/password-policy'

import {
  normalizeRecoveryCode,
  SUPPORT_RECOVERY_TOKEN_MAX_TTL_SECONDS,
  verifySupportRecoveryToken,
} from './support-recovery-token'

const RECOVERY_REQUEST_TTL_MS = 30 * 60 * 1000

const CLOCK_SKEW_SECONDS = 5 * 60

const GENERIC_RECOVERY_ERROR = 'بيانات الاسترجاع غير صحيحة أو منتهية'

type RecoveryRequestRow = {
  request_id: string
  device_code: string
  created_at_ms: number
  expires_at_ms: number
  used_at_ms: number | null
}

type RecoverInput = {
  request_id?: string
  username?: string
  recovery_code?: string
  new_password?: string
}

type RecoveryOptions = {
  /*
   * للاختبارات الداخلية فقط.
   * الـIPC لا يمرر هذا الخيار.
   */
  publicKeyPem?: string

  nowMs?: number
}

function formatRequestId(value: string) {
  const clean = normalizeRecoveryCode(value)

  return clean.match(/.{1,4}/g)?.join('-') || clean
}

function invalidRecovery(): never {
  throw new Error(GENERIC_RECOVERY_ERROR)
}

export function createAdminPasswordRecoveryRequest(nowMs = Date.now()) {
  const db = getDb()

  const adminCount = db
    .prepare(
      `
      SELECT
        COUNT(*) AS count

      FROM users

      WHERE
        role = 'admin'
        AND is_active = 1
      `,
    )
    .get() as {
    count: number
  }

  if (Number(adminCount.count || 0) <= 0) {
    throw new Error('لا يوجد حساب مدير فعال يمكن استرجاعه')
  }

  const deviceCode = normalizeRecoveryCode(getSupportDeviceCode())

  const requestId = crypto.randomBytes(8).toString('hex').toUpperCase()

  const expiresAtMs = nowMs + RECOVERY_REQUEST_TTL_MS

  const cleanupBefore = nowMs - 7 * 24 * 60 * 60 * 1000

  const tx = db.transaction(() => {
    db.prepare(
      `
        DELETE FROM
          auth_recovery_requests

        WHERE
          created_at_ms < ?
          AND (
            used_at_ms IS NOT NULL
            OR expires_at_ms < ?
          )
        `,
    ).run(cleanupBefore, nowMs)

    db.prepare(
      `
        INSERT INTO
          auth_recovery_requests (
            request_id,
            device_code,
            created_at_ms,
            expires_at_ms,
            used_at_ms
          )

        VALUES (?, ?, ?, ?, NULL)
        `,
    ).run(requestId, deviceCode, nowMs, expiresAtMs)
  })

  tx()

  return {
    device_code: getSupportDeviceCode(),

    request_id: formatRequestId(requestId),

    expires_at: new Date(expiresAtMs).toISOString(),

    expires_in_seconds: Math.floor(RECOVERY_REQUEST_TTL_MS / 1000),
  }
}

export function recoverAdminPassword(
  input: RecoverInput,
  options: RecoveryOptions = {},
): {
  user: PublicUserRow
  request_id: string
} {
  const db = getDb()

  const nowMs = Number(options.nowMs ?? Date.now())

  const requestId = normalizeRecoveryCode(input?.request_id)

  const username = String(input?.username ?? '').trim()

  const token = String(input?.recovery_code ?? '').trim()

  if (!requestId || !username || !token) {
    invalidRecovery()
  }

  const newPassword = assertPasswordPolicy(input?.new_password)

  const request = db
    .prepare(
      `
      SELECT
        request_id,
        device_code,
        created_at_ms,
        expires_at_ms,
        used_at_ms

      FROM
        auth_recovery_requests

      WHERE
        request_id = ?

      LIMIT 1
      `,
    )
    .get(requestId) as RecoveryRequestRow | undefined

  if (
    !request ||
    request.used_at_ms !== null ||
    Number(request.expires_at_ms) <= nowMs
  ) {
    invalidRecovery()
  }

  const currentDeviceCode = normalizeRecoveryCode(getSupportDeviceCode())

  if (normalizeRecoveryCode(request.device_code) !== currentDeviceCode) {
    invalidRecovery()
  }

  let payload

  try {
    payload = verifySupportRecoveryToken(token, options.publicKeyPem)
  } catch {
    invalidRecovery()
  }

  const nowSeconds = Math.floor(nowMs / 1000)

  const tokenLifetime = payload.expires_at - payload.issued_at

  if (
    payload.expires_at <= nowSeconds ||
    payload.issued_at > nowSeconds + CLOCK_SKEW_SECONDS ||
    tokenLifetime <= 0 ||
    tokenLifetime > SUPPORT_RECOVERY_TOKEN_MAX_TTL_SECONDS
  ) {
    invalidRecovery()
  }

  const requestCreatedSeconds = Math.floor(Number(request.created_at_ms) / 1000)

  if (payload.issued_at < requestCreatedSeconds - CLOCK_SKEW_SECONDS) {
    invalidRecovery()
  }

  if (
    payload.device_code !== currentDeviceCode ||
    payload.request_id !== requestId ||
    payload.username !== username
  ) {
    invalidRecovery()
  }

  const admin = db
    .prepare(
      `
      SELECT
        id,
        username

      FROM users

      WHERE
        username = ?
        AND role = 'admin'
        AND is_active = 1

      LIMIT 1
      `,
    )
    .get(username) as
    | {
        id: number
        username: string
      }
    | undefined

  if (!admin) {
    invalidRecovery()
  }

  let updatedUser: PublicUserRow | null = null

  const tx = db.transaction(() => {
    const consumed = db
      .prepare(
        `
          UPDATE
            auth_recovery_requests

          SET
            used_at_ms = ?

          WHERE
            request_id = ?
            AND used_at_ms IS NULL
            AND expires_at_ms > ?
          `,
      )
      .run(nowMs, requestId, nowMs)

    if (Number(consumed.changes) !== 1) {
      invalidRecovery()
    }

    /*
     * الباسورد اختاره العميل
     * بنفسه الآن، لذلك ليس
     * Temporary Password.
     */
    updatedUser = resetUserPassword(admin.id, newPassword, false)
  })

  tx()

  if (!updatedUser) {
    invalidRecovery()
  }

  return {
    user: updatedUser,

    request_id: formatRequestId(requestId),
  }
}
