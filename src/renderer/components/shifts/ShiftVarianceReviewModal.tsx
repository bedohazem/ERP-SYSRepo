import { useEffect, useMemo, useState } from 'react'

import {
  getCashShiftVarianceCorrectionReasonLabel,
  getCashShiftVarianceStageLabel,
} from '../../utils/cash-shifts'

type Props = {
  varianceId: number
  onClose: () => void
  onChanged: () => void | Promise<void>
}

type SaleCorrectionItem = {
  variant_id: number
  product_name: string
  barcode: string
  size?: string | null
  color?: string | null
  stock: number
  quantity: number
  unit_price: number
}

type ReviewData = {
  variance: {
    id: number
    shift_id: number

    stage: 'opening' | 'closing'

    kind: 'shortage' | 'surplus'

    amount: number

    original_signed_amount: number
    correction_effect_amount: number
    remaining_signed_amount: number
    remaining_amount: number

    remaining_kind: 'shortage' | 'surplus' | 'balanced'

    correction_count: number

    previous_shift_id?: number | null
    expected_opening_amount?: number | null
    opening_counted_amount?: number
    opening_difference?: number

    status: 'pending' | 'resolved'
  }

  corrections: Array<{
    id: number

    reason_code: string

    amount: number
    effect_amount: number

    notes?: string | null
    document_title?: string | null

    document_category?: string | null
    reference_type?: string | null
    reference_id?: number | null

    created_by_name?: string | null
    created_at: string

    cancelled_at?: string | null
    cancel_reason?: string | null
  }>
}

