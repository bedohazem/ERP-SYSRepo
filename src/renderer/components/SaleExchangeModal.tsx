import { useEffect, useMemo, useState } from 'react'
import { CASH_ACCOUNT_OPTIONS } from '../utils/payment-method'

type ExchangeUnit = {
  id: number
  promotion_group_id: string

  original_sale_item_id: number

  current_variant_id: number
  current_unit_price: number
  current_is_gift: number

  is_returned: number

  current_product_id: number
  current_product_name: string
  current_category_id: number | null

  current_barcode?: string | null
  current_size?: string | null
  current_color?: string | null
}

type ExchangeGroup = {
  promotion_group_id: string
  units: ExchangeUnit[]
}

type ExchangeState = {
  sale: any

  snapshot: {
    promotion_type: string
    buy_qty: number | null
    free_qty: number | null

    scope_type: string
    category_id: number | null

    product_ids: number[]
  }

  groups: ExchangeGroup[]
  financials: {
    original_normal_discount_value: number
    original_loyalty_discount_value: number

    current_sub_total: number
    current_promotion_discount_value: number

    current_grand_total: number

    total_return_value: number
    net_grand_total: number
  }
}

type ExchangeDraft = {
  promotion_unit_id: number

  current_variant_id: number
  current_product_name: string
  current_size?: string | null
  current_color?: string | null
  current_unit_price: number

  query: string
  results: any[]
  new_variant: any | null
}

type Props = {
  saleId: number | null
  userId: number | null

  onClose: () => void
  onSuccess: (message: string) => void
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}

function roundMoney(value: number) {
  return Number(Number(value || 0).toFixed(2))
}

