import crypto from 'node:crypto'

import { SUPPORT_RECOVERY_PUBLIC_KEY_PEM } from './support-recovery-public-key'

export const SUPPORT_RECOVERY_TOKEN_MAX_TTL_SECONDS = 15 * 60

export type SupportRecoveryTokenPayload = {
  v: 1

  purpose: 'admin_password_recovery'

  device_code: string

  request_id: string

  username: string

  issued_at: number

  expires_at: number
}

export function normalizeRecoveryCode(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function isSupportRecoveryConfigured(): boolean {
  const pem = String(SUPPORT_RECOVERY_PUBLIC_KEY_PEM || '').trim()

  if (!pem) {
    return false
  }

  try {
    const key = crypto.createPublicKey(pem)

    return key.asymmetricKeyType === 'ed25519'
  } catch {
    return false
  }
}

export function verifySupportRecoveryToken(
  tokenInput: unknown,
  publicKeyPem = SUPPORT_RECOVERY_PUBLIC_KEY_PEM,
): SupportRecoveryTokenPayload {
  const token = String(tokenInput ?? '').trim()

  if (!token || token.length > 4096) {
    throw new Error('Recovery Code غير صحيح')
  }

  const parts = token.split('.')

  if (parts.length !== 3 || parts[0] !== 'ERPR1') {
    throw new Error('Recovery Code غير صحيح')
  }

  const [, encodedPayload, encodedSignature] = parts

  const pem = String(publicKeyPem || '').trim()

  if (!pem) {
    throw new Error('Support Recovery غير مفعّل في هذه النسخة')
  }

  try {
    const publicKey = crypto.createPublicKey(pem)

    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Invalid key type')
    }

    const payloadBuffer = Buffer.from(encodedPayload, 'base64url')

    const signature = Buffer.from(encodedSignature, 'base64url')

    const valid = crypto.verify(null, payloadBuffer, publicKey, signature)

    if (!valid) {
      throw new Error('Invalid signature')
    }

    const raw = JSON.parse(
      payloadBuffer.toString('utf8'),
    ) as Partial<SupportRecoveryTokenPayload>

    if (raw.v !== 1 || raw.purpose !== 'admin_password_recovery') {
      throw new Error('Invalid payload')
    }

    const deviceCode = normalizeRecoveryCode(raw.device_code)

    const requestId = normalizeRecoveryCode(raw.request_id)

    const username = String(raw.username ?? '').trim()

    const issuedAt = Number(raw.issued_at)

    const expiresAt = Number(raw.expires_at)

    if (
      !deviceCode ||
      !requestId ||
      !username ||
      !Number.isInteger(issuedAt) ||
      !Number.isInteger(expiresAt)
    ) {
      throw new Error('Invalid payload')
    }

    return {
      v: 1,

      purpose: 'admin_password_recovery',

      device_code: deviceCode,

      request_id: requestId,

      username,

      issued_at: issuedAt,

      expires_at: expiresAt,
    }
  } catch {
    throw new Error('Recovery Code غير صحيح')
  }
}
