export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export function getPasswordPolicyError(password: unknown): string | null {
  const value = String(password ?? '')

  if (value.length < PASSWORD_MIN_LENGTH) {
    return `كلمة المرور يجب ألا تقل عن ${PASSWORD_MIN_LENGTH} أحرف`
  }

  if (value.length > PASSWORD_MAX_LENGTH) {
    return `كلمة المرور يجب ألا تزيد عن ${PASSWORD_MAX_LENGTH} حرفًا`
  }

  if (!/\p{L}/u.test(value)) {
    return 'كلمة المرور يجب أن تحتوي على حرف واحد على الأقل'
  }

  if (!/\d/.test(value)) {
    return 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل'
  }

  return null
}

export function assertPasswordPolicy(password: unknown): string {
  const value = String(password ?? '')

  const error = getPasswordPolicyError(value)

  if (error) {
    throw new Error(error)
  }

  return value
}