function resolveCashAccount(method?: string | null) {
  switch (method) {
    case 'store_cash':
    case 'owner_cash':
    case 'owner_bank':
    case 'owner_vodafone':
    case 'fawry_machine':
      return method

    case 'cash':
      return 'store_cash'

    case 'card':
      return 'fawry_machine'

    case 'wallet':
      return 'owner_vodafone'

    case 'bank':
    case 'bank_transfer':
      return 'owner_bank'

    default:
      return 'store_cash'
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  const match = raw.match(/Error invoking remote method '[^']+': Error: (.*)$/)

  return match?.[1] || raw || fallback
}

function createDraft(unit: ExchangeUnit): ExchangeDraft {
  return {
    promotion_unit_id: Number(unit.id),

    current_variant_id: Number(unit.current_variant_id),
    current_product_name: String(unit.current_product_name || ''),
    current_size: unit.current_size ?? null,
    current_color: unit.current_color ?? null,
    current_unit_price: Number(unit.current_unit_price || 0),

    query: '',
    results: [],
    new_variant: null,
  }
}

export default function SaleExchangeModal({
  saleId,
  userId,
  onClose,
  onSuccess,
}: Props) {
  const [state, setState] = useState<ExchangeState | null>(null)

  const [groupId, setGroupId] = useState('')

  const [drafts, setDrafts] = useState<ExchangeDraft[]>([])

  const [paymentAccount, setPaymentAccount] = useState('store_cash')

  const [reason, setReason] = useState('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')

  useEffect(() => {
    if (!saleId) {
      setState(null)
      setGroupId('')
      setDrafts([])
      setReason('')
      setError('')
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      setDrafts([])

      try {
        const result = await window.api.getSaleExchangeState(Number(saleId))

        if (cancelled) {
          return
        }

        if (result.snapshot?.promotion_type !== 'buy_x_get_y') {
          throw new Error('الاستبدال من هذه الشاشة متاح لعروض اشتري وخد فقط')
        }

        const activeGroups = (result.groups || []).filter(
          (group) =>
            group.units.length > 0 &&
            group.units.every((unit) => Number(unit.is_returned || 0) === 0),
        )

        if (activeGroups.length === 0) {
          throw new Error('لا يوجد عرض متاح للاستبدال في هذه الفاتورة')
        }

        const nextState: ExchangeState = {
          sale: result.sale,
          snapshot: result.snapshot,
          groups: activeGroups,
          financials: result.financials,
        }

        setState(nextState)

        setGroupId(String(activeGroups[0].promotion_group_id))

        setPaymentAccount(resolveCashAccount(result.sale?.payment_method))
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, 'تعذر تحميل بيانات الاستبدال'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [saleId])

  const selectedGroup = useMemo(() => {
    return (
      state?.groups.find(
        (group) => String(group.promotion_group_id) === String(groupId),
      ) || null
    )
  }, [state, groupId])

  const preview = useMemo(() => {
    if (!state || !selectedGroup) {
      return {
        oldTotal: 0,
        newTotal: 0,

        difference: 0,

        currentInvoiceNet: 0,
        nextInvoiceNet: 0,
      }
    }

    const oldUnits = selectedGroup.units.map((unit) => ({
      id: Number(unit.id),

      price: Number(unit.current_unit_price || 0),

      isGift: Number(unit.current_is_gift || 0) === 1,
    }))

    const oldGroupGross = roundMoney(
      oldUnits.reduce((sum, unit) => sum + unit.price, 0),
    )

    const oldGroupPromotionDiscount = roundMoney(
      oldUnits.reduce((sum, unit) => sum + (unit.isGift ? unit.price : 0), 0),
    )

    const oldTotal = roundMoney(oldGroupGross - oldGroupPromotionDiscount)

    const nextUnits = selectedGroup.units.map((unit) => {
      const draft = drafts.find(
        (item) => Number(item.promotion_unit_id) === Number(unit.id),
      )

      return {
        id: Number(unit.id),

        price: Number(
          draft?.new_variant?.sell_price ?? unit.current_unit_price ?? 0,
        ),
      }
    })

    const freeQty = Math.max(
      0,
      Math.floor(Number(state.snapshot.free_qty || 0)),
    )

    const giftIds = new Set(
      [...nextUnits]
        .sort((a, b) => a.price - b.price || a.id - b.id)
        .slice(0, freeQty)
        .map((unit) => unit.id),
    )

    const newGroupGross = roundMoney(
      nextUnits.reduce((sum, unit) => sum + unit.price, 0),
    )

    const newGroupPromotionDiscount = roundMoney(
      nextUnits.reduce(
        (sum, unit) => sum + (giftIds.has(unit.id) ? unit.price : 0),
        0,
      ),
    )

    const newTotal = roundMoney(newGroupGross - newGroupPromotionDiscount)

    /*
     * Recalculate the whole invoice exactly
     * like the Backend does.
     */
    const nextSubTotal = roundMoney(
      Number(state.financials.current_sub_total || 0) -
        oldGroupGross +
        newGroupGross,
    )

    const nextPromotionDiscount = Math.max(
      0,
      roundMoney(
        Number(state.financials.current_promotion_discount_value || 0) -
          oldGroupPromotionDiscount +
          newGroupPromotionDiscount,
      ),
    )

    const afterPromotion = Math.max(
      0,
      roundMoney(nextSubTotal - nextPromotionDiscount),
    )

    const normalDiscount = roundMoney(
      Math.min(
        Number(state.financials.original_normal_discount_value || 0),

        afterPromotion,
      ),
    )

    const afterNormal = Math.max(0, roundMoney(afterPromotion - normalDiscount))

    const loyaltyDiscount = roundMoney(
      Math.min(
        Number(state.financials.original_loyalty_discount_value || 0),

        afterNormal,
      ),
    )

    const nextGrandTotal = Math.max(
      0,
      roundMoney(afterNormal - loyaltyDiscount),
    )

    const nextInvoiceNet = Math.max(
      0,
      roundMoney(
        nextGrandTotal - Number(state.financials.total_return_value || 0),
      ),
    )

    const currentInvoiceNet = Number(state.financials.net_grand_total || 0)

    const difference = roundMoney(nextInvoiceNet - currentInvoiceNet)

    return {
      oldTotal,
      newTotal,

      difference,

      currentInvoiceNet,
      nextInvoiceNet,
    }
  }, [state, selectedGroup, drafts])

  function isEligibleVariant(variant: any) {
    if (!state) {
      return false
    }

    const snapshot = state.snapshot

    if (snapshot.scope_type === 'all') {
      return true
    }

    if (snapshot.scope_type === 'category') {
      return Number(variant.category_id) === Number(snapshot.category_id)
    }

    if (snapshot.scope_type === 'products') {
      return (snapshot.product_ids || [])
        .map(Number)
        .includes(Number(variant.product_id))
    }

    return false
  }

  function startSingleExchange(unit: ExchangeUnit) {
    setDrafts([createDraft(unit)])
    setError('')
  }

  function startWholeGroupExchange() {
    if (!selectedGroup) {
      return
    }

    setDrafts(selectedGroup.units.map(createDraft))

    setError('')
  }

  function updateDraftQuery(promotionUnitId: number, query: string) {
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.promotion_unit_id === promotionUnitId
          ? {
              ...draft,
              query,
              results: [],
              new_variant: null,
            }
          : draft,
      ),
    )
  }

  async function searchReplacement(promotionUnitId: number) {
    if (!state) {
      return
    }

    const draft = drafts.find(
      (item) => item.promotion_unit_id === promotionUnitId,
    )

    if (!draft) {
      return
    }

    const query = draft.query.trim()

    if (!query) {
      setError('اكتب اسم أو باركود الصنف البديل')
      return
    }

    try {
      setError('')

      const results = await window.api.searchSaleVariants({
        query,

        categoryId:
          state.snapshot.scope_type === 'category'
            ? state.snapshot.category_id
            : null,

        limit: 30,
      })

      const eligible = (results || []).filter(
        (variant: any) =>
          Number(variant.variant_id) !== Number(draft.current_variant_id) &&
          isEligibleVariant(variant),
      )

      setDrafts((previous) =>
        previous.map((item) =>
          item.promotion_unit_id === promotionUnitId
            ? {
                ...item,
                results: eligible,
                new_variant: eligible.length === 1 ? eligible[0] : null,
              }
            : item,
        ),
      )

      if (eligible.length === 0) {
        setError('لم يتم العثور على صنف بديل مؤهل لنفس العرض الأصلي')
      }
    } catch (searchError) {
      setError(getErrorMessage(searchError, 'تعذر البحث عن الصنف البديل'))
    }
  }

  function chooseReplacement(promotionUnitId: number, variantId: number) {
    setDrafts((previous) =>
      previous.map((draft) => {
        if (draft.promotion_unit_id !== promotionUnitId) {
          return draft
        }

        const variant = draft.results.find(
          (item: any) => Number(item.variant_id) === Number(variantId),
        )

        return {
          ...draft,
          new_variant: variant || null,
        }
      }),
    )
  }

  async function submitExchange() {
    if (saving) {
      return
    }

    if (!saleId || !userId) {
      setError('المستخدم أو الفاتورة غير صحيحة')
      return
    }

    if (!selectedGroup) {
      setError('اختار العرض المطلوب استبداله')
      return
    }

    if (drafts.length === 0) {
      setError('اختار قطعة واحدة أو اختار استبدال العرض كاملًا')
      return
    }

    if (drafts.some((draft) => !draft.new_variant)) {
      setError('اختار الصنف البديل لكل قطعة محددة')
      return
    }

    setSaving(true)
    setError('')

    try {
      const result = await window.api.createSaleExchange({
        original_sale_id: Number(saleId),

        user_id: Number(userId),

        payment_method: paymentAccount,

        reason: reason.trim() || null,

        items: drafts.map((draft) => ({
          promotion_unit_id: draft.promotion_unit_id,

          new_variant_id: Number(draft.new_variant.variant_id),
        })),
      })

      let settlement = 'بدون فرق مالي'

      if (Number(result.amount_to_collect || 0) > 0) {
        settlement = `تم تحصيل ${money(result.amount_to_collect)}`
      } else if (Number(result.difference_amount || 0) < 0) {
        const parts: string[] = []

        if (Number(result.debt_reduction_amount || 0) > 0) {
          parts.push(`خصم من المديونية ${money(result.debt_reduction_amount)}`)
        }

        if (Number(result.amount_to_refund || 0) > 0) {
          parts.push(`رد للعميل ${money(result.amount_to_refund)}`)
        }

        settlement = parts.join(' — ') || 'تم تسوية فرق الاستبدال'
      }

      onSuccess(`تم الاستبدال ${result.exchangeCode} — ${settlement}`)
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'تعذر حفظ الاستبدال'))
    } finally {
      setSaving(false)
    }
  }

  if (!saleId) {
    return null
  }

  const readyToSave =
    drafts.length > 0 && drafts.every((draft) => Boolean(draft.new_variant))

  return (
    <div
      className="theme-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100002,
        background: 'rgba(0,0,0,0.68)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        className="theme-modal-card"
        style={{
          width: 'min(1100px, calc(100vw - 40px))',
          maxHeight: '92vh',
          overflowY: 'auto',
          borderRadius: '18px',
          border: '1px solid rgba(255,255,255,0.10)',
          background: '#111827',
          padding: '22px',
          direction: 'rtl',
          color: '#fff',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '18px',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 6px' }}>استبدال من فاتورة #{saleId}</h3>

            <div
              style={{
                color: '#94a3b8',
                fontWeight: 700,
              }}
            >
              يتم إعادة حساب العرض حسب شروطه الأصلية، والأرخص يصبح الهدية.
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
              fontSize: '20px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '12px',
              marginBottom: '14px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.35)',
              color: '#fecaca',
              fontWeight: 800,
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div
            style={{
              padding: '30px',
              textAlign: 'center',
              color: '#94a3b8',
              fontWeight: 800,
            }}
          >
            جاري تحميل بيانات العرض...
          </div>
        )}

        {!loading && state && (
          <>
            {state.groups.length > 1 && (
              <div
                style={{
                  display: 'grid',
                  gap: '8px',
                  marginBottom: '16px',
                }}
              >
                <label
                  style={{
                    color: '#cbd5e1',
                    fontWeight: 800,
                  }}
                >
                  اختار العرض
                </label>

                <select
                  value={groupId}
                  onChange={(event) => {
                    setGroupId(event.target.value)
                    setDrafts([])
                  }}
                  style={inputStyle}
                >
                  {state.groups.map((group, index) => (
                    <option
                      key={group.promotion_group_id}
                      value={group.promotion_group_id}
                    >
                      عرض {index + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedGroup && (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>القطع الحالية داخل العرض</strong>

                  <button
                    type="button"
                    onClick={startWholeGroupExchange}
                    style={secondaryButtonStyle}
                  >
                    استبدال العرض كاملًا
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: '10px',
                    marginBottom: '18px',
                  }}
                >
                  {selectedGroup.units.map((unit) => (
                    <div
                      key={unit.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'minmax(220px, 1fr) 120px 110px 130px',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gap: '4px',
                        }}
                      >
                        <strong>{unit.current_product_name}</strong>

                        <span
                          style={{
                            color: '#94a3b8',
                            fontSize: '12px',
                          }}
                        >
                          {unit.current_size || '—'} /{' '}
                          {unit.current_color || '—'}
                        </span>
                      </div>

                      <strong>{money(unit.current_unit_price)}</strong>

                      <span
                        style={{
                          color:
                            Number(unit.current_is_gift) === 1
                              ? '#6ee7b7'
                              : '#cbd5e1',
                          fontWeight: 900,
                        }}
                      >
                        {Number(unit.current_is_gift) === 1 ? 'هدية' : 'مدفوعة'}
                      </span>

                      <button
                        type="button"
                        onClick={() => startSingleExchange(unit)}
                        style={smallButtonStyle}
                      >
                        استبدال القطعة
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {drafts.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gap: '12px',
                  padding: '14px',
                  borderRadius: '14px',
                  border: '1px solid rgba(96,165,250,0.25)',
                  background: 'rgba(37,99,235,0.08)',
                }}
              >
                <strong>اختيار الأصناف البديلة</strong>

                {drafts.map((draft) => (
                  <div
                    key={draft.promotion_unit_id}
                    style={{
                      display: 'grid',
                      gap: '8px',
                      padding: '12px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <div
                      style={{
                        color: '#cbd5e1',
                        fontWeight: 800,
                      }}
                    >
                      بدل {draft.current_product_name} —{' '}
                      {money(draft.current_unit_price)}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(200px, 1fr) 110px',
                        gap: '8px',
                      }}
                    >
                      <input
                        placeholder="اسم أو باركود الصنف البديل"
                        value={draft.query}
                        onChange={(event) =>
                          updateDraftQuery(
                            draft.promotion_unit_id,
                            event.target.value,
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()

                            void searchReplacement(draft.promotion_unit_id)
                          }
                        }}
                        style={inputStyle}
                      />

                      <button
                        type="button"
                        onClick={() =>
                          void searchReplacement(draft.promotion_unit_id)
                        }
                        style={smallButtonStyle}
                      >
                        بحث
                      </button>
                    </div>

                    {draft.results.length > 0 && (
                      <select
                        value={draft.new_variant?.variant_id || ''}
                        onChange={(event) =>
                          chooseReplacement(
                            draft.promotion_unit_id,
                            Number(event.target.value),
                          )
                        }
                        style={inputStyle}
                      >
                        <option value="">اختار الصنف البديل</option>

                        {draft.results.map((variant: any) => (
                          <option
                            key={variant.variant_id}
                            value={variant.variant_id}
                          >
                            {variant.product_name} — {variant.size || '—'} /{' '}
                            {variant.color || '—'} — {money(variant.sell_price)}
                            {' — مخزون '}
                            {Number(variant.stock || 0)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '10px',
                  }}
                >
                  <div style={summaryCardStyle}>
                    قيمة العرض الحالية
                    <strong>{money(preview.oldTotal)}</strong>
                  </div>

                  <div style={summaryCardStyle}>
                    قيمة العرض بعد الاستبدال
                    <strong>{money(preview.newTotal)}</strong>
                  </div>

                  <div style={summaryCardStyle}>
                    فرق الاستبدال الفعلي
                    <strong
                      style={{
                        color:
                          preview.difference > 0
                            ? '#fbbf24'
                            : preview.difference < 0
                              ? '#6ee7b7'
                              : '#fff',
                      }}
                    >
                      {preview.difference > 0
                        ? `على العميل ${money(preview.difference)}`
                        : preview.difference < 0
                          ? `للعميل ${money(Math.abs(preview.difference))}`
                          : money(0)}
                    </strong>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: 'rgba(255,255,255,0.04)',
                      color: '#cbd5e1',
                      fontWeight: 800,
                    }}
                  >
                    صافي الفاتورة الحالي:{' '}
                    <strong>{money(preview.currentInvoiceNet)}</strong>
                    {' → '}
                    بعد الاستبدال:{' '}
                    <strong>{money(preview.nextInvoiceNet)}</strong>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gap: '7px',
                    }}
                  >
                    <label
                      style={{
                        color: '#cbd5e1',
                        fontWeight: 800,
                      }}
                    >
                      الحساب المالي
                    </label>

                    <select
                      value={paymentAccount}
                      onChange={(event) =>
                        setPaymentAccount(event.target.value)
                      }
                      style={inputStyle}
                    >
                      {CASH_ACCOUNT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: '7px',
                    }}
                  >
                    <label
                      style={{
                        color: '#cbd5e1',
                        fontWeight: 800,
                      }}
                    >
                      سبب الاستبدال
                    </label>

                    <input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="اختياري"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-start',
                    gap: '10px',
                    marginTop: '4px',
                  }}
                >
                  <button
                    type="button"
                    disabled={saving || !readyToSave}
                    onClick={() => void submitExchange()}
                    style={{
                      ...primaryButtonStyle,
                      opacity: saving || !readyToSave ? 0.55 : 1,
                      cursor:
                        saving || !readyToSave ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {saving ? 'جاري الحفظ...' : 'تأكيد الاستبدال'}
                  </button>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={onClose}
                    style={secondaryButtonStyle}
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  height: '44px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  direction: 'rtl',
  boxSizing: 'border-box',
}

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(124,58,237,0.55)',
  borderRadius: '8px',
  background: 'rgba(124,58,237,0.10)',
  color: '#c4b5fd',
  padding: '8px 10px',
  cursor: 'pointer',
  fontWeight: 700,
}

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #7c3aed',
  minHeight: '40px',
  borderRadius: '10px',
  background: 'transparent',
  color: '#c4b5fd',
  fontWeight: 800,
  padding: '0 14px',
  cursor: 'pointer',
}

const summaryCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: '7px',
  padding: '12px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#94a3b8',
}
