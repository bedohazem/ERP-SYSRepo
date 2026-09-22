import crypto from 'node:crypto'

const PREFIX = 'scrypt'
const KEY_LENGTH = 64
const SALT_BYTES = 16

export function hashPassword(password: string): string {
  const value = String(password ?? '')

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')

  const hash = crypto.scryptSync(value, salt, KEY_LENGTH).toString('hex')

  return `${PREFIX}$${salt}$${hash}`
}

export function isPasswordHashed(storedPassword?: string | null): boolean {
  return (
    typeof storedPassword === 'string' &&
    storedPassword.startsWith(`${PREFIX}$`)
  )
}

export function verifyPassword(
  password: string,
  storedPassword: string,
): boolean {
  const value = String(password ?? '')

  /*
   * دعم النسخ القديمة
   * التي كانت تحفظ
   * الباسورد كنص عادي.
   */
  if (!isPasswordHashed(storedPassword)) {
    return value === storedPassword
  }

  const parts = storedPassword.split('$')

  if (parts.length !== 3) {
    return false
  }

  const [, salt, originalHash] = parts

  try {
    const newHashBuffer = crypto.scryptSync(value, salt, KEY_LENGTH)

    const originalHashBuffer = Buffer.from(originalHash, 'hex')

    if (newHashBuffer.length !== originalHashBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(newHashBuffer, originalHashBuffer)
  } catch {
    return false
  }
}
