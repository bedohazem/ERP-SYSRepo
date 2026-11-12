import { useEffect, useMemo, useState } from 'react';
import {
  CASH_ACCOUNT_OPTIONS,
  ADMIN_CASH_ACCOUNT_OPTIONS,
} from '../utils/payment-method';
import {
  getPromotionRulesText,
  getPromotionScopeLabel,
  getPromotionTypeLabel,
} from '../utils/promotion-display';
import { calculateExchangeDiscount } from '../../shared/exchange-discount';
import { formatMoney, roundMoney } from '../../shared/money';
import SelectedProductSummary from './SelectedProductSummary';

type ExchangeUnit = {
  id: number;
  promotion_group_id: string;

  original_sale_item_id: number;

  current_variant_id: number;
  current_unit_price: number;
  effective_promotion_discount_value: number;
  current_exchange_discount_value: number;
  current_is_gift: number;

  is_returned: number;

  current_product_id: number;
  current_product_name: string;
  current_category_id: number | null;

  current_barcode?: string | null;
  current_size?: string | null;
  current_color?: string | null;
};

type PromotionSnapshot = {
  promotion_id: number;

  promotion_type: string;
  promotion_name: string;
  promotion_value: number;

  buy_qty: number | null;

  free_qty: number | null;

  scope_type: string;

  category_id: number | null;

  product_ids: number[];
};

type ExchangeGroup = {
  promotion_group_id: string;

  group_kind: 'promotion' | 'regular';

  retained_normal_discount_after_exchange: number;

  promotion_id?: number | null;

  promotion_snapshot?: PromotionSnapshot | null;
  units: ExchangeUnit[];
};

type ExchangeState = {
  sale: any;
  payments: Array<{
    payment_method: string;
    amount: number;
  }>;
  snapshot: PromotionSnapshot | null;

  snapshots: PromotionSnapshot[];

  loyalty_snapshot?: {
    enabled: boolean;

    earn_amount: number;
    earn_points: number;

    point_value: number;

    min_redeem_points: number;

    source: string;

    is_exact: boolean;
  } | null;

  groups: ExchangeGroup[];
  financials: {
    original_normal_discount_value: number;
    original_loyalty_discount_value: number;

    current_sub_total: number;
    current_promotion_discount_value: number;

    current_grand_total: number;
    current_exchange_discount_value: number;

    total_return_value: number;
    net_grand_total: number;
  };
};

type ExchangeDraft = {
  promotion_unit_id: number;

  current_variant_id: number;
  current_product_name: string;
  current_size?: string | null;
  current_color?: string | null;
  current_unit_price: number;

  query: string;
  results: any[];
  new_variant: any | null;
};

type ActiveExchangePromotion = {
  id: number;
  name: string;
  type: 'percent' | 'fixed_per_item' | 'fixed_invoice' | 'buy_x_get_y';
  value: number;
  scope_type: 'all' | 'category' | 'products';
  category_id?: number | null;
  product_ids?: number[];
};

function getReplacementOffer(
  variant: any,
  promotions: ActiveExchangePromotion[],
): { name: string; discount: number } | null {
  if (!variant) {
    return null;
  }

  const price = roundMoney(Math.max(0, Number(variant.sell_price || 0)));

  for (const promotion of promotions) {
    const eligible =
      promotion.scope_type === 'all' ||
      (promotion.scope_type === 'category' &&
        Number(variant.category_id) === Number(promotion.category_id)) ||
      (promotion.scope_type === 'products' &&
        (promotion.product_ids || [])
          .map(Number)
          .includes(Number(variant.product_id)));

    if (!eligible) {
      continue;
    }

    const value = Math.max(0, Number(promotion.value || 0));

    let discount = 0;

    if (promotion.type === 'percent') {
      discount = roundMoney(price * (Math.min(value, 100) / 100));
    } else if (
      promotion.type === 'fixed_per_item' ||
      promotion.type === 'fixed_invoice'
    ) {
      discount = roundMoney(value);
    }

    /*
     * الاستبدال العادي لقطعة واحدة
     * لا يحقق عرض اشتري وخد بمفرده.
     *
     * مجموعات اشتري وخد التاريخية
     * لها حساب مستقل موجود بالفعل.
     */
    discount = roundMoney(Math.min(price, discount));

    if (discount > 0) {
      return {
        name: promotion.name,
        discount,
      };
    }
  }

  return null;
}

type Props = {
  saleId: number | null;
  userId: number | null;
  isAdmin?: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
};

function money(value: unknown) {
  return formatMoney(value);
}

function resolveCashAccount(method?: string | null) {
  switch (method) {
    case 'store_cash':
    case 'store_safe':
    case 'owner_cash':
    case 'owner_bank':
    case 'owner_vodafone':
    case 'fawry_machine':
      return method;

    case 'cash':
      return 'store_cash';

    case 'card':
      return 'fawry_machine';

    case 'wallet':
      return 'owner_vodafone';

    case 'bank':
    case 'bank_transfer':
      return 'owner_bank';

    default:
      return 'store_cash';
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  const match = raw.match(/Error invoking remote method '[^']+': Error: (.*)$/);

  return match?.[1] || raw || fallback;
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
  };
}

