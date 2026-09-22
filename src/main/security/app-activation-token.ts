import crypto from 'node:crypto'

import { SUPPORT_SIGNING_PUBLIC_KEY_PEM } from './support-signing-public-key'

export type AppActivationTokenPayload = {
  v: 1

  purpose: 'app_activation'

  device_code: string

  license_id: string

  issued_at: number

  expires_at: number | null
}

export function normalizeActivationCode(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function verifyAppActivationToken(
  tokenInput: unknown,
  publicKeyPem = SUPPORT_SIGNING_PUBLIC_KEY_PEM,
): AppActivationTokenPayload {
  const token = String(tokenInput ?? '').trim()

  if (!token || token.length > 4096) {
    throw new Error('كود التفعيل غير صحيح')
  }

  const parts = token.split('.')

  if (parts.length !== 3 || parts[0] !== 'ERPA1') {
    throw new Error('كود التفعيل غير صحيح')
  }

  try {
    const publicKey = crypto.createPublicKey(publicKeyPem)

    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Invalid signing key')
    }

    const payloadBuffer = Buffer.from(parts[1], 'base64url')

    const signature = Buffer.from(parts[2], 'base64url')

    const valid = crypto.verify(null, payloadBuffer, publicKey, signature)

    if (!valid) {
      throw new Error('Invalid signature')
    }

    const raw = JSON.parse(
      payloadBuffer.toString('utf8'),
    ) as Partial<AppActivationTokenPayload>

    if (raw.v !== 1 || raw.purpose !== 'app_activation') {
      throw new Error('Invalid payload')
    }

    const deviceCode = normalizeActivationCode(raw.device_code)

    const licenseId = String(raw.license_id ?? '').trim()

    const issuedAt = Number(raw.issued_at)

    const expiresAt = raw.expires_at == null ? null : Number(raw.expires_at)

    if (
      !deviceCode ||
      !licenseId ||
      !Number.isInteger(issuedAt) ||
      (expiresAt !== null && !Number.isInteger(expiresAt))
    ) {
      throw new Error('Invalid payload')
    }

    return {
      v: 1,

      purpose: 'app_activation',

      device_code: deviceCode,

      license_id: licenseId,

      issued_at: issuedAt,

      expires_at: expiresAt,
    }
  } catch {
    throw new Error('كود التفعيل غير صحيح')
  }
}

export function validateAppActivationForDevice(
  token: unknown,
  expectedDeviceCode: string,
  options?: {
    publicKeyPem?: string
    nowSeconds?: number
  },
) {
  const payload = verifyAppActivationToken(
    token,
    options?.publicKeyPem ?? SUPPORT_SIGNING_PUBLIC_KEY_PEM,
  )

  const expected = normalizeActivationCode(expectedDeviceCode)

  if (payload.device_code !== expected) {
    throw new Error('كود التفعيل غير مخصص لهذا الجهاز')
  }

  const now = Number(options?.nowSeconds ?? Math.floor(Date.now() / 1000))

  /*
   * سماحية 5 دقائق لفروق الساعة.
   */
  if (payload.issued_at > now + 5 * 60) {
    throw new Error('تاريخ كود التفعيل غير صحيح')
  }

  if (payload.expires_at !== null && payload.expires_at <= now) {
    throw new Error('انتهت صلاحية كود التفعيل')
  }

  return payload
}
