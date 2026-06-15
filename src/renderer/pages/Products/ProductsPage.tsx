import { useEffect, useMemo, useRef, useState } from 'react';
import BarcodePreview from '../../components/products/BarcodePreview';
import { useAuthStore } from '../../store/auth.store';

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
variants_count: number;
active_variants_count: number;
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

barcode_content_offset_x_mm: number;
barcode_content_offset_y_mm: number;

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

function escapeHtml(value: string) {
return String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
}

function escapeJs(value: string) {
return String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"');
}

function money(value: unknown) {
const n = Number(value || 0);
return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

type ProductsTab = 'list' | 'create' | 'edit';
type ProductEditMode = 'edit' | 'addVariant';

export default function ProductsPage() {
  const currentUser = useAuthStore((s) => s.user);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [pageWidth, setPageWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  const isNarrowDesktop = pageWidth < 1200;
  const isWideDesktop = pageWidth >= 1200;
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<ProductsTab>('list');
  const [loading, setLoading] = useState(false);
  const [pageMessage, setPageMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [variants, setVariants] = useState<VariantForm[]>([emptyVariant()]);
  const [newEditVariant, setNewEditVariant] = useState<VariantForm>(emptyVariant());
  const [addingVariant, setAddingVariant] = useState(false);
  const [productEditMode, setProductEditMode] = useState<ProductEditMode>('edit');
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
  const [includeInactiveVariants, setIncludeInactiveVariants] = useState(false);

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

  function showMessage(type: 'success' | 'error', text: string) {
    setPageMessage({ type, text });

    setTimeout(() => {
      setPageMessage(null);
    }, 1800);
  }

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

      setCategories(Array.isArray(cats) ? cats : []);
      setProducts(Array.isArray(prods) ? prods : []);
      setPrintSettings(barcodeSettings);
    } catch (error) {
      console.error('Failed to load products page data:', error);
      showMessage('error', 'حدث خطأ أثناء تحميل المنتجات');
    }
  }

  function updateNewEditVariant(key: keyof VariantForm, value: string) {
    setNewEditVariant((prev) => ({
      ...prev,
      [key]: value
    }));
  }

  async function addVariantToEditingProduct() {
    if (!editingProductId) return;
    if (addingVariant) return;

    if (!newEditVariant.barcode.trim()) {
      showMessage('error', 'الباركود مطلوب');
      return;
    }

    if (!newEditVariant.size.trim()) {
      showMessage('error', 'المقاس مطلوب');
      return;
    }

    if (!newEditVariant.color.trim()) {
      showMessage('error', 'اللون مطلوب');
      return;
    }

    if (!newEditVariant.buy_price.trim() || !newEditVariant.sell_price.trim()) {
      showMessage('error', 'سعر الشراء وسعر البيع مطلوبين');
      return;
    }

    const buyPrice = Number(newEditVariant.buy_price);
    const sellPrice = Number(newEditVariant.sell_price);
    const minStock = Number(newEditVariant.min_stock || 5);
    const openingQty = Number(newEditVariant.opening_qty || 0);

    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      showMessage('error', 'سعر الشراء غير صحيح');
      return;
    }

    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      showMessage('error', 'سعر البيع غير صحيح');
      return;
    }

    if (!Number.isFinite(minStock) || minStock < 0) {
      showMessage('error', 'حد المخزون غير صحيح');
      return;
    }

    if (!Number.isFinite(openingQty) || openingQty < 0) {
      showMessage('error', 'الرصيد الافتتاحي غير صحيح');
      return;
    }

    setAddingVariant(true);

    try {
      const result = await window.api.addProductVariant({
        product_id: editingProductId,
        barcode: newEditVariant.barcode.trim(),
        size: newEditVariant.size.trim(),
        color: newEditVariant.color.trim(),
        buy_price: buyPrice,
        sell_price: sellPrice,
        min_stock: minStock,
        opening_qty: openingQty,
        actor_id: currentUser?.id
      });

      if (!result.success) {
        showMessage('error', result.message || 'فشل إضافة الصنف');
        return;
      }

      const refreshed = await window.api.getProductVariants({
        productId: editingProductId,
        includeInactive: true
      });

      const normalizedVariants = (Array.isArray(refreshed) ? refreshed : []).map(
        (v: ProductVariant) => ({
          id: v.id,
          barcode: v.barcode ?? '',
          size: v.size ?? '',
          color: v.color ?? '',
          buy_price: String(v.buy_price ?? 0),
          sell_price: String(v.sell_price ?? 0),
          min_stock: String(v.min_stock ?? 5),
          is_active: v.is_active ?? 1
        })
      );

      setEditVariants(normalizedVariants);

      setVariantsMap((prev) => ({
        ...prev,
        [editingProductId]: Array.isArray(refreshed) ? refreshed : []
      }));

      await loadData();

      setNewEditVariant(emptyVariant());
      showMessage('success', 'تم إضافة الصنف بنجاح');
    } catch (error) {
      console.error('Failed to add variant:', error);
      showMessage('error', 'حدث خطأ أثناء إضافة الصنف');
    } finally {
      setAddingVariant(false);
    }
  }

  useEffect(() => {
    const element = pageRef.current;

    if (!element) return;

    function updateCompact(width: number) {
      const safeWidth = width || window.innerWidth;

      setPageWidth(safeWidth);
      setIsCompact(safeWidth <= 900);
    }

    updateCompact(element.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry) {
        updateCompact(entry.contentRect.width);
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

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
        .then((data) => setProducts(Array.isArray(data) ? data : []))
        .catch((error) => console.error('Failed to search products:', error));
    }, 250);

    return () => clearTimeout(handle);
  }, [search, includeInactive]);

  useEffect(() => {
    setVariantsMap({});
    setExpandedId(null);
  }, [includeInactiveVariants]);

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

  function resetCreateForm() {
    setName('');
    setCategoryId('');
    setDescription('');
    setVariants([emptyVariant()]);
  }

  function openCreateTab() {
    setShowCreate(true);
    setActiveTab('create');

    setEditingProductId(null);
    setEditName('');
    setEditCategoryId('');
    setEditDescription('');
    setEditVariants([]);
  }

  async function handleSave() {
    if (!canSave || loading) return;

    setLoading(true);

    try {
      const result = await window.api.createProduct({
        name: name.trim(),
        category_id: categoryId ? Number(categoryId) : null,
        description: description.trim() || null,
        image_path: null,
        actor_id: currentUser?.id,
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

      if (!result.success) {
        showMessage('error', result.message || 'فشل حفظ المنتج');
        return;
      }

      resetCreateForm();
      setShowCreate(false);
      setActiveTab('list');

      await reloadPrintSettings();
      await loadData();
      showMessage('success', 'تم حفظ المنتج بنجاح');
    } catch (error) {
      console.error('Failed to save product:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ المنتج');
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
          [productId]: Array.isArray(data) ? data : []
        }));
      } catch (error) {
        console.error('Failed to load product variants:', error);
        showMessage('error', 'حدث خطأ أثناء تحميل الـ variants');
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
      showMessage('error', 'لا يوجد باركود للطباعة');
      return;
    }

    if (!printSettings) {
      showMessage('error', 'إعدادات الطباعة غير جاهزة');
      return;
    }

    const widthMm = Number(printSettings.barcode_label_width_mm || 35);
    const heightMm = Number(printSettings.barcode_label_height_mm || 25);
    const copies = Math.max(1, Number(printSettings.barcode_copies || 1));
    const svgHeight = Math.max(10, Number(printSettings.barcode_svg_height || 22));
    const contentOffsetX = Number(printSettings.barcode_content_offset_x_mm || 0);
    const contentOffsetY = Number(printSettings.barcode_content_offset_y_mm || 0);

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
            <div class="label-content">
              ${renderTripleRow('top-left', 'top', 'top-right', 'row-top')}
              ${renderSingleZone('above_barcode')}

              <div class="barcode-zone">
                <svg class="barcode"></svg>
              </div>

              ${renderSingleZone('below_barcode')}
              ${renderTripleRow('bottom-left', 'bottom', 'bottom-right', 'row-bottom')}
            </div>
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
              page-break-after: always;
              overflow: hidden;
              position: relative;
            }
            .label-content {
              width: 100%;
              height: 100%;
              box-sizing: border-box;
              padding: 1.5mm;
              display: grid;
              grid-template-rows: auto auto auto auto;
              gap: 0.4mm;
              transform: translate(${contentOffsetX}mm, ${contentOffsetY}mm);
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

            .price-item,
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
      showMessage('error', 'تعذر فتح نافذة الطباعة');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(content);
    printWindow.document.close();
  }

  async function openEditProduct(product: Product, mode: ProductEditMode = 'edit') {
    setShowCreate(false);
    setActiveTab('edit');
    setProductEditMode(mode);

    if (mode === 'addVariant') {
      setNewEditVariant(emptyVariant());
    }

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
        (Array.isArray(data) ? data : []).map((v: ProductVariant) => ({
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
      showMessage('error', 'حدث خطأ أثناء تحميل بيانات المنتج');
    }
  }

  function closeEditProduct() {
    setEditingProductId(null);
    setEditName('');
    setEditCategoryId('');
    setEditDescription('');
    setEditVariants([]);
    setProductEditMode('edit');
    setActiveTab('list');
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
      showMessage('error', 'اسم المنتج مطلوب');
      return;
    }

    setSavingEdit(true);

    try {
      const productResult = await window.api.updateProduct({
        id: editingProductId,
        name: editName.trim(),
        category_id: editCategoryId ? Number(editCategoryId) : null,
        description: editDescription.trim() || null,
        image_path: null,
        actor_id: currentUser?.id
      });

      if (!productResult.success) {
        showMessage('error', productResult.message || 'فشل تعديل المنتج');
        return;
      }

      for (const variant of editVariants) {
        const variantResult = await window.api.updateVariant({
          id: variant.id,
          barcode: variant.barcode.trim(),
          size: variant.size.trim(),
          color: variant.color.trim(),
          buy_price: Number(variant.buy_price),
          sell_price: Number(variant.sell_price),
          min_stock: Number(variant.min_stock || 5),
          is_active: variant.is_active,
          actor_id: currentUser?.id
        });

        if (!variantResult.success) {
          showMessage('error', variantResult.message || 'فشل تعديل أحد الأصناف');
          return;
        }
      }

      await loadData();

      if (expandedId === editingProductId) {
        const refreshed = await window.api.getProductVariants({
          productId: editingProductId,
          includeInactive: includeInactiveVariants
        });

        setVariantsMap((prev) => ({
          ...prev,
          [editingProductId]: Array.isArray(refreshed) ? refreshed : []
        }));
      }

      closeEditProduct();
    } catch (error) {
      console.error('Failed to save edit product:', error);
      showMessage('error', 'حدث خطأ أثناء حفظ التعديلات');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleProductActive(productId: number, currentState: number) {
    try {
      await window.api.toggleProductActive(productId, currentState ? 0 : 1, currentUser?.id);
      await loadData();

      if (expandedId === productId) {
        setExpandedId(null);
      }
    } catch (error) {
      console.error('Failed to toggle product active state:', error);
      showMessage('error', 'حدث خطأ أثناء تحديث حالة المنتج');
    }
  }

  async function handleToggleVariantActive(
    productId: number,
    variantId: number,
    currentState: number
  ) {
    try {
      await window.api.toggleVariantActive(variantId, currentState ? 0 : 1, currentUser?.id);

      const refreshed = await window.api.getProductVariants({
        productId,
        includeInactive: includeInactiveVariants
      });

      setVariantsMap((prev) => ({
        ...prev,
        [productId]: Array.isArray(refreshed) ? refreshed : []
      }));
      await loadData();
    } catch (error) {
      console.error('Failed to toggle variant active state:', error);
      showMessage('error', 'حدث خطأ أثناء تحديث حالة الـ variant');
    }
  }

  const productGridMinWidth = isNarrowDesktop ? '900px' : '100%';

  const variantGridColumns = isNarrowDesktop
    ? '220px 90px 110px 100px 90px 100px 120px'
    : '1.5fr 0.8fr 0.8fr 0.8fr 0.7fr 110px 130px';

  return (
    <div
      ref={pageRef}
      style={{
        display: 'grid',
        gap: '16px',
        width: '100%',
        maxWidth: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows:
          activeTab === 'list'
            ? 'auto auto minmax(0, 1fr)'
            : 'auto minmax(0, 1fr)',
        alignContent: 'stretch'
      }}
    >
      {pageMessage && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            padding: '12px 18px',
            borderRadius: '14px',
            background:
              pageMessage.type === 'error'
                ? 'rgba(239,68,68,0.95)'
                : 'rgba(16,185,129,0.95)',
            color: '#fff',
            fontWeight: 800,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            pointerEvents: 'none'
          }}
        >
          {pageMessage.text}
        </div>
      )}
      {activeTab === 'list' && (
        <div
          className="glass-card"
          style={{
            borderRadius: '24px',
            padding: isNarrowDesktop ? '16px' : '20px',
            display: 'grid',
            gap: '12px',
            maxWidth: '100%',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isCompact ? '1fr' : 'minmax(260px, 1fr) auto',
              alignItems: 'center',
              gap: '12px',
              maxWidth: '100%'
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث باسم المنتج أو التصنيف أو الباركود أو المقاس أو اللون..."
              style={inputStyle}
            />

            <button
              type="button"
              onClick={openCreateTab}
              style={{
                ...primaryButtonStyle,
                width: undefined
              }}
            >
              + إضافة منتج
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
              color: '#cbd5e1',
              direction: 'rtl'
            }}
          >
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              <span>عرض المنتجات الموقوفة</span>
            </label>

            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={includeInactiveVariants}
                onChange={(e) => setIncludeInactiveVariants(e.target.checked)}
              />
              <span>عرض الـ variants الموقوفة</span>
            </label>
          </div>
        </div>
      )}  
      <div
        className="glass-card"
        style={{
          borderRadius: '18px',
          padding: '10px',
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
          direction: 'rtl'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          style={tabButtonStyle(activeTab === 'list')}
        >
          قائمة المنتجات
        </button>

        <button
          type="button"
          onClick={openCreateTab}
          style={tabButtonStyle(activeTab === 'create')}
        >
          إضافة منتج
        </button>

        <button
          type="button"
          disabled={!editingProductId}
          onClick={() => {
            if (editingProductId) setActiveTab('edit');
          }}
          style={{
            ...tabButtonStyle(activeTab === 'edit'),
            opacity: editingProductId ? 1 : 0.45,
            cursor: editingProductId ? 'pointer' : 'not-allowed'
          }}
        >
          تعديل المنتج
        </button>
      </div>
      {activeTab === 'list' && (    
        <div
          className="glass-card fixed-table-card list-scroll"
          style={{
            borderRadius: '24px',
            padding: isNarrowDesktop ? '16px' : '20px',
            maxWidth: '100%',
          }}
        >
          <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
            المنتجات
          </div>

          <div style={{ display: 'grid', gap: '12px', maxWidth: '100%' }}>
            {products.length === 0 ? (
              <div style={{ color: '#94a3b8' }}>لا توجد منتجات حتى الآن</div>
            ) : (
              products.map((product) => {
                const isOpen = expandedId === product.id;
                const searchValue = search.trim();

                const productVariants = (variantsMap[product.id] || []).filter((variant) => {
                  if (!searchValue) return true;

                  // لو البحث باركود
                  if (/^\d+$/.test(searchValue)) {
                    return variant.barcode === searchValue;
                  }

                  // البحث العادي
                  return (
                    variant.barcode?.includes(searchValue) ||
                    variant.size?.toLowerCase().includes(searchValue.toLowerCase()) ||
                    variant.color?.toLowerCase().includes(searchValue.toLowerCase())
                  );
                });

                return (
                  <div
                    key={product.id}
                    className="soft-card"
                    style={{
                      borderRadius: '18px',
                      padding: isCompact ? '12px' : '16px',
                      display: 'grid',
                      gap: '12px',
                      maxWidth: '100%',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      onClick={() => void toggleExpand(product.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isCompact ? '1fr' : 'minmax(0, 1fr) auto',
                        alignItems: 'center',
                        gap: '12px',
                        cursor: 'pointer',
                        minWidth: 0
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '16px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {product.name}
                        </div>

                        <div
                          className={`product-status-text ${product.is_active ? 'is-active' : 'is-inactive'}`}
                          style={{
                            fontSize: '12px',
                            marginTop: '6px',
                            fontWeight: 900
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

                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                            marginTop: '8px'
                          }}
                        >
                          <span
                            style={{
                              padding: '5px 10px',
                              borderRadius: '999px',
                              background: 'rgba(37,99,235,0.14)',
                              border: '1px solid rgba(37,99,235,0.25)',
                              color: '#bfdbfe',
                              fontSize: '12px',
                              fontWeight: 800
                            }}
                          >
                            الأصناف: {Number(product.variants_count || 0)}
                          </span>

                          <span
                            style={{
                              padding: '5px 10px',
                              borderRadius: '999px',
                              background: 'rgba(16,185,129,0.12)',
                              border: '1px solid rgba(16,185,129,0.25)',
                              color: '#86efac',
                              fontSize: '12px',
                              fontWeight: 800
                            }}
                          >
                            النشطة: {Number(product.active_variants_count || 0)}
                          </span>
                        </div>

                        {product.description ? (
                          <div
                            style={{
                              color: '#cbd5e1',
                              fontSize: '13px',
                              marginTop: '6px',
                              overflowWrap: 'anywhere'
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
                          gap: '10px',
                          flexWrap: 'wrap',
                          justifyContent: isCompact ? 'flex-start' : 'flex-end'
                        }}
                      >

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openEditProduct(product, 'edit');
                          }}
                          style={secondarySmallButtonStyle}
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          className="product-action-button add-variant"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openEditProduct(product, 'addVariant');
                          }}
                          style={{
                            ...secondarySmallButtonStyle,
                            color: '#6ee7b7',
                            border: '1px solid rgba(16,185,129,0.28)',
                            background: 'rgba(16,185,129,0.10)'
                          }}
                        >
                          + صنف
                        </button>
                        <button
                          type="button"
                          className={`product-action-button ${product.is_active ? 'deactivate-product' : 'activate-product'}`}
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
                          paddingTop: '12px',
                          maxWidth: '100%',
                          overflow: 'hidden'
                        }}
                      >
                        {loadingVariants === product.id ? (
                          <div style={{ color: '#94a3b8' }}>جاري تحميل الـ variants...</div>
                        ) : productVariants.length === 0 ? (
                          <div style={{ color: '#94a3b8' }}>لا توجد variants لهذا المنتج</div>
                        ) : (
                          <div style={{ overflowX: 'auto', maxWidth: '100%', direction: 'rtl'}}>
                            <div
                              style={{
                                display: 'grid',
                                gap: '10px',
                                minWidth: productGridMinWidth
                              }}
                            >
                              
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: variantGridColumns,
                                    gap: '10px',
                                    padding: '10px 12px',
                                    borderRadius: '12px',
                                    background: 'rgba(37,99,235,0.10)',
                                    fontSize: '13px',
                                    fontWeight: 700,
                                    color: '#cbd5e1',
                                    minWidth: 0,
                                    alignItems: 'center'
                                  }}
                                >
                                  <div>الباركود</div>
                                  <div>المقاس</div>
                                  <div>اللون</div>
                                  <div>سعر الشراء</div>
                                  <div>سعر البيع</div>
                                  <div>المخزون</div>
                                  <div>إجراء</div>
                                  <div>الحالة</div>
                                </div>
                              

                              {productVariants.map((variant) => {
                                const isLowStock =
                                  Number(variant.stock) <= Number(variant.min_stock);

                                return (
                                  <div
                                    key={variant.id}
                                    style={{
                                      display: 'grid',
                                      gap: '12px',
                                      padding: '12px',
                                      borderRadius: '14px',
                                      background: 'rgba(255,255,255,0.03)',
                                      border: '1px solid rgba(255,255,255,0.06)'
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: variantGridColumns,
                                        gap: '10px',
                                        fontSize: '13px',
                                        alignItems: 'center',
                                        minWidth: 0
                                      }}
                                    >
                                      <div>{variant.barcode || '—'}</div>
                                      <div>{variant.size || '—'}</div>
                                      <div>{variant.color || '—'}</div>
                                      <div>{money(variant.buy_price)} ج</div>
                                      <div>{money(variant.sell_price)} ج</div>
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
                                        className={`product-action-button ${variant.is_active ? 'deactivate-product' : 'activate-product'}`}
                                        onClick={() =>
                                          void handleToggleVariantActive(
                                            product.id,
                                            variant.id,
                                            variant.is_active
                                          )
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
                                        className={`product-status-text ${variant.is_active ? 'is-active' : 'is-inactive'}`}
                                        style={{
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
                                        paddingTop: '12px',
                                        display: 'grid',
                                        gridTemplateColumns: isCompact ? '1fr' : 'minmax(220px, 1fr) auto',
                                        gap: '12px',
                                        alignItems: 'center',
                                        direction: 'rtl',
                                        maxWidth: '100%',
                                        overflow: 'hidden'
                                      }}
                                    >
                                      <div
                                        style={{
                                          minWidth: 0,
                                          overflowX: 'auto',
                                          display: 'flex',
                                          justifyContent: isCompact ? 'center' : 'flex-start'
                                        }}
                                      >
                                        <BarcodePreview value={variant.barcode} />
                                      </div>

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
                                          opacity: printSettings ? 1 : 0.6,
                                          width: undefined,
                                          whiteSpace: 'nowrap'
                                        }}
                                      >
                                        طباعة الباركود
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
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
      )}

      {activeTab === 'create' && (
        <div className="product-editor-screen">
          <div
            className="glass-card product-editor-head"
            style={{
              borderRadius: '24px',
              padding: isNarrowDesktop ? '16px' : '20px',
              display: 'grid',
              gap: '16px',
              boxSizing: 'border-box',
              maxWidth: '100%',
              alignContent: 'start'
            }}
          >
            <div style={{ fontSize: '20px', fontWeight: 700 }}>إضافة منتج جديد</div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '14px'
              }}
            >
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
                style={{
                  ...inputStyle,
                  height: '86px',
                  paddingTop: '14px',
                  resize: 'vertical'
                }}
              />
            </div>
          </div>

          <div className="product-editor-body-scroll">
            <div
              className="glass-card product-editor-body"
              style={{
                borderRadius: '24px',
                padding: isNarrowDesktop ? '16px' : '20px'
              }}
            >
              <div style={{ fontSize: '18px', fontWeight: 700 }}>الـ Variants</div>

              <div style={{ display: 'grid', gap: '14px' }}>
                {variants.map((variant, index) => (
                  <div
                    key={index}
                    className="soft-card"
                    style={{
                      borderRadius: '18px',
                      padding: isCompact ? '12px' : '16px',
                      display: 'grid',
                      gap: '14px',
                      overflow: 'visible'
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                        gap: '12px'
                      }}
                    >
                      <div>
                        <label style={labelStyle}>الباركود</label>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: isCompact ? '1fr' : 'minmax(0, 1fr) auto',
                            gap: '8px'
                          }}
                        >
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
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
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
                          type="button"
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

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button type="button" onClick={addVariant} style={secondaryButtonStyle}>
                  + إضافة variant
                </button>

                <button
                  type="button"
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
                  type="button"
                  onClick={() => {
                    resetCreateForm();
                    setShowCreate(false);
                    setActiveTab('list');
                  }}
                  style={secondaryButtonStyle}
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      
      {activeTab === 'edit' && editingProductId && (
        <div className="product-editor-screen">
          <div
            className="glass-card product-editor-head"
            style={{
              borderRadius: '24px',
              padding: isNarrowDesktop ? '16px' : '20px',
              display: 'grid',
              gap: '16px',
              boxSizing: 'border-box',
              maxWidth: '100%',
              alignContent: 'start'
            }}
          >
            <div style={{ fontSize: '20px', fontWeight: 700 }}>
              {productEditMode === 'addVariant' ? 'إضافة صنف للمنتج' : 'تعديل المنتج'}
            </div>

            {productEditMode === 'addVariant' && (
              <div style={{ color: '#94a3b8', fontWeight: 700 }}>
                المنتج: {editName || '—'}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
                style={{
                  ...inputStyle,
                  height: '86px',
                  paddingTop: '14px',
                  resize: 'vertical'
                }}
              />
            </div>
          </div>

          <div className="product-editor-body-scroll">
            <div
              className="glass-card product-editor-body"
              style={{
                borderRadius: '24px',
                padding: isNarrowDesktop ? '16px' : '20px'
              }}
            >
              <div
                className="soft-card"
                style={{
                  borderRadius: '18px',
                  padding: '16px',
                  display: 'grid',
                  gap: '14px',
                  overflow: 'visible'
                }}
              >
                <div>
                  <h3 style={{ margin: '0 0 6px' }}>إضافة صنف جديد للمنتج</h3>
                  <p style={{ margin: 0, color: '#94a3b8', fontWeight: 700 }}>
                    أضف مقاس أو لون جديد لنفس المنتج بدون إنشاء منتج جديد.
                  </p>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px'
                  }}
                >
                  <div>
                    <label style={labelStyle}>الباركود</label>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: '8px'
                      }}
                    >
                      <input
                        value={newEditVariant.barcode}
                        onChange={(e) => updateNewEditVariant('barcode', e.target.value)}
                        style={inputStyle}
                      />

                      <button
                        type="button"
                        onClick={() => updateNewEditVariant('barcode', generateBarcodeValue())}
                        style={secondarySmallButtonStyle}
                      >
                        توليد
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>المقاس</label>
                    <input
                      value={newEditVariant.size}
                      onChange={(e) => updateNewEditVariant('size', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>اللون</label>
                    <input
                      value={newEditVariant.color}
                      onChange={(e) => updateNewEditVariant('color', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>سعر الشراء</label>
                    <input
                      type="number"
                      value={newEditVariant.buy_price}
                      onChange={(e) => updateNewEditVariant('buy_price', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>سعر البيع</label>
                    <input
                      type="number"
                      value={newEditVariant.sell_price}
                      onChange={(e) => updateNewEditVariant('sell_price', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>حد المخزون</label>
                    <input
                      type="number"
                      value={newEditVariant.min_stock}
                      onChange={(e) => updateNewEditVariant('min_stock', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>الرصيد الافتتاحي</label>
                    <input
                      type="number"
                      value={newEditVariant.opening_qty}
                      onChange={(e) => updateNewEditVariant('opening_qty', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => void addVariantToEditingProduct()}
                    disabled={addingVariant}
                    style={{
                      ...primaryButtonStyle,
                      opacity: addingVariant ? 0.6 : 1,
                      cursor: addingVariant ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {addingVariant ? 'جاري الإضافة...' : '+ إضافة الصنف للمنتج'}
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '18px', fontWeight: 700 }}>تعديل الـ Variants</div>

              <div style={{ display: 'grid', gap: '14px' }}>
                {editVariants.map((variant, index) => (
                  <div
                    key={variant.id}
                    className="soft-card"
                    style={{
                      borderRadius: '18px',
                      padding: isCompact ? '12px' : '16px',
                      display: 'grid',
                      gap: '14px',
                      overflow: 'visible'
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
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
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
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

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={savingEdit}
                  style={{
                    ...primaryButtonStyle,
                    opacity: savingEdit ? 0.6 : 1
                  }}
                >
                  {savingEdit ? 'جاري حفظ التعديلات...' : 'حفظ التعديلات'}
                </button>

                <button type="button" onClick={closeEditProduct} style={secondaryButtonStyle}>
                  إلغاء
                </button>
              </div>
            </div>
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

const checkboxLabelStyle: React.CSSProperties = {
display: 'flex',
alignItems: 'center',
gap: '8px',
color: '#cbd5e1'
};

const inputStyle: React.CSSProperties = {
width: '100%',
height: '48px',
borderRadius: '14px',
border: '1px solid rgba(255,255,255,0.08)',
background: 'rgba(255,255,255,0.04)',
color: '#fff',
padding: '0 14px',
outline: 'none',
boxSizing: 'border-box',
minWidth: 0
};

const primaryButtonStyle: React.CSSProperties = {
border: 'none',
height: '48px',
borderRadius: '14px',
background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
color: '#fff',
fontWeight: 700,
padding: '0 18px',
cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
border: '1px solid rgba(255,255,255,0.08)',
height: '48px',
borderRadius: '14px',
background: 'rgba(255,255,255,0.04)',
color: '#fff',
fontWeight: 600,
padding: '0 18px',
cursor: 'pointer'
};

const dangerButtonStyle: React.CSSProperties = {
border: '1px solid rgba(239,68,68,0.25)',
height: '42px',
borderRadius: '12px',
background: 'rgba(239,68,68,0.12)',
color: '#fca5a5',
fontWeight: 600,
padding: '0 14px',
cursor: 'pointer'
};

const secondarySmallButtonStyle: React.CSSProperties = {
border: '1px solid rgba(255,255,255,0.08)',
height: '40px',
minWidth: '88px',
borderRadius: '12px',
background: 'rgba(255,255,255,0.04)',
color: '#fff',
fontWeight: 600,
padding: '0 14px',
cursor: 'pointer'
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: active
      ? '1px solid rgba(96,165,250,0.55)'
      : '1px solid rgba(255,255,255,0.10)',
    minHeight: '44px',
    borderRadius: '14px',
    background: active
      ? 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(124,58,237,0.95))'
      : 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontWeight: 900,
    padding: '0 18px',
    cursor: 'pointer',
    boxShadow: active ? '0 12px 26px rgba(37,99,235,0.22)' : 'none'
  };
}