import crypto from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { validateAppActivationForDevice } from '../../src/main/security/app-activation-token'

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function signActivation(input: {
  privateKey: crypto.KeyObject

  deviceCode: string

  issuedAt?: number
}) {
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000)

  const payload = {
    v: 1,

    purpose: 'app_activation',

    device_code: normalize(input.deviceCode),

    license_id: crypto.randomUUID(),

    issued_at: issuedAt,

    expires_at: null,
  }

  const buffer = Buffer.from(JSON.stringify(payload), 'utf8')

  const signature = crypto.sign(null, buffer, input.privateKey)

  return [
    'ERPA1',

    buffer.toString('base64url'),

    signature.toString('base64url'),
  ].join('.')
}

describe('signed app activation', () => {
  it('accepts a signed token for the correct device', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

    const publicPem = publicKey
      .export({
        type: 'spki',
        format: 'pem',
      })
      .toString()

    const token = signActivation({
      privateKey,

      deviceCode: 'AAAA-BBBB-CCCC-DDDD',
    })

    const payload = validateAppActivationForDevice(
      token,
      'AAAA-BBBB-CCCC-DDDD',
      {
        publicKeyPem: publicPem,
      },
    )

    expect(payload.purpose).toBe('app_activation')
  })

  it('rejects activation for another device', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

    const publicPem = publicKey
      .export({
        type: 'spki',
        format: 'pem',
      })
      .toString()

    const token = signActivation({
      privateKey,

      deviceCode: 'AAAA-BBBB-CCCC-DDDD',
    })

    expect(() =>
      validateAppActivationForDevice(token, '1111-2222-3333-4444', {
        publicKeyPem: publicPem,
      }),
    ).toThrow('غير مخصص لهذا الجهاز')
  })

  it('rejects forged activation tokens', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

    const publicPem = publicKey
      .export({
        type: 'spki',
        format: 'pem',
      })
      .toString()

    const token = signActivation({
      privateKey,

      deviceCode: 'AAAA-BBBB-CCCC-DDDD',
    })

    const [prefix, encodedPayload, encodedSignature] = token.split('.')

    const forgedSignature = Buffer.from(encodedSignature, 'base64url')

    forgedSignature[0] ^= 0xff

    const forged = [
      prefix,
      encodedPayload,

      forgedSignature.toString('base64url'),
    ].join('.')

    expect(() =>
      validateAppActivationForDevice(forged, 'AAAA-BBBB-CCCC-DDDD', {
        publicKeyPem: publicPem,
      }),
    ).toThrow()
  })
})