export default function ShiftVarianceReviewModal({
  varianceId,
  onClose,
  onChanged,
}: Props) {
  const [review, setReview] = useState<ReviewData | null>(null)

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [adminPassword, setAdminPassword] = useState('')

  const [finalNotes, setFinalNotes] = useState('')

  const [openingReason, setOpeningReason] = useState('handover_mismatch')

  const [saleBarcode, setSaleBarcode] = useState('')

  const [saleItems, setSaleItems] = useState<SaleCorrectionItem[]>([])

  const [saleNotes, setSaleNotes] = useState('')

  const [expenseTitle, setExpenseTitle] = useState('')

  const [expenseCategory, setExpenseCategory] = useState('')

  const [expenseAmount, setExpenseAmount] = useState('')

  const [expenseNotes, setExpenseNotes] = useState('')

  const [editingCorrectionId, setEditingCorrectionId] = useState<number | null>(
    null,
  )

  const [editingCorrectionType, setEditingCorrectionType] = useState<
    'sale' | 'expense' | null
  >(null)

  const openingReasonOptions = [
    {
      value: 'handover_mismatch',
      label: 'المبلغ المستلم فعليًا مختلف عن المسجل في الشفت السابق',
    },
    {
      value: 'counting_error',
      label: 'خطأ في عد مبلغ افتتاح الشفت',
    },
    {
      value: 'cash_added_between_shifts',
      label: 'تمت إضافة أو سحب نقدية بين الشفتين',
    },
    {
      value: 'previous_handover_wrong',
      label: 'مبلغ التسليم المسجل في الشفت السابق غير صحيح',
    },
    {
      value: 'other',
      label: 'سبب آخر',
    },
  ]

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({
      type,
      text,
    })
  }

  async function loadReview() {
    setLoading(true)

    try {
      const result = await window.api.getCashShiftVarianceReview(varianceId)

      setReview(result as ReviewData)
    } catch (error) {
      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر تحميل مراجعة فرق الشفت',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReview()
  }, [varianceId])

  const saleTotal = useMemo(
    () =>
      Number(
        saleItems
          .reduce(
            (sum, item) =>
              sum + Number(item.quantity || 0) * Number(item.unit_price || 0),

            0,
          )
          .toFixed(2),
      ),

    [saleItems],
  )

  async function addBarcodeItem() {
    const barcode = saleBarcode.trim()

    if (!barcode) {
      showMessage('error', 'اكتب أو امسح الباركود')

      return
    }

    try {
      const variant = await window.api.getVariantByBarcode(barcode)

      if (!variant) {
        showMessage('error', 'الباركود غير موجود')

        return
      }

      const stock = Number(variant.stock || 0)

      if (stock <= 0) {
        showMessage('error', 'الصنف ليس له رصيد متاح')

        return
      }

      setSaleItems((current) => {
        const existing = current.find(
          (item) => item.variant_id === Number(variant.variant_id),
        )

        if (existing) {
          if (existing.quantity + 1 > stock) {
            showMessage('error', 'الكمية أكبر من الرصيد المتاح')

            return current
          }

          return current.map((item) =>
            item.variant_id === existing.variant_id
              ? {
                  ...item,

                  quantity: item.quantity + 1,
                }
              : item,
          )
        }

        return [
          ...current,

          {
            variant_id: Number(variant.variant_id),

            product_name: String(variant.product_name || ''),

            barcode: String(variant.barcode || ''),

            size: variant.size,

            color: variant.color,

            stock,

            quantity: 1,

            unit_price: Number(variant.sell_price || 0),
          },
        ]
      })

      setSaleBarcode('')
    } catch (error) {
      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر إضافة الصنف',
      )
    }
  }

  function updateSaleItemQuantity(variantId: number, quantityInput: number) {
    setSaleItems((current) =>
      current.map((item) => {
        if (item.variant_id !== variantId) {
          return item
        }

        const quantity = Math.max(
          0,
          Math.min(
            Number(quantityInput || 0),

            Number(item.stock || 0),
          ),
        )

        return {
          ...item,
          quantity,
        }
      }),
    )
  }

  function resetCorrectionEditor() {
    setEditingCorrectionId(null)

    setEditingCorrectionType(null)

    setSaleBarcode('')
    setSaleItems([])
    setSaleNotes('')

    setExpenseTitle('')
    setExpenseCategory('')
    setExpenseAmount('')
    setExpenseNotes('')
  }

  async function startEditCorrection(
    correction: ReviewData['corrections'][number],
  ) {
    if (correction.cancelled_at) {
      return
    }

    setMessage(null)

    if (correction.reference_type === 'shift_variance_sale_correction') {
      const saleId = Number(correction.reference_id || 0)

      if (!saleId) {
        showMessage('error', 'فاتورة التصحيح المرتبطة غير صحيحة')

        return
      }

      setSaving(true)

      try {
        const receipt = await window.api.getSaleReceipt(saleId)

        const items = await Promise.all(
          (receipt.items || []).map(async (item: any) => {
            const variant = await window.api.getVariantByBarcode(
              String(item.barcode || ''),
            )

            if (!variant) {
              throw new Error(
                `الصنف ${item.product_name || item.barcode} غير موجود أو غير مفعل`,
              )
            }

            return {
              variant_id: Number(item.variant_id),

              product_name: String(
                variant.product_name || item.product_name || '',
              ),

              barcode: String(variant.barcode || item.barcode || ''),

              size: variant.size,

              color: variant.color,

              /*
               * كمية الفاتورة القديمة
               * متخصمة بالفعل.
               * نضيفها للرصيد المتاح
               * أثناء التعديل.
               */
              stock: Number(variant.stock || 0) + Number(item.quantity || 0),

              quantity: Number(item.quantity || 0),

              /*
               * السعر دائمًا من المنتج.
               */
              unit_price: Number(variant.sell_price || 0),
            }
          }),
        )

        setSaleItems(items)

        setSaleNotes(correction.notes || '')

        setEditingCorrectionId(correction.id)

        setEditingCorrectionType('sale')
      } catch (error) {
        showMessage(
          'error',
          error instanceof Error ? error.message : 'تعذر تحميل فاتورة التصحيح',
        )
      } finally {
        setSaving(false)
      }

      return
    }

    if (correction.reference_type === 'shift_variance_expense_correction') {
      setExpenseTitle(correction.document_title || '')

      setExpenseCategory(correction.document_category || '')

      setExpenseAmount(String(correction.amount || ''))

      setExpenseNotes(correction.notes || '')

      setEditingCorrectionId(correction.id)

      setEditingCorrectionType('expense')
    }
  }

  async function saveSaleCorrection() {
    if (!review || saving) {
      return
    }

    if (saleItems.length === 0) {
      showMessage('error', 'أضف أصناف البيع')

      return
    }

    if (saleItems.some((item) => Number(item.quantity || 0) <= 0)) {
      showMessage('error', 'راجع كميات الأصناف')

      return
    }

    if (saleTotal <= 0) {
      showMessage('error', 'إجمالي البيع غير صحيح')

      return
    }

    if (!adminPassword.trim()) {
      showMessage('error', 'اكتب كلمة مرور المدير')

      return
    }

    setSaving(true)

    try {
      const result =
        editingCorrectionType === 'sale' && editingCorrectionId
          ? await window.api.updateShiftVarianceSaleCorrection({
              correction_id: editingCorrectionId,

              notes: saleNotes.trim() || null,

              admin_password: adminPassword,

              items: saleItems.map((item) => ({
                variant_id: item.variant_id,

                quantity: item.quantity,
              })),
            })
          : await window.api.createShiftVarianceSaleCorrection({
              variance_id: review.variance.id,

              notes: saleNotes.trim() || null,

              admin_password: adminPassword,

              items: saleItems.map((item) => ({
                variant_id: item.variant_id,

                quantity: item.quantity,
              })),
            })

      if (!result.success) {
        showMessage('error', result.message || 'تعذر تسجيل فاتورة التصحيح')

        return
      }

      if (result.review) {
        setReview(result.review as ReviewData)
      } else {
        await loadReview()
      }

      const wasEditing =
        editingCorrectionType === 'sale' && Boolean(editingCorrectionId)

      resetCorrectionEditor()
      setAdminPassword('')

      showMessage(
        'success',

        wasEditing
          ? `تم تعديل فاتورة التصحيح #${result.sale_id}`
          : `تم تسجيل فاتورة التصحيح #${result.sale_id}`,
      )

      await onChanged()
    } catch (error) {
      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر تسجيل فاتورة التصحيح',
      )
    } finally {
      setSaving(false)
    }
  }

  async function saveExpenseCorrection() {
    if (!review || saving) {
      return
    }

    if (!expenseTitle.trim()) {
      showMessage('error', 'اكتب اسم المصروف')

      return
    }

    const amount = Number(expenseAmount || 0)

    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage('error', 'اكتب مبلغ مصروف صحيح')

      return
    }

    if (!adminPassword.trim()) {
      showMessage('error', 'اكتب كلمة مرور المدير')

      return
    }

    setSaving(true)

    const wasEditing =
      editingCorrectionType === 'expense' && Boolean(editingCorrectionId)

    try {
      const result =
        wasEditing && editingCorrectionId
          ? await window.api.updateShiftVarianceExpenseCorrection({
              correction_id: editingCorrectionId,

              title: expenseTitle.trim(),

              category: expenseCategory.trim() || null,

              amount,

              notes: expenseNotes.trim() || null,

              admin_password: adminPassword,
            })
          : await window.api.createShiftVarianceExpenseCorrection({
              variance_id: review.variance.id,

              title: expenseTitle.trim(),

              category: expenseCategory.trim() || null,

              amount,

              notes: expenseNotes.trim() || null,

              admin_password: adminPassword,
            })

      if (!result.success) {
        showMessage('error', result.message || 'تعذر تسجيل المصروف التصحيحي')

        return
      }

      if (result.review) {
        setReview(result.review as ReviewData)
      } else {
        await loadReview()
      }

      resetCorrectionEditor()
      setExpenseTitle('')
      setExpenseCategory('')
      setExpenseAmount('')
      setExpenseNotes('')
      setAdminPassword('')

      showMessage(
        'success',

        wasEditing
          ? `تم تعديل المصروف التصحيحي #${result.expense_id}`
          : `تم تسجيل المصروف التصحيحي #${result.expense_id}`,
      )

      await onChanged()
    } catch (error) {
      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر تسجيل المصروف التصحيحي',
      )
    } finally {
      setSaving(false)
    }
  }

  async function cancelCorrection(correctionId: number) {
    if (!review || saving) {
      return
    }

    if (!adminPassword.trim()) {
      showMessage('error', 'اكتب كلمة مرور المدير أولًا')

      return
    }

    const reason = window.prompt('اكتب سبب إلغاء التصحيح')

    if (!reason?.trim()) {
      return
    }

    setSaving(true)

    try {
      const result = await window.api.cancelCashShiftVarianceCorrection({
        correction_id: correctionId,

        reason: reason.trim(),

        admin_password: adminPassword,
      })

      if (!result.success) {
        showMessage('error', result.message || 'تعذر إلغاء التصحيح')

        return
      }

      if (result.review) {
        setReview(result.review as ReviewData)
      } else {
        await loadReview()
      }

      setAdminPassword('')

      showMessage('success', 'تم إلغاء التصحيح والمستند المرتبط به')

      await onChanged()
    } catch (error) {
      showMessage(
        'error',
        error instanceof Error ? error.message : 'تعذر إلغاء التصحيح',
      )
    } finally {
      setSaving(false)
    }
  }

  async function finishReview() {
    if (!review || saving) {
      return
    }

    if (!adminPassword.trim()) {
      showMessage('error', 'اكتب كلمة مرور المدير')

      return
    }

    const variance = review.variance

    if (variance.stage === 'opening') {
      const selected = openingReasonOptions.find(
        (item) => item.value === openingReason,
      )

      if (!selected) {
        return
      }

      const notes = [
        `سبب فرق الافتتاح: ${selected.label}`,

        finalNotes.trim() ? `ملاحظات: ${finalNotes.trim()}` : null,
      ]
        .filter(Boolean)
        .join('\n')

      setSaving(true)

      try {
        const result = await window.api.resolveCashShiftVariance({
          variance_id: variance.id,

          resolution_type: 'approved',

          resolution_notes: notes,

          admin_password: adminPassword,
        })

        if (!result.success) {
          showMessage('error', result.message || 'تعذر اعتماد فرق الاستلام')

          return
        }

        await onChanged()
        onClose()
      } finally {
        setSaving(false)
      }

      return
    }

    const remaining = Number(variance.remaining_signed_amount || 0)

    const balanced = Math.abs(remaining) <= 0.01

    if (!balanced && !finalNotes.trim()) {
      showMessage('error', 'اكتب سبب اعتماد الفرق المتبقي كفرق حقيقي')

      return
    }

    setSaving(true)

    try {
      const result = await window.api.resolveCashShiftVariance({
        variance_id: variance.id,

        resolution_type: balanced ? 'explained' : 'approved',

        resolution_notes: balanced
          ? finalNotes.trim() ||
            'تم تفسير فرق الشفت بالكامل ووصل حساب الفروقات إلى صفر'
          : finalNotes.trim(),

        admin_password: adminPassword,
      })

      if (!result.success) {
        showMessage('error', result.message || 'تعذر إنهاء المراجعة')

        return
      }

      await onChanged()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>جاري تحميل حساب الفروقات...</div>
      </div>
    )
  }

  if (!review) {
    return null
  }

  const variance = review.variance

  const balanced =
    Math.abs(Number(variance.remaining_signed_amount || 0)) <= 0.01

  return (
    <div className="theme-modal-overlay" style={overlayStyle}>
      <div className="theme-modal-card" style={cardStyle}>
        <div style={headerStyle}>
          <div>
            <h3
              style={{
                margin: '0 0 5px',
              }}
            >
              {variance.stage === 'opening'
                ? `مراجعة استلام الشفت #${variance.shift_id}`
                : `حساب فروقات الشفت #${variance.shift_id}`}
            </h3>

            <div
              style={{
                color: '#94a3b8',
                fontSize: '12px',
              }}
            >
              {getCashShiftVarianceStageLabel(variance.stage)}
            </div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            style={closeButtonStyle}
          >
            ×
          </button>
        </div>

        {message && (
          <div
            style={{
              padding: '10px 12px',

              borderRadius: '12px',

              background:
                message.type === 'error'
                  ? 'rgba(239,68,68,0.12)'
                  : 'rgba(16,185,129,0.12)',

              border:
                message.type === 'error'
                  ? '1px solid rgba(239,68,68,0.28)'
                  : '1px solid rgba(16,185,129,0.28)',

              color: message.type === 'error' ? '#fca5a5' : '#6ee7b7',

              fontWeight: 800,
            }}
          >
            {message.text}
          </div>
        )}

        {variance.stage === 'opening' ? (
          <>
            <div style={cardsStyle}>
              <AmountCard
                label="المفروض استلامه"
                value={Number(variance.expected_opening_amount || 0)}
                signed={false}
              />

              <AmountCard
                label="المبلغ المعدود"
                value={Number(variance.opening_counted_amount || 0)}
                signed={false}
              />

              <AmountCard
                label="فرق الاستلام"
                value={variance.original_signed_amount}
                strong
              />
            </div>

            <section style={sectionStyle}>
              <strong>سبب فرق الاستلام</strong>

              <select
                value={openingReason}
                onChange={(event) => setOpeningReason(event.target.value)}
                style={inputStyle}
              >
                {openingReasonOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </section>
          </>
        ) : (
          <>
            <div style={cardsStyle}>
              <AmountCard
                label="الفرق الأصلي"
                value={variance.original_signed_amount}
              />

              <AmountCard
                label="صافي التصحيحات"
                value={variance.correction_effect_amount}
              />

              <AmountCard
                label="المتبقي"
                value={variance.remaining_signed_amount}
                strong
              />
            </div>

            <div style={infoStyle}>
              تسوية الدرج تمت بالفعل وقت إغلاق الشفت. المستندات التصحيحية هنا
              تؤثر على المبيعات أو المصروفات والمخزون فقط، ولا تنشئ حركة كاش
              جديدة.
            </div>

            {(variance.remaining_kind === 'surplus' ||
              editingCorrectionType === 'sale') && (
              <section style={sectionStyle}>
                <strong>
                  {editingCorrectionType === 'sale'
                    ? 'تعديل فاتورة التصحيح'
                    : 'بيع كاش تم ولم يُسجل'}
                </strong>

                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <input
                    value={saleBarcode}
                    onChange={(event) => setSaleBarcode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()

                        void addBarcodeItem()
                      }
                    }}
                    placeholder="امسح أو اكتب الباركود"
                    style={{
                      ...inputStyle,
                      flex: 1,
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => void addBarcodeItem()}
                    style={secondaryButtonStyle}
                  >
                    إضافة
                  </button>
                </div>

                {saleItems.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    {saleItems.map((item) => (
                      <div key={item.variant_id} style={itemCardStyle}>
                        <div
                          style={{
                            minWidth: 0,
                          }}
                        >
                          <strong>{item.product_name}</strong>

                          <div style={mutedStyle}>
                            {item.barcode}
                            {' • '}
                            {item.size || '—'}
                            {' • '}
                            {item.color || '—'}
                          </div>
                        </div>

                        <label style={miniFieldStyle}>
                          الكمية
                          <input
                            type="number"
                            min={0.01}
                            max={item.stock}
                            step="1"
                            value={item.quantity}
                            onChange={(event) =>
                              updateSaleItemQuantity(
                                item.variant_id,

                                Number(event.target.value),
                              )
                            }
                            style={miniInputStyle}
                          />
                        </label>

                        <label style={miniFieldStyle}>
                          السعر
                          <div
                            style={{
                              ...miniInputStyle,

                              display: 'flex',

                              alignItems: 'center',

                              justifyContent: 'center',

                              cursor: 'default',

                              color: '#e2e8f0',

                              fontWeight: 900,
                            }}
                          >
                            {money(item.unit_price)}
                          </div>
                        </label>

                        <label style={miniFieldStyle}>
                          الإجمالي
                          <div
                            style={{
                              ...miniInputStyle,

                              display: 'flex',

                              alignItems: 'center',

                              justifyContent: 'center',

                              cursor: 'default',

                              color: '#6ee7b7',

                              fontWeight: 900,
                            }}
                          >
                            {money(item.quantity * item.unit_price)}
                          </div>
                        </label>

                        <button
                          type="button"
                          onClick={() =>
                            setSaleItems((current) =>
                              current.filter(
                                (row) => row.variant_id !== item.variant_id,
                              ),
                            )
                          }
                          style={dangerButtonStyle}
                        >
                          حذف
                        </button>
                      </div>
                    ))}

                    <div
                      style={{
                        display: 'flex',

                        justifyContent: 'space-between',

                        padding: '12px',

                        borderRadius: '12px',

                        background: 'rgba(16,185,129,0.08)',
                      }}
                    >
                      <strong>إجمالي الفاتورة</strong>

                      <strong>{money(saleTotal)}</strong>
                    </div>
                  </div>
                )}

                <textarea
                  value={saleNotes}
                  onChange={(event) => setSaleNotes(event.target.value)}
                  placeholder="ملاحظات الفاتورة التصحيحية — اختياري"
                  style={{
                    ...inputStyle,
                    minHeight: '65px',
                  }}
                />

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveSaleCorrection()}
                  style={primaryButtonStyle}
                >
                  {editingCorrectionType === 'sale'
                    ? 'حفظ تعديل فاتورة التصحيح — بدون حركة كاش'
                    : 'تسجيل فاتورة على الشفت القديم — بدون حركة كاش'}
                </button>

                {editingCorrectionId && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={resetCorrectionEditor}
                    style={secondaryButtonStyle}
                  >
                    إلغاء التعديل
                  </button>
                )}
              </section>
            )}

            {(variance.remaining_kind === 'shortage' ||
              editingCorrectionType === 'expense') && (
              <section style={sectionStyle}>
                <strong>
                  {editingCorrectionType === 'expense'
                    ? 'تعديل المصروف التصحيحي'
                    : 'مصروف دُفع ولم يُسجل'}
                </strong>

                <input
                  value={expenseTitle}
                  onChange={(event) => setExpenseTitle(event.target.value)}
                  placeholder="اسم المصروف"
                  style={inputStyle}
                />

                <input
                  value={expenseCategory}
                  onChange={(event) => setExpenseCategory(event.target.value)}
                  placeholder="التصنيف — اختياري"
                  style={inputStyle}
                />

                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={expenseAmount}
                  onChange={(event) => setExpenseAmount(event.target.value)}
                  placeholder="قيمة المصروف"
                  style={inputStyle}
                />

                <textarea
                  value={expenseNotes}
                  onChange={(event) => setExpenseNotes(event.target.value)}
                  placeholder="ملاحظات — اختياري"
                  style={{
                    ...inputStyle,
                    minHeight: '65px',
                  }}
                />

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveExpenseCorrection()}
                  style={primaryButtonStyle}
                >
                  {editingCorrectionType === 'expense'
                    ? 'حفظ تعديل المصروف التصحيحي — بدون حركة كاش'
                    : 'تسجيل المصروف على الشفت القديم — بدون حركة كاش'}
                </button>

                {editingCorrectionId && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={resetCorrectionEditor}
                    style={secondaryButtonStyle}
                  >
                    إلغاء التعديل
                  </button>
                )}
              </section>
            )}

            <section style={sectionStyle}>
              <strong>سجل التصحيحات</strong>

              {review.corrections.length === 0 ? (
                <div style={mutedStyle}>لا توجد تصحيحات مسجلة.</div>
              ) : (
                review.corrections.map((correction) => {
                  const cancelled = Boolean(correction.cancelled_at)

                  return (
                    <div
                      key={correction.id}
                      style={{
                        ...itemCardStyle,
                        opacity: cancelled ? 0.55 : 1,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          minWidth: '220px',
                        }}
                      >
                        <strong>
                          {getCashShiftVarianceCorrectionReasonLabel(
                            correction.reason_code,
                          )}
                        </strong>

                        <div style={mutedStyle}>
                          {signedMoney(correction.effect_amount)}

                          {correction.reference_id
                            ? ` • مستند #${correction.reference_id}`
                            : ''}
                        </div>

                        {correction.notes && (
                          <div style={mutedStyle}>{correction.notes}</div>
                        )}

                        {cancelled && (
                          <div
                            style={{
                              color: '#fca5a5',

                              fontSize: '11px',
                            }}
                          >
                            ملغي: {correction.cancel_reason || '—'}
                          </div>
                        )}
                      </div>

                      {!cancelled && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '7px',
                            flexWrap: 'wrap',
                          }}
                        >
                          {(correction.reference_type ===
                            'shift_variance_sale_correction' ||
                            correction.reference_type ===
                              'shift_variance_expense_correction') && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() =>
                                void startEditCorrection(correction)
                              }
                              style={secondaryButtonStyle}
                            >
                              تعديل
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void cancelCorrection(correction.id)}
                            style={dangerButtonStyle}
                          >
                            إلغاء
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </section>
          </>
        )}

        <section style={sectionStyle}>
          {variance.stage === 'closing' && !balanced && (
            <textarea
              value={finalNotes}
              onChange={(event) => setFinalNotes(event.target.value)}
              placeholder={
                variance.remaining_kind === 'shortage'
                  ? 'لو المتبقي عجز حقيقي اكتب السبب هنا'
                  : 'لو المتبقي زيادة حقيقية اكتب السبب هنا'
              }
              style={{
                ...inputStyle,
                minHeight: '70px',
              }}
            />
          )}

          {variance.stage === 'opening' && (
            <textarea
              value={finalNotes}
              onChange={(event) => setFinalNotes(event.target.value)}
              placeholder="ملاحظات فرق الاستلام — اختياري"
              style={{
                ...inputStyle,
                minHeight: '70px',
              }}
            />
          )}

          <input
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            placeholder="كلمة مرور المدير"
            style={inputStyle}
          />

          {variance.status === 'resolved' ? (
            <div
              style={{
                padding: '12px',

                borderRadius: '12px',

                background: 'rgba(16,185,129,0.08)',

                border: '1px solid rgba(16,185,129,0.22)',

                color: '#6ee7b7',

                fontWeight: 800,

                lineHeight: 1.7,
              }}
            >
              تمت مراجعة فرق الشفت. يمكنك تعديل أو إلغاء أي مستند تصحيحي، وعندها
              ستعود المراجعة تلقائيًا إلى «قيد المراجعة».
            </div>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void finishReview()}
              style={{
                ...primaryButtonStyle,

                background:
                  variance.stage === 'opening'
                    ? 'linear-gradient(135deg, #2563eb, #3b82f6)'
                    : balanced
                      ? 'linear-gradient(135deg, #059669, #10b981)'
                      : 'linear-gradient(135deg, #b45309, #f59e0b)',
              }}
            >
              {variance.stage === 'opening'
                ? 'اعتماد مراجعة فرق الاستلام'
                : balanced
                  ? 'إنهاء المراجعة — الحساب متطابق'
                  : `اعتماد الفرق المتبقي ${money(variance.remaining_amount)}`}
            </button>
          )}
        </section>
      </div>
    </div>
  )
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function signedMoney(value: unknown) {
  const amount = Number(value || 0)

  if (Math.abs(amount) <= 0.001) {
    return '0.00 ج.م'
  }

  return `${amount > 0 ? '+' : ''}${amount.toFixed(2)} ج.م`
}