export default function SaleExchangeModal({
  saleId,
  userId,
  isAdmin = false,
  onClose,
  onSuccess,
}: Props) {
  const [state, setState] = useState<ExchangeState | null>(null);

  const [activePromotions, setActivePromotions] = useState<
    ActiveExchangePromotion[]
  >([]);

  const [groupId, setGroupId] = useState('');

  const [drafts, setDrafts] = useState<ExchangeDraft[]>([]);

  const [paymentAccount, setPaymentAccount] = useState('');

  const [reason, setReason] = useState('');

  const [discountType, setDiscountType] = useState<'amount' | 'percent'>(
    'amount',
  );
  const [discountInput, setDiscountInput] = useState('');
  const discountInputNumber = Number(discountInput || 0);
  const discountIsValid =
    Number.isFinite(discountInputNumber) &&
    discountInputNumber >= 0 &&
    (discountType !== 'percent' || discountInputNumber <= 100);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');

  const [pendingSearch, setPendingSearch] = useState<{
    unitId: number;
    query: string;
  } | null>(null);

  const [activeSearchUnitId, setActiveSearchUnitId] = useState<number | null>(
    null,
  );

  const [isSearching, setIsSearching] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);

  useEffect(() => {
    if (!saleId) {
      setPendingSearch(null);
      setActiveSearchUnitId(null);
      setActiveResultIndex(-1);
      setIsSearching(false);
      setState(null);
      setGroupId('');
      setDrafts([]);
      setReason('');
      setDiscountType('amount');
      setDiscountInput('');
      setError('');
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      setDrafts([]);
      setDiscountType('amount');
      setDiscountInput('');
      setState(null);
      setActivePromotions([]);

      try {
        const [result, promotions] = await Promise.all([
          window.api.getSaleExchangeState(Number(saleId)),
          window.api.getActivePromotions(),
        ]);

        if (cancelled) {
          return;
        }

        const activeGroups = (result.groups || []).filter(
          (group) =>
            group.units.length > 0 &&
            group.units.every((unit) => Number(unit.is_returned || 0) === 0),
        );

        if (activeGroups.length === 0) {
          throw new Error('لا توجد قطع متاحة للاستبدال في هذه الفاتورة');
        }

        const nextState: ExchangeState = {
          sale: result.sale,
          payments: result.payments || [],
          snapshot: result.snapshot || null,
          snapshots: Array.isArray(result.snapshots) ? result.snapshots : [],

          loyalty_snapshot: result.loyalty_snapshot || null,

          groups: activeGroups,

          financials: result.financials,
        };

        setActivePromotions(Array.isArray(promotions) ? promotions : []);

        setState(nextState);

        setGroupId(String(activeGroups[0].promotion_group_id));

        const originalPayments = Array.isArray(result.payments)
          ? result.payments.filter(
              (payment: any) => Number(payment.amount || 0) > 0,
            )
          : [];

        if (originalPayments.length > 1) {
          setPaymentAccount('');
        } else if (originalPayments.length === 1) {
          setPaymentAccount(
            resolveCashAccount(originalPayments[0].payment_method),
          );
        } else {
          setPaymentAccount(resolveCashAccount(result.sale?.payment_method));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, 'تعذر تحميل بيانات الاستبدال'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const selectedGroup = useMemo(() => {
    return (
      state?.groups.find(
        (group) => String(group.promotion_group_id) === String(groupId),
      ) || null
    );
  }, [state, groupId]);

  const selectedPromotionSnapshot = selectedGroup?.promotion_snapshot || null;

  const selectedIsPromotion = Boolean(
    selectedGroup?.group_kind === 'promotion' &&
    selectedPromotionSnapshot?.promotion_type === 'buy_x_get_y',
  );

  const recordedPromotionDiscount = Number(
    state?.sale?.promotion_discount_value || 0,
  );

  const hasRecordedPromotion =
    recordedPromotionDiscount > 0 &&
    Boolean(state?.sale?.promotion_id || state?.sale?.promotion_name);

  const promotionName = String(state?.sale?.promotion_name || 'عرض');

  const historicalPromotionName = String(
    selectedPromotionSnapshot?.promotion_name || promotionName,
  );

  const promotionTypeLabel = getPromotionTypeLabel(
    selectedPromotionSnapshot?.promotion_type,
  );

  const promotionRulesText = getPromotionRulesText(selectedPromotionSnapshot);

  const promotionScopeLabel = getPromotionScopeLabel(selectedPromotionSnapshot);

  const preview = useMemo(() => {
    if (!state || !selectedGroup) {
      return {
        oldTotal: 0,
        newTotal: 0,

        difference: 0,
        exchangeDiscount: 0,
        positiveDifference: 0,

        debtReduction: 0,
        cashRefund: 0,
        cashCollection: 0,
        cashDifference: 0,

        currentInvoiceNet: 0,
        nextInvoiceNet: 0,
      };
    }

    const oldUnits = selectedGroup.units.map((unit) => ({
      id: Number(unit.id),

      price: Number(unit.current_unit_price || 0),

      isGift: Number(unit.current_is_gift || 0) === 1,

      promotionDiscount: Number(unit.effective_promotion_discount_value || 0),
    }));

    const oldGroupGross = roundMoney(
      oldUnits.reduce((sum, unit) => sum + unit.price, 0),
    );

    const oldGroupPromotionDiscount = roundMoney(
      oldUnits.reduce(
        (sum, unit) =>
          sum +
          (selectedIsPromotion
            ? unit.isGift
              ? unit.price
              : 0
            : unit.promotionDiscount),
        0,
      ),
    );

    const oldTotal = roundMoney(oldGroupGross - oldGroupPromotionDiscount);

    const nextUnits = selectedGroup.units.map((unit) => {
      const draft = drafts.find(
        (item) => Number(item.promotion_unit_id) === Number(unit.id),
      );

      const offer =
        !selectedIsPromotion && draft?.new_variant
          ? getReplacementOffer(draft.new_variant, activePromotions)
          : null;

      return {
        id: Number(unit.id),

        price: Number(
          draft?.new_variant?.sell_price ?? unit.current_unit_price ?? 0,
        ),

        promotionDiscount: selectedIsPromotion
          ? 0
          : draft?.new_variant
            ? Number(offer?.discount || 0)
            : Number(unit.effective_promotion_discount_value || 0),
      };
    });

    const freeQty = selectedIsPromotion
      ? Math.max(
          0,
          Math.floor(Number(selectedPromotionSnapshot?.free_qty || 0)),
        )
      : 0;

    const giftIds = selectedIsPromotion
      ? new Set(
          [...nextUnits]
            .sort((a, b) => a.price - b.price || a.id - b.id)
            .slice(0, freeQty)
            .map((unit) => unit.id),
        )
      : new Set<number>();

    const newGroupGross = roundMoney(
      nextUnits.reduce((sum, unit) => sum + unit.price, 0),
    );

    const newGroupPromotionDiscount = roundMoney(
      nextUnits.reduce(
        (sum, unit) =>
          sum +
          (selectedIsPromotion
            ? giftIds.has(unit.id)
              ? unit.price
              : 0
            : unit.promotionDiscount),
        0,
      ),
    );

    const newTotal = roundMoney(newGroupGross - newGroupPromotionDiscount);

    /*
     * Recalculate the whole invoice exactly
     * like the Backend does.
     */
    const nextSubTotal = roundMoney(
      Number(state.financials.current_sub_total || 0) -
        oldGroupGross +
        newGroupGross,
    );

    const nextPromotionDiscount = Math.max(
      0,
      roundMoney(
        Number(state.financials.current_promotion_discount_value || 0) -
          oldGroupPromotionDiscount +
          newGroupPromotionDiscount,
      ),
    );

    const afterPromotion = Math.max(
      0,
      roundMoney(nextSubTotal - nextPromotionDiscount),
    );

    /*
     * نعتمد على الخصم المتوقع من الـBackend.
     *
     * عند الاستبدال العادي:
     * نصيب القطعة المستبدلة من الخصم ينتهي،
     * ونحتفظ بنصيب القطع التي لم تتبدل.
     *
     * عند استبدال عرض اشتري وخد:
     * نحافظ على قواعد خصم الفاتورة الأصلية.
     */
    const retainedNormalDiscount = Number(
      selectedGroup.retained_normal_discount_after_exchange,
    );

    const normalDiscount = roundMoney(
      Math.min(Math.max(0, retainedNormalDiscount), afterPromotion),
    );

    const afterNormal = Math.max(
      0,
      roundMoney(afterPromotion - normalDiscount),
    );

    const loyaltySnapshot = state.loyalty_snapshot;

    const loyaltySnapshotIsExact = Boolean(loyaltySnapshot?.is_exact);

    const pointValue = Math.max(0, Number(loyaltySnapshot?.point_value || 0));

    const minRedeemPoints = Math.max(
      0,
      Math.floor(Number(loyaltySnapshot?.min_redeem_points || 0)),
    );

    const originalRedeemedPoints = Math.max(
      0,
      Math.floor(
        Number(
          state.sale?.original_loyalty_points_redeemed ??
            state.sale?.loyalty_points_redeemed ??
            0,
        ),
      ),
    );

    const maxNextRedeemedPoints =
      loyaltySnapshotIsExact &&
      Boolean(loyaltySnapshot?.enabled) &&
      pointValue > 0
        ? Math.min(
            originalRedeemedPoints,

            Math.floor((afterNormal + 0.0000001) / pointValue),
          )
        : 0;

    const nextRedeemedPoints =
      maxNextRedeemedPoints > 0 && maxNextRedeemedPoints < minRedeemPoints
        ? 0
        : maxNextRedeemedPoints;

    const loyaltyDiscount = loyaltySnapshotIsExact
      ? roundMoney(nextRedeemedPoints * pointValue)
      : roundMoney(
          Math.min(
            Number(state.financials.original_loyalty_discount_value || 0),

            afterNormal,
          ),
        );

    // Mirror createSaleExchange: retain grants on unchanged units,
    // and cap any NEW grant by the POSITIVE amount due.
    const beforeExchangeGrandTotal = Math.max(
      0,
      roundMoney(afterNormal - loyaltyDiscount),
    );
    const previousGroupDiscount = roundMoney(
      selectedGroup.units.reduce(
        (sum, unit) => sum + Number(unit.current_exchange_discount_value || 0),
        0,
      ),
    );
    const unchangedExchangeDiscount = Math.max(
      0,
      roundMoney(
        Number(state.financials.current_exchange_discount_value || 0) -
          previousGroupDiscount,
      ),
    );
    const exchangePayableUnits = nextUnits.map((unit) => ({
      id: unit.id,
      payable: Math.max(
        0,
        roundMoney(
          unit.price -
            (selectedIsPromotion && giftIds.has(unit.id)
              ? unit.price
              : unit.promotionDiscount),
        ),
      ),
      existingDiscount: Math.max(
        0,
        Number(
          selectedGroup.units.find(
            (original) => Number(original.id) === unit.id,
          )?.current_exchange_discount_value || 0,
        ),
      ),
    }));
    const groupPayable = exchangePayableUnits.reduce(
      (sum, unit) => sum + unit.payable,
      0,
    );
    const retainedGroupDiscount = Math.min(previousGroupDiscount, groupPayable);
    const currentInvoiceNet = Number(state.financials.net_grand_total || 0);
    const provisionalNet = Math.max(
      0,
      roundMoney(
        beforeExchangeGrandTotal -
          unchangedExchangeDiscount -
          retainedGroupDiscount -
          Number(state.financials.total_return_value || 0),
      ),
    );
    const positiveDifference = Math.max(
      0,
      roundMoney(provisionalNet - currentInvoiceNet),
    );
    const exchangeDiscount = calculateExchangeDiscount({
      type: discountType,
      value: discountIsValid ? discountInputNumber : 0,
      positiveDifference,
      units: exchangePayableUnits,
    });
    const nextExchangeDiscount = roundMoney(
      unchangedExchangeDiscount + exchangeDiscount.nextGroupDiscount,
    );
    const nextGrandTotal = Math.max(
      0,
      roundMoney(beforeExchangeGrandTotal - nextExchangeDiscount),
    );

    const nextInvoiceNet = Math.max(
      0,
      roundMoney(
        nextGrandTotal - Number(state.financials.total_return_value || 0),
      ),
    );

    const difference = roundMoney(nextInvoiceNet - currentInvoiceNet);

    const currentDebt = state.sale?.customer_id
      ? Math.max(0, Number(state.sale?.remaining_amount || 0))
      : 0;

    let debtReduction = 0;
    let cashRefund = 0;
    let cashCollection = 0;

    if (difference > 0) {
      cashCollection = difference;
    }

    if (difference < 0) {
      const customerCredit = Math.abs(difference);

      debtReduction = Math.min(customerCredit, currentDebt);

      cashRefund = roundMoney(customerCredit - debtReduction);
    }

    const cashDifference = roundMoney(cashCollection - cashRefund);

    return {
      oldTotal,
      newTotal,

      difference,
      exchangeDiscount: exchangeDiscount.appliedDiscount,
      positiveDifference,

      debtReduction,
      cashRefund,
      cashCollection,
      cashDifference,

      currentInvoiceNet,
      nextInvoiceNet,
    };
  }, [
    state,
    selectedGroup,
    selectedIsPromotion,
    drafts,
    activePromotions,
    discountType,
    discountInput,
    discountIsValid,
  ]);

  useEffect(() => {
    if (!pendingSearch?.query.trim() || !selectedGroup) {
      return;
    }

    let active = true;

    const unitId = pendingSearch.unitId;
    const query = pendingSearch.query.trim();

    const unit = selectedGroup.units.find((item) => Number(item.id) === unitId);

    if (!unit) return;

    const timer = window.setTimeout(async () => {
      try {
        const results = await window.api.searchSaleVariants({
          query,
          categoryId:
            selectedGroup.group_kind === 'promotion' &&
            selectedGroup.promotion_snapshot?.scope_type === 'category'
              ? selectedGroup.promotion_snapshot.category_id
              : null,
          limit: 30,
        });

        if (!active) return;

        const eligible = (Array.isArray(results) ? results : []).filter(
          (variant: any) => {
            if (
              Number(variant.variant_id) === Number(unit.current_variant_id)
            ) {
              return false;
            }

            if (selectedGroup.group_kind === 'regular') {
              return true;
            }

            const snapshot = selectedGroup.promotion_snapshot;

            if (!snapshot) return false;

            if (snapshot.scope_type === 'all') {
              return true;
            }

            if (snapshot.scope_type === 'category') {
              return (
                Number(variant.category_id) === Number(snapshot.category_id)
              );
            }

            if (snapshot.scope_type === 'products') {
              return (snapshot.product_ids || [])
                .map(Number)
                .includes(Number(variant.product_id));
            }

            return false;
          },
        );

        setDrafts((previous) =>
          previous.map((draft) =>
            draft.promotion_unit_id === unitId &&
            draft.query === pendingSearch.query &&
            !draft.new_variant
              ? { ...draft, results: eligible }
              : draft,
          ),
        );
      } catch (searchError) {
        if (!active) return;

        setError(getErrorMessage(searchError, 'تعذر البحث عن الصنف البديل'));
      } finally {
        if (active) {
          setIsSearching(false);
        }
      }
    }, 160);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pendingSearch, selectedGroup]);

  function startSingleExchange(group: ExchangeGroup, unit: ExchangeUnit) {
    setDiscountType('amount');
    setDiscountInput('');
    setPendingSearch(null);
    setActiveSearchUnitId(null);
    setActiveResultIndex(-1);
    setIsSearching(false);
    setGroupId(String(group.promotion_group_id));

    setDrafts([createDraft(unit)]);

    setError('');
  }

  function startWholeGroupExchange(group: ExchangeGroup) {
    setDiscountType('amount');
    setDiscountInput('');
    setPendingSearch(null);
    setActiveSearchUnitId(null);
    setActiveResultIndex(-1);
    setIsSearching(false);
    setGroupId(String(group.promotion_group_id));

    setDrafts(group.units.map(createDraft));

    setError('');
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
    );

    setPendingSearch(query.trim() ? { unitId: promotionUnitId, query } : null);

    setActiveSearchUnitId(promotionUnitId);
    setActiveResultIndex(-1);
    setIsSearching(Boolean(query.trim()));
    setError('');
  }

  function chooseReplacement(promotionUnitId: number, variantId: number) {
    setDrafts((previous) =>
      previous.map((draft) => {
        if (draft.promotion_unit_id !== promotionUnitId) {
          return draft;
        }

        const variant = draft.results.find(
          (item: any) => Number(item.variant_id) === Number(variantId),
        );

        if (!variant) return draft;

        return {
          ...draft,
          query: '',
          results: [],
          new_variant: variant,
        };
      }),
    );

    setPendingSearch(null);
    setActiveSearchUnitId(null);
    setActiveResultIndex(-1);
    setIsSearching(false);
    setError('');
  }

  async function submitExchange() {
    if (saving) {
      return;
    }

    if (!saleId || !userId) {
      setError('المستخدم أو الفاتورة غير صحيحة');
      return;
    }

    if (!selectedGroup) {
      setError('اختار القطعة أو العرض المطلوب استبداله');
      return;
    }

    if (drafts.length === 0) {
      setError('اختار القطعة المطلوب استبدالها');
      return;
    }

    if (drafts.some((draft) => !draft.new_variant)) {
      setError('اختار الصنف البديل لكل قطعة محددة');
      return;
    }

    if (!discountIsValid) {
      setError('قيمة خصم الاستبدال غير صحيحة، ونسبة الخصم لا تتجاوز 100%');
      return;
    }

    if (
      (preview.cashCollection > 0 || preview.cashRefund > 0) &&
      !paymentAccount
    ) {
      setError('اختر الحساب المالي لتسوية فرق الاستبدال');

      return;
    }

    setSaving(true);
    setError('');

    try {
      const result = await window.api.createSaleExchange({
        original_sale_id: Number(saleId),

        user_id: Number(userId),

        payment_method: paymentAccount,

        reason: reason.trim() || null,

        discount_type: discountType,
        discount_input: discountInputNumber,

        items: drafts.map((draft) => ({
          promotion_unit_id: draft.promotion_unit_id,

          new_variant_id: Number(draft.new_variant.variant_id),
        })),
      });

      let settlement = 'بدون فرق مالي';

      if (Number(result.amount_to_collect || 0) > 0) {
        settlement = `تم تحصيل ${money(result.amount_to_collect)}`;
      } else if (Number(result.difference_amount || 0) < 0) {
        const parts: string[] = [];

        if (Number(result.debt_reduction_amount || 0) > 0) {
          parts.push(`خصم من المديونية ${money(result.debt_reduction_amount)}`);
        }

        if (Number(result.amount_to_refund || 0) > 0) {
          parts.push(`رد للعميل ${money(result.amount_to_refund)}`);
        }

        settlement = parts.join(' — ') || 'تم تسوية فرق الاستبدال';
      }

      onSuccess(
        `تم الاستبدال ${result.exchangeCode} — ${settlement}` +
          (Number(result.exchange_discount_value || 0) > 0
            ? ` — خصم استبدال ${money(result.exchange_discount_value)}`
            : ''),
      );
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'تعذر حفظ الاستبدال'));
    } finally {
      setSaving(false);
    }
  }

  if (!saleId) {
    return null;
  }

  const readyToSave =
    discountIsValid &&
    drafts.length > 0 &&
    drafts.every((draft) => Boolean(draft.new_variant));

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
              {selectedIsPromotion
                ? 'يتم إعادة حساب العرض حسب شروطه الأصلية، والأرخص يصبح الهدية.'
                : 'يتم حساب سعر المنتج البديل حسب العروض النشطة، مع الحفاظ على الأسعار والخصومات المسجلة للقطع الأخرى.'}
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

        {state && hasRecordedPromotion && (
          <div
            style={{
              padding: '12px 14px',
              marginBottom: '14px',

              borderRadius: '12px',

              border: '1px solid rgba(34,197,94,0.30)',

              background: 'rgba(34,197,94,0.08)',

              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',

              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'grid',
                gap: '3px',
              }}
            >
              <span
                style={{
                  color: '#94a3b8',
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                العرض وقت البيع
              </span>

              <strong
                style={{
                  color: '#86efac',
                }}
              >
                {historicalPromotionName}
              </strong>
              <span
                style={{
                  color: '#cbd5e1',
                  fontSize: '12px',
                  fontWeight: 800,
                }}
              >
                {promotionTypeLabel}
              </span>

              <span
                style={{
                  color: '#94a3b8',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                {promotionRulesText}
                {' — '}
                النطاق: {promotionScopeLabel}
              </span>
            </div>

            <strong
              style={{
                color: '#f8fafc',
              }}
            >
              خصم العرض: {money(recordedPromotionDiscount)}
            </strong>
          </div>
        )}

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
            <div
              style={{
                display: 'grid',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              <div>
                <strong
                  style={{
                    fontSize: '16px',
                    color: '#f8fafc',
                  }}
                >
                  أصناف الفاتورة المتاحة للاستبدال
                </strong>

                <div
                  style={{
                    marginTop: '4px',
                    color: '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  اختار القطعة التي تريد استبدالها
                </div>
              </div>

              <div
                style={{
                  display: 'grid',

                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',

                  gap: '10px',
                }}
              >
                {state.groups.map((group, groupIndex) => {
                  const isPromotionGroup =
                    group.group_kind === 'promotion' &&
                    group.promotion_snapshot?.promotion_type === 'buy_x_get_y';

                  const isSelected =
                    String(groupId) === String(group.promotion_group_id) &&
                    drafts.length > 0;

                  if (isPromotionGroup) {
                    return (
                      <div
                        key={group.promotion_group_id}
                        style={{
                          padding: '14px',

                          borderRadius: '14px',

                          border: isSelected
                            ? '1px solid rgba(139,92,246,0.75)'
                            : '1px solid rgba(34,197,94,0.25)',

                          background: isSelected
                            ? 'rgba(139,92,246,0.10)'
                            : 'rgba(34,197,94,0.06)',

                          display: 'grid',
                          gap: '10px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '10px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div
                            style={{
                              display: 'grid',
                              gap: '3px',
                            }}
                          >
                            <strong
                              style={{
                                color: '#86efac',
                              }}
                            >
                              {group.promotion_snapshot?.promotion_name ||
                                promotionName}
                            </strong>

                            <span
                              style={{
                                color: '#94a3b8',
                                fontSize: '11px',
                              }}
                            >
                              مجموعة عرض {groupIndex + 1}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => startWholeGroupExchange(group)}
                            style={secondaryButtonStyle}
                          >
                            استبدال العرض كاملًا
                          </button>
                        </div>

                        {group.units.map((unit) => (
                          <div
                            key={unit.id}
                            style={{
                              display: 'grid',

                              gridTemplateColumns: 'minmax(0, 1fr) auto auto',

                              alignItems: 'center',

                              gap: '10px',

                              padding: '10px 12px',

                              borderRadius: '10px',

                              background: 'rgba(255,255,255,0.04)',

                              border: '1px solid rgba(255,255,255,0.07)',
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gap: '3px',
                              }}
                            >
                              <strong>{unit.current_product_name}</strong>

                              <span
                                style={{
                                  color: '#94a3b8',
                                  fontSize: '11px',
                                }}
                              >
                                {unit.current_size || '—'}
                                {' / '}
                                {unit.current_color || '—'}
                              </span>

                              <span
                                style={{
                                  color:
                                    Number(unit.current_is_gift) === 1
                                      ? '#6ee7b7'
                                      : '#cbd5e1',

                                  fontSize: '11px',
                                  fontWeight: 900,
                                }}
                              >
                                {Number(unit.current_is_gift) === 1
                                  ? 'هدية داخل العرض'
                                  : 'قطعة مدفوعة داخل العرض'}
                              </span>
                            </div>

                            <strong>{money(unit.current_unit_price)}</strong>

                            <button
                              type="button"
                              onClick={() => startSingleExchange(group, unit)}
                              style={smallButtonStyle}
                            >
                              استبدال
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  const unit = group.units[0];

                  if (!unit) {
                    return null;
                  }

                  return (
                    <div
                      key={group.promotion_group_id}
                      style={{
                        padding: '14px',

                        borderRadius: '14px',

                        border: isSelected
                          ? '1px solid rgba(139,92,246,0.75)'
                          : '1px solid rgba(255,255,255,0.09)',

                        background: isSelected
                          ? 'rgba(139,92,246,0.10)'
                          : 'rgba(255,255,255,0.035)',

                        display: 'grid',
                        gap: '12px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',

                          justifyContent: 'space-between',

                          alignItems: 'flex-start',

                          gap: '12px',
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gap: '5px',
                            minWidth: 0,
                          }}
                        >
                          <strong
                            style={{
                              fontSize: '14px',
                              color: '#f8fafc',
                            }}
                          >
                            {unit.current_product_name}
                          </strong>

                          <span
                            style={{
                              color: '#94a3b8',
                              fontSize: '12px',
                            }}
                          >
                            المقاس: {unit.current_size || '—'}
                            {'  •  '}
                            اللون: {unit.current_color || '—'}
                          </span>

                          {unit.current_barcode && (
                            <span
                              style={{
                                width: 'fit-content',
                                padding: '4px 9px',
                                borderRadius: '8px',
                                background: 'rgba(124,58,237,0.10)',
                                border: '1px solid rgba(124,58,237,0.35)',
                                color: '#c4b5fd',
                                fontSize: '11px',
                                fontWeight: 900,
                                direction: 'ltr',
                              }}
                            >
                              باركود: {unit.current_barcode}
                            </span>
                          )}
                        </div>

                        <strong
                          style={{
                            color: '#f8fafc',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {money(unit.current_unit_price)}
                        </strong>
                      </div>

                      <div
                        style={{
                          display: 'flex',

                          justifyContent: 'space-between',

                          alignItems: 'center',

                          gap: '10px',

                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',

                            alignItems: 'center',

                            padding: '5px 9px',

                            borderRadius: '999px',

                            background: hasRecordedPromotion
                              ? 'rgba(34,197,94,0.10)'
                              : 'rgba(148,163,184,0.10)',

                            border: hasRecordedPromotion
                              ? '1px solid rgba(34,197,94,0.28)'
                              : '1px solid rgba(148,163,184,0.20)',

                            color: hasRecordedPromotion ? '#86efac' : '#cbd5e1',

                            fontSize: '11px',

                            fontWeight: 900,
                          }}
                        >
                          {hasRecordedPromotion
                            ? `ضمن عرض: ${promotionName}`
                            : 'قطعة عادية'}
                        </span>

                        <button
                          type="button"
                          onClick={() => startSingleExchange(group, unit)}
                          style={smallButtonStyle}
                        >
                          استبدال هذه القطعة
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

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
                        position: 'relative',
                        width: '100%',
                        minWidth: 0,
                      }}
                    >
                      {draft.new_variant ? (
                        <SelectedProductSummary
                          name={draft.new_variant.product_name}
                          category={draft.new_variant.category_name}
                          size={draft.new_variant.size}
                          color={draft.new_variant.color}
                          price={Number(draft.new_variant.sell_price)}
                          originalPrice={Number(
                            draft.new_variant.original_sell_price ??
                              draft.new_variant.sell_price,
                          )}
                          onChangeProduct={() =>
                            updateDraftQuery(draft.promotion_unit_id, '')
                          }
                        />
                      ) : (
                        <input
                          autoComplete="off"
                          placeholder="اكتب اسم الصنف او الباركود البديل..."
                          value={draft.query}
                          onFocus={() =>
                            setActiveSearchUnitId(draft.promotion_unit_id)
                          }
                          onBlur={() =>
                            setActiveSearchUnitId((current) =>
                              current === draft.promotion_unit_id
                                ? null
                                : current,
                            )
                          }
                          onChange={(event) =>
                            updateDraftQuery(
                              draft.promotion_unit_id,
                              event.target.value,
                            )
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setActiveSearchUnitId(null);
                              return;
                            }

                            if (
                              event.key === 'ArrowDown' &&
                              draft.results.length > 0
                            ) {
                              event.preventDefault();
                              setActiveResultIndex((index) =>
                                Math.min(index + 1, draft.results.length - 1),
                              );
                            }

                            if (
                              event.key === 'ArrowUp' &&
                              draft.results.length > 0
                            ) {
                              event.preventDefault();
                              setActiveResultIndex((index) =>
                                Math.max(-1, index - 1),
                              );
                            }

                            if (event.key === 'Enter') {
                              event.preventDefault();

                              if (
                                activeSearchUnitId ===
                                  draft.promotion_unit_id &&
                                draft.results.length > 0
                              ) {
                                const variant =
                                  draft.results[Math.max(0, activeResultIndex)];

                                if (variant) {
                                  chooseReplacement(
                                    draft.promotion_unit_id,
                                    Number(variant.variant_id),
                                  );
                                }
                              }
                            }
                          }}
                          style={{
                            ...inputStyle,
                            width: '100%',
                          }}
                        />
                      )}

                      {activeSearchUnitId === draft.promotion_unit_id &&
                        Boolean(draft.query.trim()) &&
                        !draft.new_variant && (
                          <div
                            className="theme-popover theme-dropdown"
                            style={{
                              position: 'absolute',
                              top: 'calc(100% + 5px)',
                              right: 0,
                              left: 0,
                              zIndex: 100,
                              maxHeight: '260px',
                              overflowY: 'auto',
                              background: '#111827',
                              border: '1px solid rgba(148,163,184,0.25)',
                              borderRadius: '12px',
                              boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
                              direction: 'rtl',
                            }}
                          >
                            {isSearching &&
                            pendingSearch?.unitId ===
                              draft.promotion_unit_id ? (
                              <div
                                style={{
                                  padding: '14px',
                                  color: '#94a3b8',
                                }}
                              >
                                جاري البحث...
                              </div>
                            ) : draft.results.length === 0 ? (
                              <div
                                style={{
                                  padding: '14px',
                                  color: '#94a3b8',
                                }}
                              >
                                لا توجد أصناف بديلة مطابقة
                              </div>
                            ) : (
                              draft.results.map(
                                (variant: any, index: number) => (
                                  <button
                                    key={variant.variant_id}
                                    type="button"
                                    onMouseDown={(event) =>
                                      event.preventDefault()
                                    }
                                    onMouseEnter={() =>
                                      setActiveResultIndex(index)
                                    }
                                    onClick={() =>
                                      chooseReplacement(
                                        draft.promotion_unit_id,
                                        Number(variant.variant_id),
                                      )
                                    }
                                    style={{
                                      display: 'grid',
                                      gap: '5px',
                                      width: '100%',
                                      border: 'none',
                                      borderBottom:
                                        '1px solid rgba(148,163,184,0.10)',
                                      background:
                                        activeResultIndex === index
                                          ? 'rgba(96,165,250,0.15)'
                                          : 'transparent',
                                      color: '#f8fafc',
                                      padding: '12px 14px',
                                      textAlign: 'right',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <SelectedProductSummary
                                      variant="dropdown"
                                      name={variant.product_name}
                                      category={variant.category_name}
                                      size={variant.size}
                                      color={variant.color}
                                      price={Number(variant.sell_price)}
                                      originalPrice={Number(
                                        variant.original_sell_price ??
                                          variant.sell_price,
                                      )}
                                    />
                                  </button>
                                ),
                              )
                            )}
                          </div>
                        )}
                    </div>

                    {!selectedIsPromotion &&
                      draft.new_variant &&
                      (() => {
                        const offer = getReplacementOffer(
                          draft.new_variant,
                          activePromotions,
                        );

                        if (!offer) {
                          return null;
                        }

                        const originalPrice = Number(
                          draft.new_variant.sell_price || 0,
                        );

                        const finalPrice = roundMoney(
                          originalPrice - offer.discount,
                        );

                        return (
                          <div
                            style={{
                              display: 'grid',
                              gap: '6px',
                              padding: '12px',
                              borderRadius: '10px',
                              background: 'rgba(34,197,94,0.08)',
                              border: '1px solid rgba(34,197,94,0.30)',
                            }}
                          >
                            <strong
                              style={{
                                color: '#86efac',
                                fontSize: '13px',
                              }}
                            >
                              عرض مطبّق: {offer.name}
                            </strong>

                            <span
                              style={{
                                color: '#cbd5e1',
                                fontSize: '12px',
                              }}
                            >
                              السعر قبل العرض: {money(originalPrice)}
                              {' — '}
                              خصم العرض: {money(offer.discount)}
                            </span>

                            <strong
                              style={{
                                color: '#86efac',
                              }}
                            >
                              السعر بعد العرض: {money(finalPrice)}
                            </strong>
                          </div>
                        );
                      })()}
                  </div>
                ))}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'minmax(130px, 1fr) minmax(160px, 1fr)',
                    alignItems: 'end',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'grid', gap: '7px' }}>
                    <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                      نوع خصم الاستبدال
                    </label>
                    <select
                      value={discountType}
                      onChange={(event) =>
                        setDiscountType(
                          event.target.value as 'amount' | 'percent',
                        )
                      }
                      style={inputStyle}
                    >
                      <option value="amount">مبلغ ثابت</option>
                      <option value="percent">نسبة من فرق الاستبدال</option>
                    </select>
                  </div>
                  <div style={{ display: 'grid', gap: '7px' }}>
                    <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                      {discountType === 'amount'
                        ? 'قيمة الخصم'
                        : 'نسبة الخصم %'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={discountType === 'percent' ? 100 : undefined}
                      step="1"
                      value={discountInput}
                      onChange={(event) => setDiscountInput(event.target.value)}
                      placeholder="0"
                      style={inputStyle}
                    />
                  </div>
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      color: discountIsValid ? '#94a3b8' : '#fca5a5',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    {discountIsValid
                      ? `الفرق الموجب قبل الخصم: ${money(preview.positiveDifference)}` +
                        (preview.exchangeDiscount > 0
                          ? ` — خصم الاستبدال الفعلي: ${money(preview.exchangeDiscount)}`
                          : '')
                      : 'قيمة خصم غير صحيحة: النسبة من 0 إلى 100 والمبلغ لا يكون سالبًا'}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '10px',
                  }}
                >
                  <div style={summaryCardStyle}>
                    {selectedIsPromotion
                      ? 'قيمة العرض الحالية'
                      : 'قيمة القطعة الحالية'}
                    <strong>{money(preview.oldTotal)}</strong>
                  </div>

                  <div style={summaryCardStyle}>
                    {selectedIsPromotion
                      ? 'قيمة العرض بعد الاستبدال'
                      : 'قيمة القطعة بعد الاستبدال'}
                    <strong>{money(preview.newTotal)}</strong>
                  </div>

                  <div style={summaryCardStyle}>
                    الفرق النقدي للاستبدال
                    <strong
                      style={{
                        color:
                          preview.cashDifference > 0
                            ? '#fbbf24'
                            : preview.cashDifference < 0
                              ? '#6ee7b7'
                              : '#fff',
                      }}
                    >
                      {preview.cashDifference > 0
                        ? `على العميل ${money(preview.cashDifference)}`
                        : preview.cashDifference < 0
                          ? `للعميل ${money(Math.abs(preview.cashDifference))}`
                          : money(0)}
                    </strong>
                  </div>

                  {preview.exchangeDiscount > 0 && (
                    <div style={summaryCardStyle}>
                      خصم الاستبدال
                      <strong style={{ color: '#86efac' }}>
                        {money(preview.exchangeDiscount)}
                      </strong>
                    </div>
                  )}

                  <div style={summaryCardStyle}>
                    تعديل قيمة الفاتورة
                    <strong
                      style={{
                        color: '#c4b5fd',
                      }}
                    >
                      {preview.difference > 0
                        ? `+${money(preview.difference)}`
                        : preview.difference < 0
                          ? `-${money(Math.abs(preview.difference))}`
                          : money(0)}
                    </strong>
                  </div>

                  {preview.difference < 0 && (
                    <div
                      style={{
                        gridColumn: '1 / -1',

                        display: 'grid',

                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(200px, 1fr))',

                        gap: '10px',
                      }}
                    >
                      <div
                        style={{
                          ...summaryCardStyle,

                          background: 'rgba(245,158,11,0.08)',

                          border: '1px solid rgba(245,158,11,0.24)',
                        }}
                      >
                        تخفيض مديونية العميل
                        <strong
                          style={{
                            color: '#fcd34d',
                          }}
                        >
                          {money(preview.debtReduction)}
                        </strong>
                      </div>

                      <div
                        style={{
                          ...summaryCardStyle,

                          background: 'rgba(34,197,94,0.08)',

                          border: '1px solid rgba(34,197,94,0.24)',
                        }}
                      >
                        المبلغ الذي يُرد للعميل
                        <strong
                          style={{
                            color: '#86efac',
                          }}
                        >
                          {money(preview.cashRefund)}
                        </strong>
                      </div>
                    </div>
                  )}

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
                      <option value="">اختر الحساب المالي</option>
                      {(isAdmin
                        ? ADMIN_CASH_ACCOUNT_OPTIONS
                        : CASH_ACCOUNT_OPTIONS
                      ).map((option) => (
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
  );
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
};

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(124,58,237,0.55)',
  borderRadius: '8px',
  background: 'rgba(124,58,237,0.10)',
  color: '#c4b5fd',
  padding: '8px 10px',
  cursor: 'pointer',
  fontWeight: 700,
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #7c3aed',
  minHeight: '40px',
  borderRadius: '10px',
  background: 'transparent',
  color: '#c4b5fd',
  fontWeight: 800,
  padding: '0 14px',
  cursor: 'pointer',
};

const summaryCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: '7px',
  padding: '12px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#94a3b8',
};
