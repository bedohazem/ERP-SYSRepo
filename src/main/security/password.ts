import crypto from 'node:crypto';

const PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');

  return `${PREFIX}$${salt}$${hash}`;
}

export function isPasswordHashed(storedPassword?: string | null): boolean {
  return typeof storedPassword === 'string' && storedPassword.startsWith(`${PREFIX}$`);
}

export function verifyPassword(password: string, storedPassword: string): boolean {
  // دعم الباسوردات القديمة اللي كانت محفوظة نص عادي
  if (!isPasswordHashed(storedPassword)) {
    return password === storedPassword;
  }

  const parts = storedPassword.split('$');

  if (parts.length !== 3) {
    return false;
  }

  const [, salt, originalHash] = parts;

  try {
    const newHashBuffer = crypto.scryptSync(password, salt, KEY_LENGTH);
    const originalHashBuffer = Buffer.from(originalHash, 'hex');

    if (newHashBuffer.length !== originalHashBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(newHashBuffer, originalHashBuffer);
  } catch {
    return false;
  }
}