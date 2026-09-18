export type PromotionSnapshotDisplay =
  | {
      promotion_name?: string | null

      promotion_type?: string | null

      promotion_value?: number | null

      buy_qty?: number | null

      free_qty?: number | null

      scope_type?: string | null
    }
  | null
  | undefined

function numberText(value: unknown) {
  const number = Number(value || 0)

  if (!Number.isFinite(number)) {
    return '0'
  }

  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

export function getPromotionTypeLabel(type?: string | null) {
  switch (type) {
    case 'percent':
      return 'خصم نسبة مئوية'

    case 'fixed_per_item':
      return 'خصم مبلغ لكل قطعة'

    case 'fixed_invoice':
      return 'خصم مبلغ على الفاتورة'

    case 'buy_x_get_y':
      return 'اشتري وخد هدية'

    default:
      return 'نوع العرض غير محفوظ تاريخيًا'
  }
}

export function getPromotionRulesText(snapshot: PromotionSnapshotDisplay) {
  if (!snapshot) {
    return 'شروط العرض التاريخية غير محفوظة'
  }

  switch (snapshot.promotion_type) {
    case 'percent':
      return `خصم ${numberText(snapshot.promotion_value)}%`

    case 'fixed_per_item':
      return `خصم ${numberText(snapshot.promotion_value)} ج.م لكل قطعة مؤهلة`

    case 'fixed_invoice':
      return `خصم ${numberText(snapshot.promotion_value)} ج.م على الفاتورة`

    case 'buy_x_get_y':
      return `اشتري ${numberText(snapshot.buy_qty)} وخد ${numberText(
        snapshot.free_qty,
      )} هدية`

    default:
      return 'شروط العرض التاريخية غير معروفة'
  }
}

export function getPromotionScopeLabel(snapshot: PromotionSnapshotDisplay) {
  if (!snapshot) {
    return 'النطاق غير محفوظ تاريخيًا'
  }

  switch (snapshot.scope_type) {
    case 'all':
      return 'كل المنتجات'

    case 'category':
      return 'تصنيف محدد وقت البيع'

    case 'products':
      return 'منتجات محددة وقت البيع'

    default:
      return 'نطاق غير معروف'
  }
}
