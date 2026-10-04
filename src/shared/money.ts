export function roundMoney(value: unknown): number {
  const amount = Number(value ?? 0)

  if (!Number.isFinite(amount)) {
    return 0
  }

  /*
   * Money policy:
   *
   * 10.49 -> 10
   * 10.50 -> 11
   * 10.99 -> 11
   *
   * ونطبق نفس المنطق
   * على الفروق السالبة:
   *
   * -10.49 -> -10
   * -10.50 -> -11
   */
  const roundedAbsolute = Math.floor(Math.abs(amount) + 0.5)

  if (roundedAbsolute === 0) {
    return 0
  }

  return amount < 0 ? -roundedAbsolute : roundedAbsolute
}

export function formatMoney(value: unknown): string {
  return `${roundMoney(value)} ج.م`
}