function AmountCard({
  label,
  value,
  strong = false,
  signed = true,
}: {
  label: string
  value: number
  strong?: boolean
  signed?: boolean
}) {
  return (
    <div
      style={{
        padding: '12px',

        borderRadius: '12px',

        background: 'rgba(255,255,255,0.045)',

        border: '1px solid rgba(255,255,255,0.06)',

        display: 'grid',

        gap: '6px',
      }}
    >
      <span
        style={{
          color: '#94a3b8',
          fontSize: '11px',
        }}
      >
        {label}
      </span>

      <strong
        style={{
          fontSize: strong ? '19px' : '16px',
        }}
      >
        {signed ? signedMoney(value) : money(value)}
      </strong>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000000,

  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',

  padding: '22px',

  background: 'rgba(2,6,23,0.92)',

  backdropFilter: 'blur(8px)',

  overflow: 'hidden',

  boxSizing: 'border-box',
}

const cardStyle: React.CSSProperties = {
  width: 'min(820px, calc(100vw - 44px))',

  maxHeight: 'calc(100vh - 44px)',

  overflowY: 'auto',
  overflowX: 'hidden',

  display: 'grid',
  gap: '14px',

  padding: '20px',

  borderRadius: '20px',

  background: '#101827',

  border: '1px solid rgba(148,163,184,0.20)',

  boxShadow: '0 30px 100px rgba(0,0,0,0.80)',

  color: '#f8fafc',

  direction: 'rtl',

  boxSizing: 'border-box',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
}

const cardsStyle: React.CSSProperties = {
  display: 'grid',

  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',

  gap: '10px',
}

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: '10px',

  padding: '14px',

  border: '1px solid rgba(255,255,255,0.08)',

  borderRadius: '14px',

  background: 'rgba(255,255,255,0.018)',
}

