import { useEffect, useMemo, useState } from 'react'

import { useAuthStore } from '../../store/auth.store'

type PromotionType = 'percent' | 'fixed_per_item' | 'fixed_invoice'

type PromotionScope = 'all' | 'category' | 'products'

type PromotionRow = {
  id: number
  name: string
  type: PromotionType
  value: number
  scope_type: PromotionScope
  category_id?: number | null
  category_name?: string | null
  is_active: number
  products_count?: number
  products_names?: string | null
}

type Category = {
  id: number
  name: string
}

type Product = {
  id: number
  name: string
  category_name?: string | null
}

const emptyForm = {
  id: null as number | null,

  name: '',

  type: 'percent' as PromotionType,

  value: '',

  scope_type: 'all' as PromotionScope,

  category_id: '',

  product_ids: [] as number[],
}

export default function PromotionsPage() {
  const user = useAuthStore((state) => state.user)

  const [promotions, setPromotions] = useState<PromotionRow[]>([])

  const [categories, setCategories] = useState<Category[]>([])

  const [products, setProducts] = useState<Product[]>([])

  const [form, setForm] = useState(emptyForm)

  const [productSearch, setProductSearch] = useState('')

  const [loading, setLoading] = useState(false)

  const [saving, setSaving] = useState(false)

  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadData()
  }, [])

  async function loadData() {
    setLoading(true)

    try {
      const [promotionRows, categoryRows, productRows] = await Promise.all([
        window.api.getPromotions(),

        window.api.getCategories({
          includeInactive: false,
        }),

        window.api.getProducts({
          search: '',
          includeInactive: false,
          categoryId: null,
        }),
      ])

      setPromotions(Array.isArray(promotionRows) ? promotionRows : [])

      setCategories(Array.isArray(categoryRows) ? categoryRows : [])

      setProducts(Array.isArray(productRows) ? productRows : [])
    } catch (error) {
      console.error('Failed to load promotions:', error)

      showMessage('تعذر تحميل العروض')
    } finally {
      setLoading(false)
    }
  }

  function showMessage(text: string) {
    setMessage(text)

    window.setTimeout(() => setMessage(''), 2200)
  }

  function resetForm() {
    setForm(emptyForm)
    setProductSearch('')
  }

  async function editPromotion(promotion: PromotionRow) {
    try {
      const details = await window.api.getPromotion(promotion.id)

      if (!details) {
        showMessage('العرض غير موجود')
        return
      }

      setForm({
        id: Number(details.id),

        name: String(details.name || ''),

        type: details.type,

        value: String(details.value ?? ''),

        scope_type: details.scope_type,

        category_id: details.category_id ? String(details.category_id) : '',

        product_ids: Array.isArray(details.product_ids)
          ? details.product_ids.map(Number)
          : [],
      })

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    } catch (error) {
      console.error('Failed to load promotion:', error)

      showMessage('تعذر فتح العرض')
    }
  }

  function toggleProduct(productId: number) {
    setForm((current) => {
      const exists = current.product_ids.includes(productId)

      return {
        ...current,

        product_ids: exists
          ? current.product_ids.filter((id) => id !== productId)
          : [...current.product_ids, productId],
      }
    })
  }

  async function savePromotion() {
    if (!form.name.trim()) {
      showMessage('اكتب اسم العرض')
      return
    }

    const value = Number(form.value)

    if (!Number.isFinite(value) || value <= 0) {
      showMessage('اكتب قيمة عرض صحيحة')
      return
    }

    setSaving(true)

    try {
      const payload = {
        name: form.name.trim(),

        type: form.type,

        value,

        scope_type: form.scope_type,

        category_id:
          form.scope_type === 'category' ? Number(form.category_id) : null,

        product_ids: form.scope_type === 'products' ? form.product_ids : [],

        actor_id: user?.id,
      }

      const result = form.id
        ? await window.api.updatePromotion({
            id: form.id,
            ...payload,
          })
        : await window.api.createPromotion(payload)

      if (result?.success === false) {
        showMessage(result.message || 'تعذر حفظ العرض')
        return
      }

      showMessage(form.id ? 'تم تعديل العرض' : 'تم إنشاء العرض')

      resetForm()
      await loadData()
    } catch (error) {
      console.error('Failed to save promotion:', error)

      showMessage('تعذر حفظ العرض')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(promotion: PromotionRow) {
    try {
      const nextActive = promotion.is_active ? 0 : 1

      const result = await window.api.togglePromotion({
        id: promotion.id,

        is_active: nextActive,

        actor_id: user?.id,
      })

      if (result?.success === false) {
        showMessage(result.message || 'تعذر تغيير حالة العرض')
        return
      }

      showMessage(nextActive ? 'تم تفعيل العرض' : 'تم إيقاف العرض')

      await loadData()
    } catch (error) {
      console.error('Failed to toggle promotion:', error)

      showMessage('تعذر تغيير حالة العرض')
    }
  }

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase()

    if (!query) {
      return products
    }

    return products.filter((product) =>
      [product.name, product.category_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [products, productSearch])

  function typeLabel(type: PromotionType, value: number) {
    if (type === 'percent') {
      return `خصم ${value}%`
    }

    if (type === 'fixed_per_item') {
      return `خصم ${value} ج لكل قطعة`
    }

    return `خصم ${value} ج على الفاتورة`
  }

  function scopeLabel(promotion: PromotionRow) {
    if (promotion.scope_type === 'category') {
      return promotion.category_name || 'تصنيف'
    }

    if (promotion.scope_type === 'products') {
      return (
        promotion.products_names || `${promotion.products_count || 0} منتجات`
      )
    }

    return 'كل المنتجات'
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '18px',
        direction: 'rtl',
      }}
    >
      {message && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'rgba(124,58,237,0.15)',
            border: '1px solid rgba(124,58,237,0.35)',
            fontWeight: 800,
          }}
        >
          {message}
        </div>
      )}

      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
              }}
            >
              {form.id ? 'تعديل العرض' : 'إضافة عرض جديد'}
            </h2>

            <p
              style={{
                color: '#94a3b8',
                margin: '6px 0 0',
              }}
            >
              عرض واحد فقط يمكن أن يكون فعالًا في نفس الوقت
            </p>
          </div>

          {form.id && (
            <button
              type="button"
              onClick={resetForm}
              style={secondaryButtonStyle}
            >
              إلغاء التعديل
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '12px',
            marginTop: '18px',
          }}
        >
          <label style={fieldStyle}>
            <span>اسم العرض</span>

            <input
              value={form.name}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  name: e.target.value,
                }))
              }
              placeholder="مثال: عرض الصيف"
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span>نوع العرض</span>

            <select
              value={form.type}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  type: e.target.value as PromotionType,
                }))
              }
              style={inputStyle}
            >
              <option value="percent">خصم نسبة %</option>

              <option value="fixed_per_item">خصم مبلغ لكل قطعة</option>

              <option value="fixed_invoice">خصم مبلغ على الفاتورة</option>
            </select>
          </label>

          <label style={fieldStyle}>
            <span>قيمة الخصم</span>

            <input
              type="number"
              min={0}
              value={form.value}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  value: e.target.value,
                }))
              }
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span>يطبق على</span>

            <select
              value={form.scope_type}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,

                  scope_type: e.target.value as PromotionScope,

                  category_id: '',

                  product_ids: [],
                }))
              }
              style={inputStyle}
            >
              <option value="all">كل المنتجات</option>

              <option value="category">تصنيف معين</option>

              <option value="products">منتجات محددة</option>
            </select>
          </label>
        </div>

        {form.scope_type === 'category' && (
          <label
            style={{
              ...fieldStyle,
              marginTop: '14px',
            }}
          >
            <span>اختار التصنيف</span>

            <select
              value={form.category_id}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,

                  category_id: e.target.value,
                }))
              }
              style={inputStyle}
            >
              <option value="">اختار التصنيف</option>

              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {form.scope_type === 'products' && (
          <div
            style={{
              marginTop: '14px',
              display: 'grid',
              gap: '10px',
            }}
          >
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="بحث عن منتج..."
              style={inputStyle}
            />

            <div
              style={{
                maxHeight: '260px',
                overflowY: 'auto',
                display: 'grid',
                gap: '6px',
                padding: '10px',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.10)',
              }}
            >
              {filteredProducts.map((product) => (
                <label
                  key={product.id}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'center',
                    padding: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.product_ids.includes(product.id)}
                    onChange={() => toggleProduct(product.id)}
                  />

                  <span>
                    {product.name}

                    {product.category_name ? ` — ${product.category_name}` : ''}
                  </span>
                </label>
              ))}
            </div>

            <div
              style={{
                color: '#c4b5fd',
                fontWeight: 800,
              }}
            >
              تم اختيار {form.product_ids.length} منتج
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={saving}
          onClick={savePromotion}
          style={{
            ...primaryButtonStyle,
            marginTop: '18px',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'جاري الحفظ...' : form.id ? 'حفظ التعديل' : 'إضافة العرض'}
        </button>
      </section>

      <section style={cardStyle}>
        <h2
          style={{
            marginTop: 0,
          }}
        >
          العروض
        </h2>

        {loading ? (
          <div>جاري التحميل...</div>
        ) : promotions.length === 0 ? (
          <div
            style={{
              color: '#94a3b8',
            }}
          >
            لا توجد عروض حتى الآن
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gap: '10px',
            }}
          >
            {promotions.map((promotion) => (
              <div
                key={promotion.id}
                style={{
                  padding: '14px',
                  borderRadius: '14px',
                  border: promotion.is_active
                    ? '1px solid rgba(34,197,94,0.55)'
                    : '1px solid rgba(255,255,255,0.10)',

                  background: promotion.is_active
                    ? 'rgba(34,197,94,0.08)'
                    : 'rgba(255,255,255,0.03)',

                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong
                      style={{
                        fontSize: '17px',
                      }}
                    >
                      {promotion.name}
                    </strong>

                    <div
                      style={{
                        marginTop: '5px',
                        color: '#cbd5e1',
                      }}
                    >
                      {typeLabel(promotion.type, Number(promotion.value))}
                    </div>

                    <div
                      style={{
                        marginTop: '4px',
                        color: '#94a3b8',
                      }}
                    >
                      على: {scopeLabel(promotion)}
                    </div>
                  </div>

                  <strong
                    style={{
                      color: promotion.is_active ? '#4ade80' : '#94a3b8',
                    }}
                  >
                    {promotion.is_active ? '● فعال' : 'متوقف'}
                  </strong>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => editPromotion(promotion)}
                    style={secondaryButtonStyle}
                  >
                    تعديل
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleActive(promotion)}
                    style={
                      promotion.is_active
                        ? dangerButtonStyle
                        : primaryButtonStyle
                    }
                  >
                    {promotion.is_active ? 'إيقاف' : 'تفعيل'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '18px',
  background: 'rgba(17,24,39,0.78)',
  border: '1px solid rgba(255,255,255,0.08)',
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: '7px',
  fontWeight: 800,
  color: '#cbd5e1',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '42px',
  padding: '0 12px',
  boxSizing: 'border-box',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  outline: 'none',
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: '40px',
  padding: '0 15px',
  border: 'none',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: 'transparent',
  border: '1px solid rgba(124,58,237,0.65)',
  color: '#c4b5fd',
}

const dangerButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: 'rgba(239,68,68,0.12)',
  border: '1px solid rgba(239,68,68,0.45)',
  color: '#fca5a5',
}
