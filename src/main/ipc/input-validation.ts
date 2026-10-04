import { roundMoney } from '../../shared/money'

export type InputObject = Record<string, unknown>

export function requireObjectInput(
  value: unknown,
  label = 'البيانات',
): InputObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} غير صحيحة`)
  }

  return value as InputObject
}

function requireFiniteNumber(value: unknown, label: string) {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value !== 'number' && typeof value !== 'string')
  ) {
    throw new Error(`${label} غير صحيح`)
  }

  if (typeof value === 'string' && !value.trim()) {
    throw new Error(`${label} غير صحيح`)
  }

  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new Error(`${label} غير صحيح`)
  }

  return number
}

export function requirePositiveInteger(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label)

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} غير صحيح`)
  }

  return number
}

export function optionalPositiveInteger(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  return requirePositiveInteger(value, label)
}

export function optionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  const number = requireFiniteNumber(value, label)

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} غير صحيح`)
  }

  return number
}

export function optionalBooleanValue(
  value: unknown,
  label: string,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${label} غير صحيحة`)
  }

  return value
}

export function requireArrayInput(
  value: unknown,
  label: string,
  maxLength = 500,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} غير صحيحة`)
  }

  if (value.length > maxLength) {
    throw new Error(`${label} أكبر من المسموح`)
  }

  return value
}

export function requirePositiveNumber(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label)

  if (number <= 0) {
    throw new Error(`${label} غير صحيح`)
  }

  return number
}

export function requireNonNegativeNumber(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label)

  if (number < 0) {
    throw new Error(`${label} غير صحيح`)
  }

  return number
}

export function requirePositiveMoney(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label)

  if (number <= 0) {
    throw new Error(`${label} غير صحيح`)
  }

  const amount = roundMoney(number)

  if (amount <= 0) {
    throw new Error(`${label} غير صحيح`)
  }

  return amount
}

export function requireNonNegativeMoney(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label)

  if (number < 0) {
    throw new Error(`${label} غير صحيح`)
  }

  return roundMoney(number)
}

export function optionalNonNegativeMoney(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  return requireNonNegativeMoney(value, label)
}

export function optionalNonNegativeNumber(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  return requireNonNegativeNumber(value, label)
}

export function requireEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} غير صحيح`)
  }

  return value as T[number]
}

export function optionalEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return requireEnumValue(value, allowed, label)
}

export function optionalStringValue(
  value: unknown,
  label: string,
  maxLength = 1000,
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} غير صحيحة`)
  }

  if (value.length > maxLength) {
    throw new Error(`${label} أطول من المسموح`)
  }

  return value
}

export function optionalTrimmedString(
  value: unknown,
  label: string,
  maxLength = 1000,
): string | null | undefined {
  const stringValue = optionalStringValue(value, label, maxLength)

  if (stringValue === undefined || stringValue === null) {
    return stringValue
  }

  return stringValue.trim() || null
}

export function requireTrimmedString(
  value: unknown,
  label: string,
  maxLength = 1000,
) {
  const result = optionalTrimmedString(value, label, maxLength)

  if (!result) {
    throw new Error(`${label} مطلوب`)
  }

  return result
}