const infoStyle: React.CSSProperties = {
  padding: '12px',

  borderRadius: '12px',

  background: 'rgba(59,130,246,0.08)',

  border: '1px solid rgba(59,130,246,0.20)',

  color: '#bfdbfe',

  fontSize: '12px',

  fontWeight: 800,

  lineHeight: 1.8,
}

const inputStyle: React.CSSProperties = {
  width: '100%',

  minHeight: '42px',

  padding: '8px 10px',

  borderRadius: '10px',

  border: '1px solid rgba(255,255,255,0.14)',

  background: 'rgba(15,23,42,0.92)',

  color: '#fff',

  boxSizing: 'border-box',

  outline: 'none',
}

const miniFieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '4px',

  fontSize: '10px',

  color: '#94a3b8',
}

const miniInputStyle: React.CSSProperties = {
  width: '90px',

  minHeight: '34px',

  padding: '5px 7px',

  borderRadius: '8px',

  border: '1px solid rgba(255,255,255,0.12)',

  background: 'rgba(15,23,42,0.92)',

  color: '#fff',
}

const itemCardStyle: React.CSSProperties = {
  display: 'flex',

  alignItems: 'center',

  justifyContent: 'space-between',

  gap: '10px',

  flexWrap: 'wrap',

  padding: '10px',

  borderRadius: '11px',

  background: 'rgba(255,255,255,0.04)',

  border: '1px solid rgba(255,255,255,0.06)',
}

const mutedStyle: React.CSSProperties = {
  color: '#94a3b8',

  fontSize: '11px',

  lineHeight: 1.6,
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: '42px',

  border: 'none',

  borderRadius: '11px',

  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',

  color: '#fff',

  fontWeight: 900,

  cursor: 'pointer',

  padding: '0 14px',
}

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: '42px',

  borderRadius: '10px',

  border: '1px solid rgba(59,130,246,0.30)',

  background: 'rgba(59,130,246,0.10)',

  color: '#bfdbfe',

  fontWeight: 900,

  cursor: 'pointer',

  padding: '0 14px',
}

const dangerButtonStyle: React.CSSProperties = {
  minHeight: '32px',

  borderRadius: '9px',

  border: '1px solid rgba(239,68,68,0.30)',

  background: 'rgba(239,68,68,0.08)',

  color: '#fca5a5',

  fontWeight: 800,

  cursor: 'pointer',

  padding: '0 10px',
}

const closeButtonStyle: React.CSSProperties = {
  width: '38px',
  height: '38px',

  borderRadius: '10px',

  border: '1px solid rgba(255,255,255,0.10)',

  background: 'rgba(255,255,255,0.06)',

  color: '#fff',

  cursor: 'pointer',

  fontSize: '20px',
}
