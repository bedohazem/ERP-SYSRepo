import { useEffect, useMemo, useState } from 'react';
import BarcodePreview from '../../components/products/BarcodePreview';

type Category = {
  id: number;
  name: string;
  description: string | null;
};

type Product = {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  image_path: string | null;
  description: string | null;
  is_active: number;
  created_at: string;
};

type ProductVariant = {
  id: number;
  product_id: number;
  barcode: string;
  size: string;
  color: string;
  buy_price: number;
  sell_price: number;
  min_stock: number;
  is_active: number;
  stock: number;
};

type VariantForm = {
  barcode: string;
  size: string;
  color: string;
  buy_price: string;
  sell_price: string;
  min_stock: string;
  opening_qty: string;
};

const emptyVariant = (): VariantForm => ({
  barcode: '',
  size: '',
  color: '',
  buy_price: '',
  sell_price: '',
  min_stock: '5',
  opening_qty: '0'
});

type BarcodeItemPosition =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'above_barcode'
  | 'below_barcode'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'hidden';

type BarcodeItemAlign = 'left' | 'center' | 'right';

type BarcodePrintSettings = {
  barcode_label_width_mm: number;
  barcode_label_height_mm: number;
  barcode_copies: number;
  barcode_auto_print_after_save: boolean;

  barcode_name_font_size: number;
  barcode_name_position: BarcodeItemPosition;
  barcode_name_align: BarcodeItemAlign;

  barcode_price_font_size: number;
  barcode_price_position: BarcodeItemPosition;
  barcode_price_align: BarcodeItemAlign;

  barcode_size_font_size: number;
  barcode_size_position: BarcodeItemPosition;
  barcode_size_align: BarcodeItemAlign;

  barcode_color_font_size: number;
  barcode_color_position: BarcodeItemPosition;
  barcode_color_align: BarcodeItemAlign;

  barcode_value_font_size: number;
  barcode_value_position: BarcodeItemPosition;
  barcode_value_align: BarcodeItemAlign;

  barcode_svg_height: number;
};

