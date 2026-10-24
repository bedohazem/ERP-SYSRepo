export function roundMoney(value: unknown): number {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return 0;
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
  const roundedAbsolute = Math.floor(Math.abs(amount) + 0.5);

  if (roundedAbsolute === 0) {
    return 0;
  }

  return amount < 0 ? -roundedAbsolute : roundedAbsolute;
}

export function roundCost(value: unknown): number {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  /*
   * Cost policy:
   *
   * تكلفة الشراء والمخزون
   * تحتفظ بدقة 4 منازل.
   *
   * لا تستخدم هذه الدالة
   * لتحصيل أو دفع الأموال الفعلية.
   */
  const rounded = Number(amount.toFixed(4));

  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatMoney(value: unknown): string {
  return `${roundMoney(value)} ج.م`;
}
