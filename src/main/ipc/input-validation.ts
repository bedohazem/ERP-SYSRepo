import { roundMoney } from '../../shared/money';

export type InputObject = Record<string, unknown>;

export function requireObjectInput(
  value: unknown,
  label = 'البيانات',
): InputObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} غير صحيحة`);
  }

  return value as InputObject;
}

function requireFiniteNumber(value: unknown, label: string) {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    (typeof value !== 'number' && typeof value !== 'string')
  ) {
    throw new Error(`${label} غير صحيح`);
  }

  if (typeof value === 'string' && !value.trim()) {
    throw new Error(`${label} غير صحيح`);
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`${label} غير صحيح`);
  }

  return number;
}

export function requirePositiveInteger(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} غير صحيح`);
  }

  return number;
}

export function requireNonZeroInteger(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label);

  if (!Number.isInteger(number) || number === 0) {
    throw new Error(`${label} غير صحيح`);
  }

  return number;
}

export function optionalPositiveInteger(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requirePositiveInteger(value, label);
}

export function optionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const number = requireFiniteNumber(value, label);

  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} غير صحيح`);
  }

  return number;
}

export function optionalBooleanValue(
  value: unknown,
  label: string,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${label} غير صحيحة`);
  }

  return value;
}

export function requireArrayInput(
  value: unknown,
  label: string,
  maxLength = 500,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} غير صحيحة`);
  }

  if (value.length > maxLength) {
    throw new Error(`${label} أكبر من المسموح`);
  }

  return value;
}

export function requirePositiveNumber(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label);

  if (number <= 0) {
    throw new Error(`${label} غير صحيح`);
  }

  return number;
}

export function requireNonNegativeNumber(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label);

  if (number < 0) {
    throw new Error(`${label} غير صحيح`);
  }

  return number;
}

export function requirePositiveMoney(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label);

  if (number <= 0) {
    throw new Error(`${label} غير صحيح`);
  }

  const amount = roundMoney(number);

  if (amount <= 0) {
    throw new Error(`${label} غير صحيح`);
  }

  return amount;
}

export function optionalPositiveMoney(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requirePositiveMoney(value, label);
}

export function requireBinaryFlag(value: unknown, label: string): 0 | 1 {
  const number = requireFiniteNumber(value, label);

  if (number !== 0 && number !== 1) {
    throw new Error(`${label} غير صحيح`);
  }

  return number as 0 | 1;
}

export function requireNonNegativeMoney(value: unknown, label: string) {
  const number = requireFiniteNumber(value, label);

  if (number < 0) {
    throw new Error(`${label} غير صحيح`);
  }

  return roundMoney(number);
}

export function optionalNonNegativeMoney(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requireNonNegativeMoney(value, label);
}

export function optionalNonNegativeNumber(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requireNonNegativeNumber(value, label);
}

export function requireEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} غير صحيح`);
  }

  return value as T[number];
}

export function optionalEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return requireEnumValue(value, allowed, label);
}

export function optionalDateOnly(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} غير صحيح`);
  }

  const date = value.trim();

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    throw new Error(`${label} غير صحيح`);
  }

  const year = Number(match[1]);

  const month = Number(match[2]);

  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} غير صحيح`);
  }

  return date;
}

export function optionalStringValue(
  value: unknown,
  label: string,
  maxLength = 1000,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} غير صحيحة`);
  }

  if (value.length > maxLength) {
    throw new Error(`${label} أطول من المسموح`);
  }

  return value;
}

export function optionalTrimmedString(
  value: unknown,
  label: string,
  maxLength = 1000,
): string | null | undefined {
  const stringValue = optionalStringValue(value, label, maxLength);

  if (stringValue === undefined || stringValue === null) {
    return stringValue;
  }

  return stringValue.trim() || null;
}

export function requireTrimmedString(
  value: unknown,
  label: string,
  maxLength = 1000,
) {
  const result = optionalTrimmedString(value, label, maxLength);

  if (!result) {
    throw new Error(`${label} مطلوب`);
  }

  return result;
}