export default function ProductsPage() {

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [variants, setVariants] = useState<VariantForm[]>([emptyVariant()]);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [variantsMap, setVariantsMap] = useState<Record<number, ProductVariant[]>>({});
  const [loadingVariants, setLoadingVariants] = useState<number | null>(null);

  const [printSettings, setPrintSettings] = useState<BarcodePrintSettings | null>(null);

  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVariants, setEditVariants] = useState<
    Array<{
      id: number;
      barcode: string;
      size: string;
      color: string;
      buy_price: string;
      sell_price: string;
      min_stock: string;
      is_active: number;
    }>
  >([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const [includeInactive, setIncludeInactive] = useState(false);
  
  const [includeInactiveVariants, setIncludeInactiveVariants] = useState(true);
  
  async function loadData() {
    try {
      const [cats, prods, barcodeSettings] = await Promise.all([
        window.api.getCategories(),
        window.api.getProducts({
          search,
          includeInactive
        }),
        window.api.getBarcodePrintSettings()
      ]);

      setCategories(cats);
      setProducts(prods);
      setPrintSettings(barcodeSettings);


    } catch (error) {
      console.error('Failed to load products page data:', error);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      void window.api
        .getProducts({
          search,
          includeInactive
        })
        .then(setProducts)
        .catch((error) => console.error('Failed to search products:', error));
    }, 250);

    return () => clearTimeout(handle);
  }, [search, includeInactive]);

  useEffect(() => {
  setVariantsMap({});
  setExpandedId(null);
  }, [includeInactiveVariants]);

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (variants.length === 0) return false;

    return variants.every(
      (v) =>
        v.barcode.trim() &&
        v.size.trim() &&
        v.color.trim() &&
        v.buy_price.trim() &&
        v.sell_price.trim()
    );
  }, [name, variants]);

  function updateVariant(index: number, key: keyof VariantForm, value: string) {
    setVariants((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [key]: value } : item))
    );
  }

  function addVariant() {
    setVariants((prev) => [...prev, emptyVariant()]);
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!canSave) return;

    setLoading(true);

    try {
      await window.api.createProduct({
        name: name.trim(),
        category_id: categoryId ? Number(categoryId) : null,
        description: description.trim() || null,
        image_path: null,
        variants: variants.map((v) => ({
          barcode: v.barcode.trim(),
          size: v.size.trim(),
          color: v.color.trim(),
          buy_price: Number(v.buy_price),
          sell_price: Number(v.sell_price),
          min_stock: Number(v.min_stock || 5),
          opening_qty: Number(v.opening_qty || 0)
        }))
      });

      setName('');
      setCategoryId('');
      setDescription('');
      setVariants([emptyVariant()]);
      setShowCreate(false);

      await reloadPrintSettings();
      await loadData();
    } catch (error) {
      console.error('Failed to save product:', error);
      alert('حدث خطأ أثناء حفظ المنتج');
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(productId: number) {
    if (expandedId === productId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(productId);

    if (!variantsMap[productId]) {
      setLoadingVariants(productId);

      try {
       const data = await window.api.getProductVariants({
          productId,
          includeInactive: includeInactiveVariants
        });

        setVariantsMap((prev) => ({
          ...prev,
          [productId]: data
        }));
      } catch (error) {
        console.error('Failed to load product variants:', error);
      } finally {
        setLoadingVariants(null);
      }
    }
  }

  function generateBarcodeValue(): string {
    const now = Date.now().toString().slice(-8);
    const random = Math.floor(1000 + Math.random() * 9000).toString();
    return `29${now}${random}`;
  }

  async function reloadPrintSettings() {
    try {
      const data = await window.api.getBarcodePrintSettings();
      setPrintSettings(data);
    } catch (error) {
      console.error('Failed to reload print settings:', error);
    }
  }

  function printBarcodeLabel(input: {
    productName: string;
    barcode: string;
    size: string;
    color: string;
    price: number;
  }) {
    if (!input.barcode?.trim()) {
      alert('لا يوجد باركود للطباعة');
      return;
    }

    if (!printSettings) {
      alert('إعدادات الطباعة غير جاهزة');
      return;
    }

    const widthMm = Number(printSettings.barcode_label_width_mm || 35);
    const heightMm = Number(printSettings.barcode_label_height_mm || 25);
    const copies = Math.max(1, Number(printSettings.barcode_copies || 1));
    const svgHeight = Math.max(10, Number(printSettings.barcode_svg_height || 22));

    const itemDefs = [
      {
        key: 'name',
        value: input.productName,
        fontSize: printSettings.barcode_name_font_size,
        position: printSettings.barcode_name_position,
        align: printSettings.barcode_name_align,
        className: 'name-item'
      },
      {
        key: 'price',
        value: `${input.price} ج.م`,
        fontSize: printSettings.barcode_price_font_size,
        position: printSettings.barcode_price_position,
        align: printSettings.barcode_price_align,
        className: 'price-item'
      },
      {
        key: 'size',
        value: `المقاس: ${input.size || '—'}`,
        fontSize: printSettings.barcode_size_font_size,
        position: printSettings.barcode_size_position,
        align: printSettings.barcode_size_align,
        className: 'size-item'
      },
      {
        key: 'color',
        value: `اللون: ${input.color || '—'}`,
        fontSize: printSettings.barcode_color_font_size,
        position: printSettings.barcode_color_position,
        align: printSettings.barcode_color_align,
        className: 'color-item'
      }
    ].filter((item) => item.position !== 'hidden');

    const valuePosition = printSettings.barcode_value_position;
    const valueAlign = printSettings.barcode_value_align;
    const valueFontSize = printSettings.barcode_value_font_size;

    function alignToCss(position: BarcodeItemPosition, align: BarcodeItemAlign) {
      if (position.endsWith('-left')) return 'left';
      if (position.endsWith('-right')) return 'right';
      return align;
    }

    function renderItems(position: BarcodeItemPosition) {
      return itemDefs
        .filter((item) => item.position === position)
        .map(
          (item) => `
            <div
              class="text-item ${item.className}"
              style="
                font-size:${Number(item.fontSize)}px;
                text-align:${alignToCss(item.position, item.align)};
              "
            >
              ${escapeHtml(item.value)}
            </div>
          `
        )
        .join('');
    }

    function renderBarcodeValue(position: BarcodeItemPosition) {
      if (valuePosition !== position || valuePosition === 'hidden') return '';

      return `
        <div
          class="barcode-value"
          style="
            font-size:${Number(valueFontSize)}px;
            text-align:${alignToCss(valuePosition, valueAlign)};
          "
        >
          ${escapeHtml(input.barcode)}
        </div>
      `;
    }

    const renderSingleZone = (position: BarcodeItemPosition) => {
      const textHtml = renderItems(position) + renderBarcodeValue(position);

      if (!textHtml) return '';

      return `
        <div class="zone zone-${position}">
          ${textHtml}
        </div>
      `;
    };

    const renderTripleRow = (
      leftPos: BarcodeItemPosition,
      centerPos: BarcodeItemPosition,
      rightPos: BarcodeItemPosition,
      rowClass: string
    ) => {
      const leftHtml = renderItems(leftPos) + renderBarcodeValue(leftPos);
      const centerHtml = renderItems(centerPos) + renderBarcodeValue(centerPos);
      const rightHtml = renderItems(rightPos) + renderBarcodeValue(rightPos);

      if (!leftHtml && !centerHtml && !rightHtml) return '';

      return `
        <div class="triple-row ${rowClass}">
          <div class="triple-cell left">${leftHtml}</div>
          <div class="triple-cell center">${centerHtml}</div>
          <div class="triple-cell right">${rightHtml}</div>
        </div>
      `;
    };

    const labelsHtml = Array.from({ length: copies })
      .map(
        () => `
          <div class="label">
            ${renderTripleRow('top-left', 'top', 'top-right', 'row-top')}
            ${renderSingleZone('above_barcode')}

            <div class="barcode-zone">
              <svg class="barcode"></svg>
            </div>

            ${renderSingleZone('below_barcode')}
            ${renderTripleRow('bottom-left', 'bottom', 'bottom-right', 'row-bottom')}
          </div>
        `
      )
      .join('');

    const content = `
      <html dir="ltr">
        <head>
          <title>طباعة باركود</title>
          <style>
            @page {
              size: ${widthMm}mm ${heightMm}mm;
              margin: 0;
            }

            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              background: white;
              font-family: Arial, sans-serif;
            }

            body {
              display: flex;
              flex-direction: column;
              align-items: center;
            }

            .label {
              width: ${widthMm}mm;
              height: ${heightMm}mm;
              box-sizing: border-box;
              padding: 1.5mm;
              display: grid;
              grid-template-rows: auto auto auto auto;
              gap: 0.4mm;
              page-break-after: always;
              overflow: hidden;
            }

            .label:last-child {
              page-break-after: auto;
            }

            .zone {
              width: 100%;
            }

            .zone-top,
            .zone-above_barcode,
            .zone-below_barcode,
            .zone-bottom {
              text-align: center;
            }

            .zone-top-left,
            .zone-bottom-left {
              text-align: left;
            }

            .zone-top-right,
            .zone-bottom-right {
              text-align: right;
            }

            .triple-row {
              width: 100%;
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              align-items: center;
              gap: 1mm;
            }

            .triple-cell {
              min-width: 0;
            }

            .triple-cell.left {
              text-align: left;
            }

            .triple-cell.center {
              text-align: center;
            }

            .triple-cell.right {
              text-align: right;
            }

            .text-item,
            .barcode-value {
              line-height: 1.1;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .price-item {
              font-weight: bold;
            }

            .name-item {
              font-weight: bold;
            }

            .barcode-zone {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: ${svgHeight}px;
            }

            .barcode {
              width: ${Math.max(widthMm - 4, 20)}mm;
              height: ${svgHeight}px;
              display: block;
            }
          </style>
        </head>
        <body>
          ${labelsHtml}

          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
          <script>
            const nodes = document.querySelectorAll('.barcode');

            nodes.forEach((node) => {
              JsBarcode(node, "${escapeJs(input.barcode)}", {
                format: "CODE128",
                displayValue: false,
                width: 1.05,
                height: ${svgHeight},
                margin: 0
              });
            });

            window.onload = function () {
              setTimeout(function () {
                window.print();
                window.close();
              }, 250);
            };
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=500,height=700');

    if (!printWindow) {
      alert('تعذر فتح نافذة الطباعة');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(content);
    printWindow.document.close();
  }
  
  function escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeJs(value: string) {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  async function openEditProduct(product: Product) {
    setEditingProductId(product.id);
    setEditName(product.name);
    setEditCategoryId(product.category_id ? String(product.category_id) : '');
    setEditDescription(product.description || '');

    try {
      const data = await window.api.getProductVariants({
        productId: product.id,
        includeInactive: true
      });

      setEditVariants(
        data.map((v) => ({
          id: v.id,
          barcode: v.barcode ?? '',
          size: v.size ?? '',
          color: v.color ?? '',
          buy_price: String(v.buy_price ?? 0),
          sell_price: String(v.sell_price ?? 0),
          min_stock: String(v.min_stock ?? 5),
          is_active: v.is_active ?? 1
        }))
      );
    } catch (error) {
      console.error('Failed to load edit variants:', error);
      alert('حدث خطأ أثناء تحميل بيانات المنتج');
    }
  }

  function closeEditProduct() {
    setEditingProductId(null);
    setEditName('');
    setEditCategoryId('');
    setEditDescription('');
    setEditVariants([]);
  }

  function updateEditVariant(
    index: number,
    key:
      | 'barcode'
      | 'size'
      | 'color'
      | 'buy_price'
      | 'sell_price'
      | 'min_stock',
    value: string
  ) {
    setEditVariants((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [key]: value } : item))
    );
  }

  async function handleSaveEdit() {
    if (!editingProductId) return;
    if (!editName.trim()) {
      alert('اسم المنتج مطلوب');
      return;
    }

    setSavingEdit(true);

    try {
      await window.api.updateProduct({
        id: editingProductId,
        name: editName.trim(),
        category_id: editCategoryId ? Number(editCategoryId) : null,
        description: editDescription.trim() || null,
        image_path: null
      });

      for (const variant of editVariants) {
        await window.api.updateVariant({
          id: variant.id,
          barcode: variant.barcode.trim(),
          size: variant.size.trim(),
          color: variant.color.trim(),
          buy_price: Number(variant.buy_price),
          sell_price: Number(variant.sell_price),
          min_stock: Number(variant.min_stock || 5),
          is_active: variant.is_active
        });
      }

      await loadData();

      if (expandedId === editingProductId) {
        const refreshed = await window.api.getProductVariants({
          productId: editingProductId,
          includeInactive: includeInactiveVariants
        });
        setVariantsMap((prev) => ({
          ...prev,
          [editingProductId]: refreshed
        }));
      }

      closeEditProduct();
    } catch (error) {
      console.error('Failed to save edit product:', error);
      alert('حدث خطأ أثناء حفظ التعديلات');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleProductActive(productId: number, currentState: number) {
    try {
      await window.api.toggleProductActive(productId, currentState ? 0 : 1);
      await loadData();

      if (expandedId === productId) {
        setExpandedId(null);
      }
    } catch (error) {
      console.error('Failed to toggle product active state:', error);
      alert('حدث خطأ أثناء تحديث حالة المنتج');
    }
  }

  async function handleToggleVariantActive(
    productId: number,
    variantId: number,
    currentState: number
  ) {
    try {
      await window.api.toggleVariantActive(variantId, currentState ? 0 : 1);

      const refreshed = await window.api.getProductVariants({
        productId,
        includeInactive: includeInactiveVariants
      });

      setVariantsMap((prev) => ({
        ...prev,
        [productId]: refreshed
      }));
    } catch (error) {
      console.error('Failed to toggle variant active state:', error);
      alert('حدث خطأ أثناء تحديث حالة الـ variant');
    }
  }






  return (
    <div style={{ display: 'grid', gap: '16px',minHeight: 0 }}>
      <div
        className="glass-card"
        style={{
          borderRadius: '24px',
          padding: '20px',
          display: 'grid',
          gap: '12px'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم المنتج أو التصنيف..."
            style={inputStyle}
          />

          <button onClick={() => setShowCreate(true)} style={primaryButtonStyle}>
            + إضافة منتج
          </button>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#cbd5e1'
          }}
        >
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          <span>عرض المنتجات الموقوفة</span>
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#cbd5e1'
          }}
        >
          <input
            type="checkbox"
            checked={includeInactiveVariants}
            onChange={(e) => setIncludeInactiveVariants(e.target.checked)}
          />
          <span>عرض الـ variants الموقوفة</span>
        </label>

      </div>

      <div
        className="glass-card"
        style={{ borderRadius: '24px', padding: '20px' }}
      >
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
          المنتجات
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          {products.length === 0 ? (
            <div style={{ color: '#94a3b8' }}>لا توجد منتجات حتى الآن</div>
          ) : (
            products.map((product) => {
              const isOpen = expandedId === product.id;
              const productVariants = variantsMap[product.id] || [];

              return (
                <div
                  key={product.id}
                  className="soft-card"
                  style={{
                    borderRadius: '18px',
                    padding: '16px',
                    display: 'grid',
                    gap: '12px'
                  }}
                >
                  <div
                    onClick={() => void toggleExpand(product.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '16px' }}>
                        {product.name}
                      </div>

                      <div
                        style={{
                          color: product.is_active ? '#34d399' : '#f87171',
                          fontSize: '12px',
                          marginTop: '6px',
                          fontWeight: 700
                        }}
                      >
                        {product.is_active ? 'نشط' : 'موقوف'}
                      </div>

                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: '13px',
                          marginTop: '6px'
                        }}
                      >
                        التصنيف: {product.category_name || '—'}
                      </div>

                      {product.description ? (
                        <div
                          style={{
                            color: '#cbd5e1',
                            fontSize: '13px',
                            marginTop: '6px'
                          }}
                        >
                          {product.description}
                        </div>
                      ) : null}
                    </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openEditProduct(product);
                          }}
                          style={secondarySmallButtonStyle}
                        >
                          تعديل
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleToggleProductActive(product.id, product.is_active);
                          }}
                          style={{
                            ...dangerButtonStyle,
                            height: '40px',
                            padding: '0 12px',
                            color: product.is_active ? '#fca5a5' : '#86efac',
                            border: product.is_active
                              ? '1px solid rgba(239,68,68,0.25)'
                              : '1px solid rgba(34,197,94,0.25)',
                            background: product.is_active
                              ? 'rgba(239,68,68,0.12)'
                              : 'rgba(34,197,94,0.12)'
                          }}
                        >
                          {product.is_active ? 'تعطيل' : 'تفعيل'}
                        </button>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            color: '#60a5fa',
                            fontWeight: 600
                          }}
                        >
                          <span>#{product.id}</span>
                          <span>{isOpen ? '▲' : '▼'}</span>
                        </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div
                      style={{
                        marginTop: '4px',
                        borderTop: '1px solid rgba(255,255,255,0.08)',
                        paddingTop: '12px'
                      }}
                    >
                      {loadingVariants === product.id ? (
                        <div style={{ color: '#94a3b8' }}>جاري تحميل الـ variants...</div>
                      ) : productVariants.length === 0 ? (
                        <div style={{ color: '#94a3b8' }}>لا توجد variants لهذا المنتج</div>
                      ) : (
                        <div style={{ display: 'grid', gap: '10px' }}>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '12px',
                              background: 'rgba(37,99,235,0.10)',
                              fontSize: '13px',
                              fontWeight: 700,
                              color: '#cbd5e1'
                            }}
                          >
                            <div>الباركود</div>
                            <div>المقاس</div>
                            <div>اللون</div>
                            <div>سعر البيع</div>
                            <div>المخزون</div>
                          </div>

            {productVariants.map((variant) => {
              const isLowStock = Number(variant.stock) <= Number(variant.min_stock);

              return (
                  <div
                    style={{
                      display: 'grid',
                      gap: '16px',
                      minHeight: 'max-content',
                      paddingBottom: '24px'
                    }}
                  >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr auto',
                      gap: '10px',
                      fontSize: '13px',
                      alignItems: 'center'
                    }}
                  >
                    <div>{variant.barcode || '—'}</div>
                    <div>{variant.size || '—'}</div>
                    <div>{variant.color || '—'}</div>
                    <div>{variant.sell_price} ج</div>
                    <div
                      style={{
                        color: isLowStock ? '#f87171' : '#34d399',
                        fontWeight: 700
                      }}
                    >
                      {variant.stock}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        void handleToggleVariantActive(product.id, variant.id, variant.is_active)
                      }
                      style={{
                        ...dangerButtonStyle,
                        height: '38px',
                        padding: '0 10px',
                        color: variant.is_active ? '#fca5a5' : '#86efac',
                        border: variant.is_active
                          ? '1px solid rgba(239,68,68,0.25)'
                          : '1px solid rgba(34,197,94,0.25)',
                        background: variant.is_active
                          ? 'rgba(239,68,68,0.12)'
                          : 'rgba(34,197,94,0.12)'
                      }}
                    >
                      {variant.is_active ? 'تعطيل' : 'تفعيل'}
                    </button>

                    <div
                        style={{
                          color: variant.is_active ? '#34d399' : '#f87171',
                          fontSize: '12px',
                          fontWeight: 700
                        }}
                      >
                        {variant.is_active ? 'Variant نشط' : 'Variant موقوف'}
                      </div>
                    </div>

                  <div
                    style={{
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                      paddingTop: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                  >
                    <BarcodePreview value={variant.barcode} />

                    <button
                      type="button"
                      disabled={!printSettings}
                      onClick={() =>
                        printBarcodeLabel({
                          productName: product.name,
                          barcode: variant.barcode,
                          size: variant.size,
                          color: variant.color,
                          price: variant.sell_price
                        })
                      }
                      style={{
                        ...secondaryButtonStyle,
                        opacity: printSettings ? 1 : 0.6
                      }}
                    >
                      طباعة الباركود
                    </button>
                  </div>
                </div>
              );
            })}
                    </div>
                  )}
                </div>
              )}
            </div>
                  );
                })
              )}
            </div>           
            </div>
      

        {showCreate && (
          <div
            className="glass-card"
            style={{
              borderRadius: '24px',
              padding: '20px',
              display: 'grid',
              gap: '16px',
              boxSizing: 'border-box'
            }}
          >
          <div style={{ fontSize: '20px', fontWeight: 700 }}>إضافة منتج جديد</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            <div>
              <label style={labelStyle}>اسم المنتج</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>التصنيف</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                style={inputStyle}
              >
                <option value="">بدون تصنيف</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

              <div>
                <label style={labelStyle}>الوصف</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ ...inputStyle, height: '100px', paddingTop: '14px' }}
                />
              </div>

              <div style={{ fontSize: '18px', fontWeight: 700 }}>الـ Variants</div>

              <div style={{ display: 'grid', gap: '14px' }}>
                {variants.map((variant, index) => (
                  <div
                    key={index}
                    className="soft-card"
                    style={{
                      borderRadius: '18px',
                      padding: '16px',
                      display: 'grid',
                      gap: '14px'
                    }}
                  >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '12px'
                    }}
                  >
                  <div>
                    <label style={labelStyle}>الباركود</label>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        value={variant.barcode}
                        onChange={(e) => updateVariant(index, 'barcode', e.target.value)}
                        style={inputStyle}
                      />

                      <button
                        type="button"
                        onClick={() => updateVariant(index, 'barcode', generateBarcodeValue())}
                        style={secondarySmallButtonStyle}
                      >
                        توليد
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>المقاس</label>
                    <input
                      value={variant.size}
                      onChange={(e) => updateVariant(index, 'size', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>اللون</label>
                    <input
                      value={variant.color}
                      onChange={(e) => updateVariant(index, 'color', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px'
                  }}
                >
                  <div>
                    <label style={labelStyle}>سعر الشراء</label>
                    <input
                      type="number"
                      value={variant.buy_price}
                      onChange={(e) => updateVariant(index, 'buy_price', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>سعر البيع</label>
                    <input
                      type="number"
                      value={variant.sell_price}
                      onChange={(e) => updateVariant(index, 'sell_price', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>حد المخزون</label>
                    <input
                      type="number"
                      value={variant.min_stock}
                      onChange={(e) => updateVariant(index, 'min_stock', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>الرصيد الافتتاحي</label>
                    <input
                      type="number"
                      value={variant.opening_qty}
                      onChange={(e) => updateVariant(index, 'opening_qty', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {variants.length > 1 && (
                  <div>
                    <button
                      onClick={() => removeVariant(index)}
                      style={dangerButtonStyle}
                    >
                      حذف هذا الـ variant
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={addVariant} style={secondaryButtonStyle}>
              + إضافة variant
            </button>

            <button
              onClick={() => void handleSave()}
              disabled={!canSave || loading}
              style={{
                ...primaryButtonStyle,
                opacity: !canSave || loading ? 0.6 : 1
              }}
            >
              {loading ? 'جاري الحفظ...' : 'حفظ المنتج'}
            </button>

            <button
              onClick={() => setShowCreate(false)}
              style={secondaryButtonStyle}
            >
              إلغاء
            </button>
          </div>
        </div>
        )}

        {editingProductId && (
        <div
          className="glass-card"
          style={{
            borderRadius: '24px',
            padding: '20px',
            display: 'grid',
            gap: '16px'
          }}
        >
          <div style={{ fontSize: '20px', fontWeight: 700 }}>تعديل المنتج</div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '14px'
            }}
          >
            <div>
              <label style={labelStyle}>اسم المنتج</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>التصنيف</label>
              <select
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(e.target.value)}
                style={inputStyle}
              >
                <option value="">بدون تصنيف</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>الوصف</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              style={{ ...inputStyle, height: '100px', paddingTop: '14px' }}
            />
          </div>

          <div style={{ fontSize: '18px', fontWeight: 700 }}>تعديل الـ Variants</div>

          <div style={{ display: 'grid', gap: '14px' }}>
            {editVariants.map((variant, index) => (
              <div
                key={variant.id}
                className="soft-card"
                style={{
                  borderRadius: '18px',
                  padding: '16px',
                  display: 'grid',
                  gap: '14px'
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '12px'
                  }}
                >
                  <div>
                    <label style={labelStyle}>الباركود</label>
                    <input
                      value={variant.barcode}
                      onChange={(e) =>
                        updateEditVariant(index, 'barcode', e.target.value)
                      }
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>المقاس</label>
                    <input
                      value={variant.size}
                      onChange={(e) =>
                        updateEditVariant(index, 'size', e.target.value)
                      }
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>اللون</label>
                    <input
                      value={variant.color}
                      onChange={(e) =>
                        updateEditVariant(index, 'color', e.target.value)
                      }
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px'
                  }}
                >
                  <div>
                    <label style={labelStyle}>سعر الشراء</label>
                    <input
                      type="number"
                      value={variant.buy_price}
                      onChange={(e) =>
                        updateEditVariant(index, 'buy_price', e.target.value)
                      }
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>سعر البيع</label>
                    <input
                      type="number"
                      value={variant.sell_price}
                      onChange={(e) =>
                        updateEditVariant(index, 'sell_price', e.target.value)
                      }
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>حد المخزون</label>
                    <input
                      type="number"
                      value={variant.min_stock}
                      onChange={(e) =>
                        updateEditVariant(index, 'min_stock', e.target.value)
                      }
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={() => void handleSaveEdit()}
              disabled={savingEdit}
              style={primaryButtonStyle}
            >
              {savingEdit ? 'جاري حفظ التعديلات...' : 'حفظ التعديلات'}
            </button>

            <button
              type="button"
              onClick={closeEditProduct}
              style={secondaryButtonStyle}
            >
              إلغاء
            </button>
          </div>
        </div>
        )}
      </div>
    );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '8px',
  color: '#cbd5e1',
  fontSize: '14px'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '48px',
  borderRadius: '14px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  padding: '0 14px',
  outline: 'none'
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  height: '48px',
  borderRadius: '14px',
  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
  color: '#fff',
  fontWeight: 700,
  padding: '0 18px'
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.08)',
  height: '48px',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  fontWeight: 600,
  padding: '0 18px'
};

const dangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(239,68,68,0.25)',
  height: '42px',
  borderRadius: '12px',
  background: 'rgba(239,68,68,0.12)',
  color: '#fca5a5',
  fontWeight: 600,
  padding: '0 14px'
};

const secondarySmallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.08)',
  height: '48px',
  minWidth: '88px',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  fontWeight: 600,
  padding: '0 14px',
  cursor: 'pointer'
};