import crypto from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import { findUserByUsername } from '../../src/main/database/repositories/user.repo'

import { verifyPassword } from '../../src/main/security/password'

import {
  createAdminPasswordRecoveryRequest,
  recoverAdminPassword,
} from '../../src/main/security/admin-recovery'

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function createSignedToken(input: {
  privateKey: crypto.KeyObject

  deviceCode: string

  requestId: string

  username: string

  issuedAt?: number

  expiresAt?: number
}) {
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000)

  const expiresAt = input.expiresAt ?? issuedAt + 15 * 60

  const payload = {
    v: 1,

    purpose: 'admin_password_recovery',

    device_code: normalize(input.deviceCode),

    request_id: normalize(input.requestId),

    username: input.username,

    issued_at: issuedAt,

    expires_at: expiresAt,
  }

  const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8')

  const signature = crypto.sign(null, payloadBuffer, input.privateKey)

  return [
    'ERPR1',

    payloadBuffer.toString('base64url'),

    signature.toString('base64url'),
  ].join('.')
}

describe('admin password recovery', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('recovers an active admin with a valid signed one-time token', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

    const publicPem = publicKey
      .export({
        type: 'spki',
        format: 'pem',
      })
      .toString()

    const request = createAdminPasswordRecoveryRequest()

    const token = createSignedToken({
      privateKey,

      deviceCode: request.device_code,

      requestId: request.request_id,

      username: 'admin',
    })

    const result = recoverAdminPassword(
      {
        request_id: request.request_id,

        username: 'admin',

        recovery_code: token,

        new_password: 'Recovered9876',
      },
      {
        publicKeyPem: publicPem,
      },
    )

    expect(result.user.username).toBe('admin')

    const admin = findUserByUsername('admin')!

    expect(verifyPassword('Recovered9876', admin.password)).toBe(true)

    expect(Number(admin.must_change_password)).toBe(0)

    expect(() =>
      recoverAdminPassword(
        {
          request_id: request.request_id,

          username: 'admin',

          recovery_code: token,

          new_password: 'Another9876',
        },
        {
          publicKeyPem: publicPem,
        },
      ),
    ).toThrow('بيانات الاسترجاع غير صحيحة أو منتهية')
  })

  it('rejects tokens for another device request or username', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

    const publicPem = publicKey
      .export({
        type: 'spki',
        format: 'pem',
      })
      .toString()

    const request = createAdminPasswordRecoveryRequest()

    const wrongDevice = createSignedToken({
      privateKey,

      deviceCode: 'AAAA-BBBB-CCCC-DDDD',

      requestId: request.request_id,

      username: 'admin',
    })

    expect(() =>
      recoverAdminPassword(
        {
          request_id: request.request_id,

          username: 'admin',

          recovery_code: wrongDevice,

          new_password: 'Recovered9876',
        },
        {
          publicKeyPem: publicPem,
        },
      ),
    ).toThrow('بيانات الاسترجاع غير صحيحة أو منتهية')

    const wrongUsername = createSignedToken({
      privateKey,

      deviceCode: request.device_code,

      requestId: request.request_id,

      username: 'another-admin',
    })

    expect(() =>
      recoverAdminPassword(
        {
          request_id: request.request_id,

          username: 'admin',

          recovery_code: wrongUsername,

          new_password: 'Recovered9876',
        },
        {
          publicKeyPem: publicPem,
        },
      ),
    ).toThrow('بيانات الاسترجاع غير صحيحة أو منتهية')
  })

  it('rejects expired or forged recovery tokens', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

    const publicPem = publicKey
      .export({
        type: 'spki',
        format: 'pem',
      })
      .toString()

    const request = createAdminPasswordRecoveryRequest()

    const nowSeconds = Math.floor(Date.now() / 1000)

    const expired = createSignedToken({
      privateKey,

      deviceCode: request.device_code,

      requestId: request.request_id,

      username: 'admin',

      issuedAt: nowSeconds - 1200,

      expiresAt: nowSeconds - 60,
    })

    expect(() =>
      recoverAdminPassword(
        {
          request_id: request.request_id,

          username: 'admin',

          recovery_code: expired,

          new_password: 'Recovered9876',
        },
        {
          publicKeyPem: publicPem,
        },
      ),
    ).toThrow('بيانات الاسترجاع غير صحيحة أو منتهية')

    const valid = createSignedToken({
      privateKey,

      deviceCode: request.device_code,

      requestId: request.request_id,

      username: 'admin',
    })

    const [prefix, encodedPayload, encodedSignature] = valid.split('.')

    const forgedSignature = Buffer.from(encodedSignature, 'base64url')

    /*
     * نغيّر byte حقيقي داخل
     * توقيع Ed25519 بدل تغيير
     * حرف Base64 قد لا يغير
     * الـdecoded bytes.
     */
    forgedSignature[0] ^= 0xff

    const forged = [
      prefix,
      encodedPayload,

      forgedSignature.toString('base64url'),
    ].join('.')

    expect(() =>
      recoverAdminPassword(
        {
          request_id: request.request_id,

          username: 'admin',

          recovery_code: forged,

          new_password: 'Recovered9876',
        },
        {
          publicKeyPem: publicPem,
        },
      ),
    ).toThrow('بيانات الاسترجاع غير صحيحة أو منتهية')
  })

  it('still enforces the strong password policy during recovery', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

    const publicPem = publicKey
      .export({
        type: 'spki',
        format: 'pem',
      })
      .toString()

    const request = createAdminPasswordRecoveryRequest()

    const token = createSignedToken({
      privateKey,

      deviceCode: request.device_code,

      requestId: request.request_id,

      username: 'admin',
    })

    expect(() =>
      recoverAdminPassword(
        {
          request_id: request.request_id,

          username: 'admin',

          recovery_code: token,

          new_password: '1234',
        },
        {
          publicKeyPem: publicPem,
        },
      ),
    ).toThrow('كلمة المرور يجب ألا تقل عن 8 أحرف')
  })
})
