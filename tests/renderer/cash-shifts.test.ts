import { describe, expect, it } from 'vitest'

import {
  canResolveCashShiftVariance,
  getCashShiftVarianceKindLabel,
  getCashShiftVarianceResolutionLabel,
  getCashShiftVarianceStageLabel,
  getCashShiftVarianceStatusLabel,
  formatCashShiftDuration,
  getCashShiftStatusLabel,
} from '../../src/renderer/utils/cash-shifts'

describe('cash shift management display', () => {
  it('translates shift variance values to Arabic', () => {
    expect(getCashShiftVarianceStageLabel('opening')).toBe('افتتاح الشفت')

    expect(getCashShiftVarianceStageLabel('closing')).toBe('إغلاق الشفت')

    expect(getCashShiftVarianceKindLabel('shortage')).toBe('عجز')

    expect(getCashShiftVarianceKindLabel('surplus')).toBe('زيادة')

    expect(getCashShiftVarianceStatusLabel('pending')).toBe('قيد المراجعة')

    expect(getCashShiftVarianceStatusLabel('resolved')).toBe('تمت المراجعة')
  })

  it('translates variance resolution values', () => {
    expect(getCashShiftVarianceResolutionLabel('approved')).toBe(
      'تم التحقق واعتماد الفرق',
    )

    expect(getCashShiftVarianceResolutionLabel('explained')).toBe(
      'تم تفسير سبب الفرق',
    )

    expect(getCashShiftVarianceResolutionLabel('other')).toBe('مراجعة أخرى')
  })

  it('allows review only for pending variances', () => {
    expect(
      canResolveCashShiftVariance({
        status: 'pending',
      }),
    ).toBe(true)

    expect(
      canResolveCashShiftVariance({
        status: 'resolved',
      }),
    ).toBe(false)

    expect(canResolveCashShiftVariance(null)).toBe(false)
  })

  it('formats shift status and duration', () => {
    expect(getCashShiftStatusLabel('open')).toBe('مفتوح')

    expect(getCashShiftStatusLabel('closed')).toBe('مغلق')

    expect(formatCashShiftDuration(45)).toBe('45 دقيقة')

    expect(formatCashShiftDuration(120)).toBe('2 ساعة')

    expect(formatCashShiftDuration(135)).toBe('2 ساعة و 15 دقيقة')
  })
})
