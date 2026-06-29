import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useAuthStore } from '../../store/auth.store';
import { CASH_ACCOUNT_OPTIONS } from '../../utils/payment-method';

const PURCHASE_DRAFT_KEY = 'fony_purchase_invoice_draft_v1';

type Supplier = {
  id: number;
  name: string;
  phone?: string | null;
  balance: number;
};

type Category = {
  id: number;
  name: string;
  description?: string | null;
};

type VariantRow = {
  variant_id: number;
  product_id?: number;
  product_name: string;
  barcode?: string | null;
  size?: string | null;
  color?: string | null;
  buy_price: number;
  sell_price: number;
  stock: number;
};

type ProductOption = {
  id: number;
  name: string;
  category_name?: string | null;
  variants_count?: number;
  active_variants_count?: number;
};

type QuickProductMode = 'newProduct' | 'newVariant';

type PurchaseLine = VariantRow & {
  quantity: number;
  unit_cost: number;
};

function generateBarcodeValue() {
  const timestampPart = Date.now().toString().slice(-10);
  const randomPart = Math.floor(Math.random() * 100).toString().padStart(2, '0');

  return `2${timestampPart}${randomPart}`;
}

export default function PurchasesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [supplierSearch, setSupplierSearch] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<VariantRow[]>([]);
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const productSearchRef = useRef<HTMLInputElement | null>(null);

  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('store_cash');
  const [notes, setNotes] = useState('');

  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountDraft, setDiscountDraft] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [draftHydrated, setDraftHydrated] = useState(false);
  
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProductSaving, setQuickProductSaving] = useState(false);
  const [quickMode, setQuickMode] = useState<QuickProductMode>('newProduct');
  const [quickProductSearch, setQuickProductSearch] = useState('');
  const [quickExistingProducts, setQuickExistingProducts] = useState<ProductOption[]>([]);
  const [quickExistingProductId, setQuickExistingProductId] = useState<number | ''>('');

  const [quickProductName, setQuickProductName] = useState('');
  const [quickBarcode, setQuickBarcode] = useState('');
  const [quickSize, setQuickSize] = useState('قطعة');
  const [quickColor, setQuickColor] = useState('عام');
  const [quickBuyPrice, setQuickBuyPrice] = useState('');
  const [quickSellPrice, setQuickSellPrice] = useState('');
  const [quickQuantity, setQuickQuantity] = useState('1');

  const subTotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_cost || 0),
        0
      ),
    [lines]
  );

  const discountValue = useMemo(() => {
    const raw = Number(discountDraft || 0);
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;

    if (discountType === 'percent') {
      return Math.min(subTotal, (subTotal * Math.min(value, 100)) / 100);
    }

    return Math.min(subTotal, value);
  }, [discountDraft, discountType, subTotal]);

  const totalAmount = Math.max(0, subTotal - discountValue);

  function getDiscountedUnitCost(line: PurchaseLine) {
    const qty = Number(line.quantity || 0);
    const originalUnitCost = Number(line.unit_cost || 0);
    const lineTotal = qty * originalUnitCost;

    if (qty <= 0 || subTotal <= 0 || discountValue <= 0) {
      return originalUnitCost;
    }

    const lineDiscount = (lineTotal / subTotal) * discountValue;
    const discountedLineTotal = Math.max(0, lineTotal - lineDiscount);

    return discountedLineTotal / qty;
  }

  const paid = Math.min(Math.max(Number(paidAmount || 0), 0), totalAmount);
  const remaining = Math.max(0, totalAmount - paid);

  async function loadSuppliers(searchValue = supplierSearch) {
    const data = await window.api.getSuppliers(searchValue);
    setSuppliers(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    const rawDraft = localStorage.getItem(PURCHASE_DRAFT_KEY);

    if (!rawDraft) {
      setDraftHydrated(true);
      return;
    }

    try {
      const draft = JSON.parse(rawDraft) as {
        supplierId?: number | '';
        supplierSearch?: string;
        productSearch?: string;
        lines?: PurchaseLine[];
        paidAmount?: string;
        paymentMethod?: string;
        notes?: string;
        discountType?: 'amount' | 'percent';
        discountDraft?: string;
      };

      if (draft.supplierId !== undefined) {
        setSupplierId(draft.supplierId === '' ? '' : Number(draft.supplierId));
      }

      if (typeof draft.supplierSearch === 'string') {
        setSupplierSearch(draft.supplierSearch);
      }

      if (typeof draft.productSearch === 'string') {
        setProductSearch(draft.productSearch);
      }

      if (Array.isArray(draft.lines)) {
        setLines(draft.lines);
      }

      if (typeof draft.paidAmount === 'string') {
        setPaidAmount(draft.paidAmount);
      }

      if (typeof draft.paymentMethod === 'string') {
        setPaymentMethod(draft.paymentMethod);
      }

      if (typeof draft.notes === 'string') {
        setNotes(draft.notes);
      }

      if (draft.discountType === 'amount' || draft.discountType === 'percent') {
        setDiscountType(draft.discountType);
      }

      if (typeof draft.discountDraft === 'string') {
        setDiscountDraft(draft.discountDraft);
      }
    } catch (error) {
      console.error('Failed to load purchase draft:', error);
      localStorage.removeItem(PURCHASE_DRAFT_KEY);
    } finally {
      setDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;

    const hasDraftData = Boolean(
      supplierId ||
        supplierSearch.trim() ||
        productSearch.trim() ||
        lines.length > 0 ||
        paidAmount.trim() ||
        paymentMethod !== 'store_cash' ||
        notes.trim() ||
        discountType !== 'amount' ||
        discountDraft.trim()
    );

    if (!hasDraftData) {
      localStorage.removeItem(PURCHASE_DRAFT_KEY);
      return;
    }

    localStorage.setItem(
      PURCHASE_DRAFT_KEY,
      JSON.stringify({
        supplierId,
        supplierSearch,
        productSearch,
        lines,
        paidAmount,
        paymentMethod,
        notes,
        discountType,
        discountDraft
      })
    );
  }, [
    draftHydrated,
    supplierId,
    supplierSearch,
    productSearch,
    lines,
    paidAmount,
    paymentMethod,
    notes,
    discountType,
    discountDraft
  ]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadSuppliers(supplierSearch);
    }, 250);

    return () => clearTimeout(handle);
  }, [supplierSearch]);

  useEffect(() => {
    if (!quickProductOpen || quickMode !== 'newVariant') {
      return;
    }

    const q = quickProductSearch.trim();

    if (!q) {
      setQuickExistingProducts([]);
      setQuickExistingProductId('');
      return;
    }

    const handle = setTimeout(async () => {
      try {
        const data = await window.api.getProducts({
          search: q,
          includeInactive: false
        });

        const rows = Array.isArray(data) ? data.slice(0, 20) : [];
        setQuickExistingProducts(rows);

        if (rows.length === 1) {
          setQuickExistingProductId(Number(rows[0].id));
        }
      } catch (error) {
        console.error(error);
        setQuickExistingProducts([]);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [quickProductOpen, quickMode, quickProductSearch]);

  useEffect(() => {
    const q = productSearch.trim();

    if (!q) {
      setProductResults([]);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        const data = await window.api.getInventoryList({
          search: q,
          status: 'all',
          categoryId: categoryFilter
        });

        setProductResults(Array.isArray(data) ? data.slice(0, 20) : []);
      } catch (error) {
        console.error(error);
        setProductResults([]);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [productSearch, categoryFilter]);

  useEffect(() => {
    let mounted = true;

    window.api
      .getCategories()
      .then((data) => {
        if (!mounted) return;
        setCategories(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        console.error('Failed to load categories:', error);
        setCategories([]);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 1800);
  }

  function addLine(item: VariantRow) {
    addLineWithValues(item, 1, Number(item.buy_price || 0));
  }

  function addLineWithValues(item: VariantRow, quantityValue = 1, unitCostValue?: number) {
    const quantity = Math.max(1, Number(quantityValue || 1));
    const unitCost = Math.max(0, Number(unitCostValue ?? item.buy_price ?? 0));

    const exists = lines.find((x) => x.variant_id === item.variant_id);

    if (exists) {
      setLines((prev) =>
        prev.map((x) =>
          x.variant_id === item.variant_id
            ? {
                ...x,
                quantity: Number(x.quantity || 0) + quantity,
                unit_cost: unitCost
              }
            : x
        )
      );
    } else {
      setLines((prev) => [
        ...prev,
        {
          ...item,
          quantity,
          unit_cost: unitCost
        }
      ]);
    }

    setProductSearch('');
    setProductResults([]);

    setTimeout(() => {
      productSearchRef.current?.focus();
    }, 0);
  }

function openQuickProductModal(searchValue = productSearch) {
  const cleanValue = searchValue.trim();

  const looksLikeBarcode =
    Boolean(cleanValue) &&
    /^[0-9A-Za-z_.-]+$/.test(cleanValue) &&
    /\d/.test(cleanValue);

  setQuickMode('newProduct');
  setQuickBarcode(looksLikeBarcode ? cleanValue : '');
  setQuickProductName(looksLikeBarcode ? '' : cleanValue);
  setQuickProductSearch(looksLikeBarcode ? '' : cleanValue);
  setQuickExistingProducts([]);
  setQuickExistingProductId('');

  setQuickSize('قطعة');
  setQuickColor('عام');
  setQuickBuyPrice('');
  setQuickSellPrice('');
  setQuickQuantity('1');
  setQuickProductOpen(true);
}

  async function saveQuickProductFromPurchase() {
    const name = quickProductName.trim();
    const barcode = quickBarcode.trim();
    const size = quickSize.trim() || 'قطعة';
    const color = quickColor.trim() || 'عام';
    const buyPrice = Number(quickBuyPrice || 0);
    const sellPrice = Number(quickSellPrice || 0);
    const quantity = Math.max(1, Number(quickQuantity || 1));

    if (quickMode === 'newProduct' && !name) {
      showMessage('اكتب اسم المنتج');
      return;
    }

    if (quickMode === 'newVariant' && !quickExistingProductId) {
      showMessage('اختار المنتج الموجود الذي سيتم إضافة الصنف عليه');
      return;
    }

    if (!barcode) {
      showMessage('اكتب الباركود');
      return;
    }

    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      showMessage('سعر الشراء غير صحيح');
      return;
    }

    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      showMessage('سعر البيع غير صحيح');
      return;
    }

    setQuickProductSaving(true);

    try {
      const result =
        quickMode === 'newVariant'
          ? await window.api.addProductVariant({
              product_id: Number(quickExistingProductId),
              barcode,
              size,
              color,
              buy_price: buyPrice,
              sell_price: sellPrice,
              min_stock: 5,

              // مهم: فاتورة الشراء هي اللي هتزود المخزون
              opening_qty: 0,
              actor_id: currentUser?.id
            })
          : await window.api.createProduct({
              name,
              category_id: null,
              image_path: null,
              description: null,
              actor_id: currentUser?.id,
              variants: [
                {
                  barcode,
                  size,
                  color,
                  buy_price: buyPrice,
                  sell_price: sellPrice,
                  min_stock: 5,

                  // مهم: فاتورة الشراء هي اللي هتزود المخزون
                  opening_qty: 0
                }
              ]
            });

      if (!result?.success) {
        showMessage(
          result?.message ||
            (quickMode === 'newVariant' ? 'فشل إضافة الصنف للمنتج' : 'فشل إنشاء المنتج')
        );
        return;
      }

      const inventoryRows = await window.api.getInventoryList({
        search: barcode,
        status: 'all'
      });

      const createdVariant = Array.isArray(inventoryRows)
        ? inventoryRows.find((item: VariantRow) => String(item.barcode || '').trim() === barcode)
        : null;

      if (!createdVariant) {
        showMessage('تم الحفظ لكن لم يتم العثور على الصنف في المخزون، ابحث عنه بالباركود');
        return;
      }

      addLineWithValues(createdVariant, quantity, buyPrice);

      setQuickProductOpen(false);
      setQuickMode('newProduct');
      setQuickProductSearch('');
      setQuickExistingProducts([]);
      setQuickExistingProductId('');
      showMessage(
        quickMode === 'newVariant'
          ? 'تم إضافة الصنف للمنتج وإضافته للفاتورة'
          : 'تم إنشاء المنتج وإضافته للفاتورة'
      );
    } catch (error) {
      console.error(error);
      showMessage(
        getErrorMessage(
          error,
          quickMode === 'newVariant'
            ? 'حدث خطأ أثناء إضافة الصنف للمنتج'
            : 'حدث خطأ أثناء إنشاء المنتج'
        )
      );
    } finally {
      setQuickProductSaving(false);
    }
  }

  function handleProductSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;

    e.preventDefault();

    const q = productSearch.trim();

    if (!q) return;

    const exactBarcode = productResults.find(
      (item) => String(item.barcode || '').trim() === q
    );

    if (exactBarcode) {
      addLine(exactBarcode);
      return;
    }

    if (productResults.length === 1) {
      addLine(productResults[0]);
      return;
    }

    if (productResults.length > 1) {
      addLine(productResults[0]);
    }
  }

  function updateLine(variantId: number, patch: Partial<PurchaseLine>) {
    setLines((prev) =>
      prev.map((line) =>
        line.variant_id === variantId ? { ...line, ...patch } : line
      )
    );
  }

  function removeLine(variantId: number) {
    setLines((prev) => prev.filter((line) => line.variant_id !== variantId));
  }

  async function savePurchase() {
    if (saving) return;

    if (!supplierId) {
      showMessage('اختار المورد');
      return;
    }

    if (lines.length === 0) {
      showMessage('أضف أصناف للفاتورة');
      return;
    }

    setSaving(true);

    try {
      const result = await window.api.createPurchaseInvoice({
        supplier_id: Number(supplierId),
        sub_total: subTotal,
        discount_type: discountType,
        discount_input: Number(discountDraft || 0),
        discount_value: discountValue,
        paid_amount: Number(paidAmount || 0),
        payment_method: paymentMethod,
        notes: notes.trim() || null,
        actor_id: currentUser?.id,
        items: lines.map((line) => ({
          variant_id: line.variant_id,
          quantity: Number(line.quantity || 0),
          unit_cost: Number(getDiscountedUnitCost(line).toFixed(4))
        }))
      });

      showMessage(
        result.remaining_amount > 0
          ? `تم حفظ فاتورة الشراء، المتبقي ${money(result.remaining_amount)}`
          : 'تم حفظ فاتورة الشراء مدفوعة بالكامل'
      );

      localStorage.removeItem(PURCHASE_DRAFT_KEY);

      setSupplierId('');
      setSupplierSearch('');
      setLines([]);
      setPaidAmount('');
      setNotes('');
      setProductSearch('');
      setProductResults([]);
      setPaymentMethod('store_cash');
      setDiscountType('amount');
      setDiscountDraft('');
      } catch (error) {
        console.error('Failed to save purchase:', error);
        showMessage(getErrorMessage(error, 'حدث خطأ أثناء حفظ فاتورة الشراء'));
      } finally {
        setSaving(false);
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

  return (
    <>
      <style>
        {`
          .purchase-hidden-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          .purchase-hidden-scroll::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
          }

          .purchase-product-dropdown-item:hover {
            background: rgba(59, 130, 246, 0.16) !important;
          }
        `}
      </style>

      <div
        className="purchase-hidden-scroll"
        style={{
          display: 'grid',
          gap: '18px',
          height: '100%',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          alignContent: 'start',
          paddingBottom: '24px'
        }}
      >
        {message && (
          <div
            style={{
              position: 'fixed',
              top: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 99999,
              padding: '12px 18px',
              borderRadius: '14px',
              background: 'rgba(37,99,235,0.96)',
              color: '#fff',
              fontWeight: 800,
              boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
              pointerEvents: 'none'
            }}
          >
            {message}
          </div>
        )}

        <div className="glass-card" style={cardStyle}>
          <h2 style={{ margin: 0, textAlign: 'right' }}>فاتورة شراء</h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(260px, 1fr) minmax(220px, 1fr)',
              gap: '12px',
              direction: 'rtl'
            }}
          >
            <div style={{ display: 'grid', gap: '8px' }}>
              <label style={labelStyle}>بحث المورد</label>
              <input
                placeholder="اسم أو هاتف المورد"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <label style={labelStyle}>اختيار المورد</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
                style={inputStyle}
              >
                <option value="">اختار مورد</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} - رصيد: {Number(supplier.balance || 0).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div
          className="glass-card"
          style={{
            ...cardStyle,
            overflow: 'visible',
            position: 'relative'
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: '12px',
              position: 'sticky',
              top: 0,
              zIndex: 50,
              background: 'var(--panel-2)',
              paddingBottom: '12px',
              borderRadius: '14px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                direction: 'rtl'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                  flexWrap: 'wrap',
                  direction: 'rtl'
                }}
              >
                <h3 style={{ margin: 0, textAlign: 'right' }}>إضافة أصناف</h3>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{
                    ...inputStyle,
                    width: '220px',
                    maxWidth: '100%'
                  }}
                >
                  <option value="all">كل التصنيفات</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => openQuickProductModal(productSearch)}
                style={quickAddSmallButtonStyle}
              >
                + إضافة سريع
              </button>
            </div>

            <div
              style={{
                position: 'relative',
                direction: 'rtl'
              }}
            >
              <input
                ref={productSearchRef}
                placeholder="بحث عن منتج / باركود / مقاس / لون"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onKeyDown={handleProductSearchKeyDown}
                style={{ ...inputStyle, width: '100%' }}
              />

              {productResults.length > 0 && (
                <div
                  className="theme-popover theme-dropdown purchase-product-dropdown purchase-hidden-scroll"
                  style={{
                    position: 'absolute',
                    top: '52px',
                    right: 0,
                    left: 0,
                    zIndex: 9999,
                    background: '#111827',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: '12px',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.45)'
                  }}
                >
                  {productResults.map((item) => (
                    <button
                      key={item.variant_id}
                      className="purchase-product-dropdown-item"
                      type="button"
                      onClick={() => addLine(item)}
                      style={{
                        width: '100%',
                        border: 'none',
                        background: 'transparent',
                        color: '#fff',
                        padding: '12px',
                        textAlign: 'right',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: '4px'
                      }}
                    >
                      <strong>{item.product_name}</strong>
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                        {item.barcode || '—'} | {item.size || '—'} | {item.color || '—'} |
                        شراء: {money(item.buy_price)} | بيع: {money(item.sell_price)} |
                        المخزون الحالي: {item.stock}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>   

            <div
              className="purchase-hidden-scroll"
              style={{
                overflowX: 'auto',
                overflowY: 'visible',
                maxWidth: '100%'
              }}
            >
              <table
                style={{
                  width: '100%',
                  minWidth: '880px',
                  borderCollapse: 'collapse',
                  direction: 'rtl'
                }}
              >
                <thead>
                  <tr style={{ color: '#cbd5e1', textAlign: 'right' }}>
                    <th style={thStyle}>الصنف</th>
                    <th style={thStyle}>الكمية</th>
                    <th style={thStyle}>سعر الشراء</th>
                    <th style={thStyle}>بعد الخصم</th>
                    <th style={thStyle}>الإجمالي</th>
                    <th style={thStyle}>حذف</th>
                  </tr>
                </thead>

                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={line.variant_id}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: 'grid', gap: '4px', minWidth: '170px' }}>
                          <strong>{line.product_name}</strong>
                          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            {line.size || '—'} / {line.color || '—'} / مخزون: {line.stock}
                          </span>

                          <span style={{ color: '#22c55e', fontSize: '12px', fontWeight: 900 }}>
                            سعر البيع: {money(line.sell_price)}
                          </span>
                          {line.barcode && (
                            <span style={{ color: '#64748b', fontSize: '11px' }}>
                              {line.barcode}
                            </span>
                          )}
                        </div>
                      </td>

                      <td style={tdStyle}>
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.variant_id, {
                              quantity: Math.max(1, Number(e.target.value || 1))
                            })
                          }
                          style={{ ...inputStyle, width: '110px', textAlign: 'center' }}
                        />
                      </td>

                      <td style={tdStyle}>
                        <input
                          type="number"
                          min={0}
                          value={line.unit_cost}
                          onChange={(e) =>
                            updateLine(line.variant_id, {
                              unit_cost: Math.max(0, Number(e.target.value || 0))
                            })
                          }
                          style={{ ...inputStyle, width: '130px', textAlign: 'center' }}
                        />
                      </td>

                      <td style={{ ...tdStyle, fontWeight: 900, color: '#6ee7b7' }}>
                        {money(getDiscountedUnitCost(line))}
                      </td>

                      <td style={{ ...tdStyle, fontWeight: 900 }}>
                        {money(Number(line.quantity || 0) * getDiscountedUnitCost(line))}
                      </td>

                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => removeLine(line.variant_id)}
                          style={dangerButtonStyle}
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}

                  {lines.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        style={{
                          ...tdStyle,
                          textAlign: 'center',
                          color: '#94a3b8',
                          padding: '26px'
                        }}
                      >
                        لا توجد أصناف
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
        </div>

        <div className="glass-card" style={cardStyle}>
          <h3 style={{ margin: 0, textAlign: 'right' }}>الدفع والحساب</h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
              direction: 'rtl'
            }}
          >
            <div style={fieldStyle}>
              <label style={labelStyle}>الإجمالي قبل الخصم</label>
              <input value={money(subTotal)} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>نوع الخصم</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
                style={inputStyle}
              >
                <option value="amount">خصم جنيه</option>
                <option value="percent">خصم %</option>
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>الخصم</label>
              <input
                type="number"
                min={0}
                value={discountDraft}
                onChange={(e) => setDiscountDraft(e.target.value)}
                placeholder={discountType === 'percent' ? 'مثال: 5' : 'مثال: 100'}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>قيمة الخصم</label>
              <input value={money(discountValue)} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>الإجمالي بعد الخصم</label>
              <input value={money(totalAmount)} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>المدفوع الآن</label>
              <input
                type="number"
                min={0}
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>المتبقي للمورد</label>
              <input value={money(remaining)} readOnly style={{ ...inputStyle, opacity: 0.7 }} />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>الحساب المالي</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                style={inputStyle}
              >
                {CASH_ACCOUNT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>ملاحظات</label>
            <input
              placeholder="أي ملاحظات على فاتورة الشراء"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="button"
              onClick={savePurchase}
              disabled={saving || lines.length === 0 || !supplierId}
              style={{
                ...primaryButtonStyle,
                opacity: saving || lines.length === 0 || !supplierId ? 0.6 : 1,
                cursor: saving || lines.length === 0 || !supplierId ? 'not-allowed' : 'pointer'
              }}
            >
              {saving ? 'جاري الحفظ...' : 'حفظ فاتورة الشراء'}
            </button>
          </div>
        </div>
      </div>
      {quickProductOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            background: 'rgba(0,0,0,0.65)',
            display: 'grid',
            placeItems: 'center',
            padding: '18px'
          }}
        >
          <div
            className="glass-card"
            style={{
              width: 'min(760px, 100%)',
              borderRadius: '18px',
              padding: '18px',
              display: 'grid',
              gap: '14px',
              direction: 'rtl'
            }}
          >
            <h3 style={{ margin: 0 }}>إضافة سريع للفاتورة</h3>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setQuickMode('newProduct')}
                style={quickModeButtonStyle(quickMode === 'newProduct')}
              >
                منتج جديد
              </button>

              <button
                type="button"
                onClick={() => {
                  setQuickMode('newVariant');
                  setQuickProductSearch(quickProductSearch || quickProductName || productSearch);
                }}
                style={quickModeButtonStyle(quickMode === 'newVariant')}
              >
                صنف لمنتج موجود
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px'
              }}
            >
              {quickMode === 'newProduct' ? (
                <div style={fieldStyle}>
                  <label style={labelStyle}>اسم المنتج</label>
                  <input
                    value={quickProductName}
                    onChange={(e) => setQuickProductName(e.target.value)}
                    style={inputStyle}
                    autoFocus
                  />
                </div>
              ) : (
                <div style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>اختيار المنتج الموجود</label>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 320px)',
                      gap: '8px'
                    }}
                  >
                    <input
                      placeholder="اكتب اسم المنتج الموجود"
                      value={quickProductSearch}
                      onChange={(e) => {
                        setQuickProductSearch(e.target.value);
                        setQuickExistingProductId('');
                      }}
                      style={inputStyle}
                      autoFocus
                    />

                    <select
                      value={quickExistingProductId}
                      onChange={(e) =>
                        setQuickExistingProductId(e.target.value ? Number(e.target.value) : '')
                      }
                      style={inputStyle}
                    >
                      <option value="">اختار المنتج</option>
                      {quickExistingProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} - أصناف: {Number(product.active_variants_count ?? product.variants_count ?? 0)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div style={fieldStyle}>
                <label style={labelStyle}>الباركود</label>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: '8px'
                  }}
                >
                  <input
                    value={quickBarcode}
                    onChange={(e) => setQuickBarcode(e.target.value)}
                    style={inputStyle}
                  />

                  <button
                    type="button"
                    onClick={() => setQuickBarcode(generateBarcodeValue())}
                    style={smallButtonStyle}
                  >
                    توليد
                  </button>
                </div>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>المقاس</label>
                <input
                  value={quickSize}
                  onChange={(e) => setQuickSize(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>اللون</label>
                <input
                  value={quickColor}
                  onChange={(e) => setQuickColor(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>سعر الشراء</label>
                <input
                  type="number"
                  min={0}
                  value={quickBuyPrice}
                  onChange={(e) => setQuickBuyPrice(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>سعر البيع</label>
                <input
                  type="number"
                  min={0}
                  value={quickSellPrice}
                  onChange={(e) => setQuickSellPrice(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>الكمية في الفاتورة</label>
                <input
                  type="number"
                  min={1}
                  value={quickQuantity}
                  onChange={(e) => setQuickQuantity(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void saveQuickProductFromPurchase()}
                disabled={quickProductSaving}
                style={{
                  ...primaryButtonStyle,
                  opacity: quickProductSaving ? 0.6 : 1
                }}
              >
                {quickProductSaving
                  ? 'جاري الحفظ...'
                  : quickMode === 'newVariant'
                    ? 'حفظ الصنف وإضافته للفاتورة'
                    : 'حفظ المنتج وإضافته للفاتورة'}
              </button>

              <button
                type="button"
                onClick={() => setQuickProductOpen(false)}
                style={{
                  ...dangerButtonStyle,
                  height: '44px'
                }}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function money(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`;
}

const cardStyle: CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  display: 'grid',
  gap: '14px'
};

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: '8px'
};

const labelStyle: CSSProperties = {
  color: '#cbd5e1',
  fontWeight: 800
};

const inputStyle: CSSProperties = {
  height: '44px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  direction: 'rtl',
  boxSizing: 'border-box'
};

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  height: '44px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 18px',
  cursor: 'pointer'
};

const quickAddSmallButtonStyle: CSSProperties = {
  border: 'none',
  height: '34px',
  borderRadius: '9px',
  background: 'linear-gradient(135deg, #16a34a, #22c55e)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 12px',
  cursor: 'pointer',
  fontSize: '12px',
  whiteSpace: 'nowrap'
};

const smallButtonStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.10)',
  height: '44px',
  minWidth: '82px',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontWeight: 900,
  padding: '0 12px',
  cursor: 'pointer'
};

function quickModeButtonStyle(active: boolean): CSSProperties {
  return {
    border: active ? '1px solid rgba(34,197,94,0.70)' : '1px solid rgba(255,255,255,0.10)',
    height: '38px',
    borderRadius: '10px',
    background: active ? 'rgba(34,197,94,0.20)' : 'rgba(255,255,255,0.05)',
    color: active ? '#bbf7d0' : '#fff',
    fontWeight: 900,
    padding: '0 14px',
    cursor: 'pointer'
  };
}

const dangerButtonStyle: CSSProperties = {
  border: '1px solid #ef4444',
  height: '36px',
  borderRadius: '8px',
  background: 'rgba(239,68,68,0.10)',
  color: '#fca5a5',
  fontWeight: 800,
  padding: '0 12px',
  cursor: 'pointer'
};

const thStyle: CSSProperties = {
  padding: '10px 8px',
  fontWeight: 800,
  whiteSpace: 'nowrap',
  fontSize: '13px'
};

const tdStyle: CSSProperties = {
  padding: '10px 8px',
  color: '#e5e7eb',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  verticalAlign: 'middle'
};