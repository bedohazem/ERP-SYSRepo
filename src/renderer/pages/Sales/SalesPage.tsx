import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { useAuthStore } from '../../store/auth.store';
import {
  CUSTOMER_PAYMENT_METHOD_OPTIONS,
  getPaymentMethodLabel
} from '../../utils/payment-method';
import QRCode from 'qrcode';

type SaleVariant = {
  variant_id: number;
  product_id: number;
  product_name: string;
  category_id?: number | null;
  category_name?: string | null;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
  buy_price: number;
  stock: number;
  min_stock: number;
  is_active: number;
};

type Category = {
  id: number;
  name: string;
  description?: string | null;
};

type CartItem = SaleVariant & {
  quantity: number;
};

type CustomerOption = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  points_balance: number;
  total_spent?: number;
  sales_count?: number;
  last_sale_at?: string | null;
};

type LoyaltySettings = {
  loyalty_enabled: boolean;
  loyalty_earn_amount: number;
  loyalty_earn_points: number;
  loyalty_point_value: number;
  loyalty_min_redeem_points: number;
};

type SaleReceipt = {
  sale: {
    id: number;
    customer_name?: string | null;
    customer_phone?: string | null;
    cashier_name?: string | null;
    sub_total: number;
    discount_value?: number;
    grand_total: number;
    paid?: number;
    remaining_amount?: number;
    payment_status?: string;
    change_amount?: number;
    payment_method?: string | null;
    loyalty_points_earned?: number;
    loyalty_points_redeemed?: number;
    loyalty_discount_value?: number;
    created_at?: string | null;
  };
  items: Array<{
    id: number;
    product_name: string;
    barcode?: string | null;
    size?: string | null;
    color?: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
  loyalty: Array<{
    id: number;
    type: 'earn' | 'redeem' | 'adjust' | string;
    points: number;
    amount?: number;
    notes?: string | null;
    created_at?: string | null;
  }>;
};

type StoreReceiptInfo = {
  app_name?: string;
  store_phone?: string;
  store_address?: string;
  store_qr_enabled?: boolean;
  store_qr_title?: string;
  store_qr_primary_url?: string;
};

type InvoiceTab = {
  id: number;
  title: string;
  cart: CartItem[];
  barcodeDraft: string;
  productDraft: string;
  customer: CustomerOption | null;
  loyaltyPointsDraft: string;
  paidDraft: string;
  paymentMethod: string;
  discountType: 'amount' | 'percent';
  discountDraft: string;
};

type DropdownRect = {
  top: number;
  left: number;
  width: number;
};

const defaultLoyaltySettings: LoyaltySettings = {
  loyalty_enabled: true,
  loyalty_earn_amount: 1000,
  loyalty_earn_points: 10,
  loyalty_point_value: 10,
  loyalty_min_redeem_points: 2
};

const SALES_DRAFT_STORAGE_KEY = 'fony_sales_invoice_draft_v1';

const createInvoice = (id: number): InvoiceTab => ({
  id,
  title: `فاتورة ${id}`,
  cart: [],
  barcodeDraft: '',
  productDraft: '',
  customer: null,
  loyaltyPointsDraft: '',
  paidDraft: '',
  paymentMethod: 'cash',
  discountType: 'amount',
  discountDraft: ''
});

function normalizeCustomer(customer: any): CustomerOption {
  return {
    id: Number(customer.id),
    name: String(customer.name ?? ''),
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    address: customer.address ?? null,
    notes: customer.notes ?? null,
    points_balance: Number(customer.points_balance ?? 0),
    total_spent: Number(customer.total_spent ?? 0),
    sales_count: Number(customer.sales_count ?? 0),
    last_sale_at: customer.last_sale_at ?? null
  };
}

function normalizePositiveInt(value: string | number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeInvoiceDraft(raw: any, fallbackId: number): InvoiceTab {
  const id = Number(raw?.id || fallbackId);
  const base = createInvoice(id);

  const cart = Array.isArray(raw?.cart)
    ? raw.cart
        .map((item: any) => ({
          variant_id: Number(item.variant_id),
          product_id: Number(item.product_id || 0),
          product_name: String(item.product_name || ''),
          barcode: String(item.barcode || ''),
          size: String(item.size || ''),
          color: String(item.color || ''),
          sell_price: Number(item.sell_price || 0),
          buy_price: Number(item.buy_price || 0),
          stock: Number(item.stock || 0),
          min_stock: Number(item.min_stock || 0),
          is_active: Number(item.is_active ?? 1),
          quantity: Math.max(1, Number(item.quantity || 1))
        }))
        .filter((item: CartItem) => Number.isFinite(item.variant_id) && item.variant_id > 0)
    : [];

  const customer = raw?.customer?.id ? normalizeCustomer(raw.customer) : null;

  return {
    ...base,
    id,
    title: String(raw?.title || `فاتورة ${id}`),
    cart,
    barcodeDraft: String(raw?.barcodeDraft || ''),
    productDraft: String(raw?.productDraft || ''),
    customer,
    loyaltyPointsDraft: '',
    paidDraft: '',
    paymentMethod: 'cash',
    discountType: 'amount',
    discountDraft: ''
  };
}

function serializeInvoiceDraft(invoice: InvoiceTab): InvoiceTab {
  return {
    ...invoice,
    loyaltyPointsDraft: '',
    paidDraft: '',
    paymentMethod: 'cash',
    discountType: 'amount',
    discountDraft: ''
  };
}

function money(value: number | string | null | undefined): string {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const ENGINEER_FOOTER = 'برمجة وتصميم: بشمهندس عبدالرحمن حازم - 01155559287/01068377869';

function getPaymentStatusLabel(status?: string | null) {
  if (status === 'paid') return 'مدفوعة';
  if (status === 'partial') return 'مدفوعة جزئيًا';
  if (status === 'unpaid') return 'غير مدفوعة';
  return status || '—';
}

function formatReceiptDate(value?: string | null): string {
  if (!value) return '—';

  try {
    const raw = String(value);

    const normalized = raw.includes('T')
      ? raw
      : raw.replace(' ', 'T') + 'Z';

    return new Date(normalized).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
}

export default function SalesPage() {
  const user = useAuthStore((s) => s.user);
  const [isCompact, setIsCompact] = useState(false);

  const [invoices, setInvoices] = useState<InvoiceTab[]>([createInvoice(1)]);
  const [activeInvoiceId, setActiveInvoiceId] = useState(1);
  const [nextInvoiceId, setNextInvoiceId] = useState(2);

  const [productResults, setProductResults] = useState<SaleVariant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saleCategoryFilter, setSaleCategoryFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [openingCashDrawer, setOpeningCashDrawer] = useState(false);
  const [cashDrawerAutoOpen, setCashDrawerAutoOpen] = useState(true);
  const [barcodeMode, setBarcodeMode] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [savingNewCustomer, setSavingNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    phone: ''
  });

  const [storeInfo, setStoreInfo] = useState({
    name: '',
    address: '',
    phone: ''
  });

  

  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>(
    defaultLoyaltySettings
  );

  const [pageMessage, setPageMessage] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  const [receiptData, setReceiptData] = useState<SaleReceipt | null>(null);
  const [salesDraftHydrated, setSalesDraftHydrated] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const productInputRef = useRef<HTMLInputElement | null>(null);
  const firstQtyInputRef = useRef<HTMLInputElement | null>(null);
  const customerWrapperRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    window.api.getCashDrawerSettings()
      .then((settings) => {
        if (!mounted) return;
        setCashDrawerAutoOpen(Boolean(settings.auto_open_cash_sale));
      })
      .catch((error) => {
        console.error('Failed to load cash drawer settings:', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const activeInvoice =
    invoices.find((x) => x.id === activeInvoiceId) ?? invoices[0];

  const subTotal = useMemo(
    () =>
      activeInvoice.cart.reduce(
        (sum, item) => sum + item.quantity * Number(item.sell_price),
        0
      ),
    [activeInvoice.cart]
  );

  const normalDiscountValue = useMemo(() => {
    const discountNumber = Number(activeInvoice.discountDraft || 0);
    const value = Number.isFinite(discountNumber) ? Math.max(0, discountNumber) : 0;

    if (activeInvoice.discountType === 'percent') {
      const percent = Math.min(value, 100);
      return Math.min(subTotal, (subTotal * percent) / 100);
    }

    return Math.min(subTotal, value);
  }, [activeInvoice.discountDraft, activeInvoice.discountType, subTotal]);

  const totalAfterNormalDiscount = Math.max(0, subTotal - normalDiscountValue);

  const selectedCustomerPoints = Number(
    activeInvoice.customer?.points_balance ?? 0
  );

  const loyaltyEnabled =
    Boolean(loyaltySettings.loyalty_enabled) && Boolean(activeInvoice.customer);

  const pointValue = Math.max(
    0,
    Number(loyaltySettings.loyalty_point_value || 0)
  );

  const requestedRedeemPoints = normalizePositiveInt(
    activeInvoice.loyaltyPointsDraft
  );

  const maxRedeemByTotal =
    pointValue > 0 ? Math.floor(totalAfterNormalDiscount / pointValue) : 0;

  const maxRedeemPoints = loyaltyEnabled
    ? Math.max(0, Math.min(selectedCustomerPoints, maxRedeemByTotal))
    : 0;

  const redeemPoints = Math.min(requestedRedeemPoints, maxRedeemPoints);
  const loyaltyDiscountValue = redeemPoints * pointValue;
  const grandTotal = Math.max(0, totalAfterNormalDiscount - loyaltyDiscountValue);

  const paidReceivedRaw = activeInvoice.paidDraft.trim() === ''
    ? grandTotal
    : Number(activeInvoice.paidDraft || 0);

  const paidReceived = Number.isFinite(paidReceivedRaw)
    ? Math.max(0, paidReceivedRaw)
    : 0;

  const paidAmount = Math.min(paidReceived, grandTotal);
  const changeAmount = Math.max(0, paidReceived - grandTotal);
  const remainingAmount = Math.max(0, grandTotal - paidReceived);
  

  const paymentStatus = remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

  function openPaymentModal() {
    if (!user?.id) {
      showMessage('error', 'المستخدم غير مسجل');
      return;
    }

    if (activeInvoice.cart.length === 0) {
      showMessage('error', 'لا توجد أصناف في الفاتورة');
      return;
    }

    updateActiveInvoice({
      paidDraft: activeInvoice.paidDraft.trim() || String(grandTotal.toFixed(2))
    });

    setShowPaymentModal(true);
  }

  const estimatedEarnedPoints = useMemo(() => {
    if (!loyaltyEnabled) return 0;

    const earnAmount = Math.max(
      1,
      Number(loyaltySettings.loyalty_earn_amount || 1)
    );
    const earnPoints = Math.max(
      1,
      Number(loyaltySettings.loyalty_earn_points || 1)
    );

    return Math.floor(grandTotal / earnAmount) * earnPoints;
  }, [grandTotal, loyaltyEnabled, loyaltySettings]);

  const salesGridColumns = isCompact
    ? barcodeMode
      ? '40px 120px minmax(240px, 1fr) 82px 90px 105px'
      : '40px minmax(260px, 1fr) 82px 90px 105px'
    : barcodeMode
      ? '44px 160px minmax(320px, 1fr) 110px 120px 130px'
      : '44px minmax(420px, 1fr) 110px 120px 130px';

  const tableHeaderStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: salesGridColumns,
    gap: '10px',
    padding: '14px',
    color: '#cbd5e1',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    fontWeight: 800,
    alignItems: 'center'
  };

  const tableRowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: salesGridColumns,
    gap: '10px',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)'
  };

  function updateActiveInvoice(patch: Partial<InvoiceTab>) {
    setInvoices((prev) =>
      prev.map((invoice) =>
        invoice.id === activeInvoiceId ? { ...invoice, ...patch } : invoice
      )
    );
  }

  function setActiveCart(cart: CartItem[]) {
    updateActiveInvoice({ cart });
  }

  function focusMainInput() {
    requestAnimationFrame(() => {
      if (showAddCustomerModal || showPaymentModal || receiptData) return;

      if (barcodeMode) {
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
      } else {
        productInputRef.current?.focus();
        productInputRef.current?.select();
      }
    });
  }

  function forceBarcodeFocus() {
    window.focus();

    setBarcodeMode(true);
    setProductResults([]);
    setDropdownRect(null);
    setCustomerDropdownOpen(false);

    const focus = () => {
      const input = barcodeInputRef.current;

      if (input) {
        input.focus();
        input.select();
      }
    };

    requestAnimationFrame(focus);
    setTimeout(focus, 0);
    setTimeout(focus, 80);
    setTimeout(focus, 180);
  }

  function handlePageMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    if (showAddCustomerModal || showPaymentModal || receiptData) return;

    const target = e.target as HTMLElement | null;

    if (!target) return;

    const isInteractive = Boolean(
      target.closest(
        'input, textarea, select, button, a, [contenteditable="true"], .theme-popover, .theme-dropdown'
      )
    );

    if (isInteractive) return;

    e.preventDefault();
    forceBarcodeFocus();
  }

  useEffect(() => {
    function handleGlobalPointerDown(e: PointerEvent) {
      if (showAddCustomerModal || showPaymentModal || receiptData) return;

      const target = e.target as HTMLElement | null;

      if (!target) return;

      const isInteractive = Boolean(
        target.closest(
          'input, textarea, select, button, a, [contenteditable="true"], .theme-popover, .theme-dropdown, .theme-modal-overlay'
        )
      );

      if (isInteractive) return;

      e.preventDefault();
      forceBarcodeFocus();
    }

    document.addEventListener('pointerdown', handleGlobalPointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [showAddCustomerModal, showPaymentModal, receiptData, barcodeMode]);

  function showMessage(
    type: 'error' | 'success',
    text: string,
    focusAfterMessage = true
  ) {
    setPageMessage({ type, text });

    if (focusAfterMessage) {
      focusMainInput();
    }

    setTimeout(() => {
      setPageMessage(null);
      if (focusAfterMessage) {
        focusMainInput();
      }
    }, 1800);
  }

  function updateDropdownPosition() {
    const el = productInputRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();

    setDropdownRect({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width
    });
  }

  async function loadCustomers(searchValue = customerSearch) {
    setLoadingCustomers(true);

    try {
      const q = searchValue.trim();
      const data = q
        ? await window.api.searchCustomers(q)
        : await window.api.getCustomers();

      setCustomers(Array.isArray(data) ? data.map(normalizeCustomer) : []);
    } catch (error) {
      console.error('Failed to load customers:', error);
      setCustomers([]);
      showMessage('error', 'حدث خطأ أثناء تحميل العملاء', false);
    } finally {
      setLoadingCustomers(false);
    }
  }

  async function loadLoyaltySettings() {
    try {
      const settings = await window.api.getLoyaltySettings();
      setLoyaltySettings(settings ?? defaultLoyaltySettings);
    } catch (error) {
      console.error('Failed to load loyalty settings:', error);
      setLoyaltySettings(defaultLoyaltySettings);
    }
  }

  function addInvoice() {
    const newInvoice = createInvoice(nextInvoiceId);

    setInvoices((prev) => [...prev, newInvoice]);
    setActiveInvoiceId(newInvoice.id);
    setNextInvoiceId((prev) => prev + 1);
    setProductResults([]);
    setDropdownRect(null);
    setCustomerSearch('');

    setTimeout(focusMainInput, 0);
  }

  function closeInvoice(id: number) {
    if (invoices.length === 1) return;

    const filtered = invoices.filter((x) => x.id !== id);
    setInvoices(filtered);
    setProductResults([]);
    setDropdownRect(null);

    if (activeInvoiceId === id) {
      setActiveInvoiceId(filtered[0].id);
    }

    setTimeout(focusMainInput, 0);
  }

  function addToCart(item: SaleVariant) {
    const existing = activeInvoice.cart.find(
      (x) => x.variant_id === item.variant_id
    );

    const nextCart: CartItem[] = existing
      ? activeInvoice.cart.map((x) =>
          x.variant_id === item.variant_id
            ? { ...x, quantity: Math.min(x.quantity + 1, Number(x.stock)) }
            : x
        )
      : [...activeInvoice.cart, { ...item, quantity: 1 }];

    setActiveCart(nextCart);
    updateActiveInvoice({ barcodeDraft: '', productDraft: '' });
    setProductResults([]);
    setDropdownRect(null);
    focusMainInput();
  }

  function updateQty(variantId: number, qty: number) {
    const nextCart = activeInvoice.cart.map((item) =>
      item.variant_id === variantId
        ? {
            ...item,
            quantity: Math.max(1, Math.min(qty, Number(item.stock)))
          }
        : item
    );

    setActiveCart(nextCart);
  }

  function removeLine(variantId: number) {
    setActiveCart(activeInvoice.cart.filter((item) => item.variant_id !== variantId));
    focusMainInput();
  }

  async function handleBarcodeEnter() {
    const barcode = activeInvoice.barcodeDraft.trim();
    if (!barcode) return;

    try {
      const variant = await window.api.getVariantByBarcode(barcode);

      if (!variant) {
        showMessage('error', 'الباركود غير موجود');
        return;
      }

      if (Number(variant.stock) <= 0) {
        showMessage('error', 'الصنف غير متاح في المخزون');
        return;
      }

      addToCart(variant);
    } catch (error) {
      console.error(error);
      showMessage('error', 'حدث خطأ أثناء قراءة الباركود');
    }
  }

  function selectCustomer(customer: CustomerOption) {
    updateActiveInvoice({ customer, loyaltyPointsDraft: '' });
    setCustomerSearch('');
    setCustomerDropdownOpen(false);
    forceBarcodeFocus();
  }

  function clearCustomer() {
    updateActiveInvoice({ customer: null, loyaltyPointsDraft: '' });
    setCustomerSearch('');
    setCustomerDropdownOpen(false);
    forceBarcodeFocus();
  }

  function openAddCustomerModal() {
    setNewCustomer({ name: '', phone: '' });
    setCustomerDropdownOpen(false);
    setShowAddCustomerModal(true);
  }

  async function saveNewCustomer() {
    if (savingNewCustomer) return;

    const name = newCustomer.name.trim();
    const phone = newCustomer.phone.trim();

    if (!name) {
      showMessage('error', 'اسم العميل مطلوب', false);
      return;
    }

    setSavingNewCustomer(true);

    try {
      const created = await window.api.createCustomer({
        name,
        phone: phone || null
      });

      const createdCustomer = normalizeCustomer(created);

      setCustomers((prev) => [
        createdCustomer,
        ...prev.filter((customer) => customer.id !== createdCustomer.id)
      ]);

      updateActiveInvoice({
        customer: createdCustomer,
        loyaltyPointsDraft: ''
      });

      setShowAddCustomerModal(false);
      setCustomerSearch('');
      setCustomerDropdownOpen(false);
      showMessage('success', 'تم إضافة العميل', false);
      forceBarcodeFocus();
    } catch (error) {
      console.error('Failed to create customer:', error);
      showMessage('error', 'حدث خطأ أثناء إضافة العميل، تأكد أن رقم الهاتف غير مكرر', false);
    } finally {
      setSavingNewCustomer(false);
    }
  }

  function buildReceiptPrintHtml(
    receipt: SaleReceipt,
    storeInfo: StoreReceiptInfo = {},
    qrDataUrl = ''
  ) {
    const remainingAmount = Math.max(0, Number(receipt.sale.remaining_amount || 0));
    const grandTotal = Number(receipt.sale.grand_total || 0);
    const paidNetAmount = Math.max(0, grandTotal - remainingAmount);

    const storeName = String(storeInfo.app_name || 'ERP Store').trim();
    const storePhone = String(storeInfo.store_phone || '').trim();
    const storeAddress = String(storeInfo.store_address || '').trim();

    const cleanStorePhone =
      storePhone && storePhone !== storeName ? storePhone : '';

    const cleanStoreAddress =
      storeAddress && storeAddress !== storeName && storeAddress !== cleanStorePhone
        ? storeAddress
        : '';

    const rows = receipt.items
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.product_name)} ${escapeHtml(item.size || '')} ${escapeHtml(item.color || '')}</td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${money(item.unit_price)}</td>
            <td>${money(item.line_total)}</td>
          </tr>
        `
      )
      .join('');

    return `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>فاتورة #${escapeHtml(receipt.sale.id)}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              padding: 14px;
              font-family: Arial, Tahoma, sans-serif;
              color: #111;
              background: #fff;
              font-size: 12px;
            }
            .receipt { width: 280px; margin: 0 auto; }
            h2, p { margin: 0; }
            .center { text-align: center; }

            .receipt-header {
              text-align: center;
              line-height: 1.5;
            }

            .store-name {
              font-size: 18px;
              font-weight: 800;
              margin-bottom: 3px;
            }

            .store-info {
              font-size: 11px;
              color: #555;
              font-weight: 500;
            }

            .receipt-title {
              font-size: 14px;
              font-weight: 800;
              margin-bottom: 3px;
            }

            .qr-box {
              text-align: center;
              margin-top: 10px;
              padding-top: 10px;
              border-top: 1px dashed #bbb;
              font-size: 10px;
              color: #444;
            }

            .qr-box img {
              width: 92px;
              height: 92px;
              display: block;
              margin: 0 auto 5px;
            }

            .muted {
              color: #555;
              font-size: 11px;
            }
            .line { border-top: 1px dashed #777; margin: 10px 0; }
            .row { display: flex; justify-content: space-between; gap: 8px; margin: 5px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { padding: 5px 0; border-bottom: 1px dashed #ddd; text-align: right; vertical-align: top; }
            th { font-size: 11px; color: #333; }
            .total { font-weight: 800; font-size: 14px; }
            @media print { body { padding: 0; } .receipt { width: 100%; } }
            .engineer-footer {
              margin-top: 8px;
              padding-top: 8px;
              border-top: 1px dashed #bbb;
              font-size: 10.5px;
              color: #444;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>
          <div class="receipt">
          <div class="receipt-header">
            <div class="store-name">${escapeHtml(storeName)}</div>
            ${cleanStorePhone ? `<div class="store-info">تليفون: ${escapeHtml(cleanStorePhone)}</div>` : ''}
            ${cleanStoreAddress ? `<div class="store-info">العنوان: ${escapeHtml(cleanStoreAddress)}</div>` : ''}

            <div class="line"></div>

            <div class="receipt-title">فاتورة بيع</div>
            <div class="store-info">رقم الفاتورة: #${escapeHtml(receipt.sale.id)}</div>
            <div class="store-info">${escapeHtml(formatReceiptDate(receipt.sale.created_at))}</div>
          </div>

          <div class="line"></div>

            <div class="row"><span>العميل</span><strong>${escapeHtml(receipt.sale.customer_name || 'عميل نقدي')}</strong></div>
            <div class="row"><span>الكاشير</span><strong>${escapeHtml(receipt.sale.cashier_name || '-')}</strong></div>
            <div class="row"><span>طريقة الدفع</span><strong>${escapeHtml(getPaymentMethodLabel(receipt.sale.payment_method))}</strong></div>

            <table>
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>كمية</th>
                  <th>سعر</th>
                  <th>إجمالي</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>

            <div class="line"></div>

            <div class="row"><span>الإجمالي قبل الخصم</span><strong>${money(receipt.sale.sub_total)} ج.م</strong></div>
            <div class="row"><span>خصم عادي</span><strong>${money(receipt.sale.discount_value)} ج.م</strong></div>
            <div class="row"><span>خصم النقاط</span><strong>${money(receipt.sale.loyalty_discount_value)} ج.م</strong></div>
            <div class="row total"><span>الإجمالي النهائي</span><strong>${money(receipt.sale.grand_total)} ج.م</strong></div>
            <div class="row"><span>المدفوع</span><strong>${money(paidNetAmount)} ج.م</strong></div>
            <div class="row"><span>الباقي / المديونية</span><strong>${money(remainingAmount)} ج.م</strong></div>
            <div class="row"><span>حالة الدفع</span><strong>${escapeHtml(getPaymentStatusLabel(receipt.sale.payment_status))}</strong></div>
            <div class="line"></div>

            <div class="row"><span>نقاط مستخدمة</span><strong>${escapeHtml(receipt.sale.loyalty_points_redeemed || 0)}</strong></div>
            <div class="row"><span>نقاط مكتسبة</span><strong>${escapeHtml(receipt.sale.loyalty_points_earned || 0)}</strong></div>

            <div class="line"></div>
            ${qrDataUrl ? `
              <div class="qr-box">
                <img src="${qrDataUrl}" alt="Invoice QR" />
                <div>${escapeHtml(storeInfo.store_qr_title || 'امسح الكود للتواصل معنا')}</div>
              </div>
            ` : ''}
            <p class="center muted">شكرًا لتعاملكم معنا</p>
            <p class="center engineer-footer">${escapeHtml(ENGINEER_FOOTER)}</p>
          </div>
        </body>
      </html>
    `;
  }

  async function printReceipt() {
    if (!receiptData) return;

    let storeInfo: StoreReceiptInfo = {};

    try {
      const status = await window.api.getLicenseStatus();

      storeInfo = {
        app_name: status.app_name,
        store_phone: status.store_phone,
        store_address: status.store_address,
        store_qr_enabled: status.store_qr_enabled,
        store_qr_title: status.store_qr_title,
        store_qr_primary_url: status.store_qr_primary_url
      };
    } catch (error) {
      console.error('Failed to load store receipt info:', error);
    }

    const popup = window.open('', '_blank', 'width=420,height=700');

    if (!popup) {
      showMessage('error', 'المتصفح منع فتح نافذة الطباعة', false);
      return;
    }

    popup.document.open();
    let qrDataUrl = '';

    if (storeInfo.store_qr_enabled && storeInfo.store_qr_primary_url?.trim()) {
      qrDataUrl = await QRCode.toDataURL(storeInfo.store_qr_primary_url.trim(), {
        width: 120,
        margin: 1,
        errorCorrectionLevel: 'M'
      });
    }

    popup.document.write(buildReceiptPrintHtml(receiptData, storeInfo, qrDataUrl));
    popup.document.close();
    popup.focus();

    setTimeout(() => {
      popup.print();
      popup.close();
    }, 350);
  }

  async function handleOpenCashDrawer(
    reason: 'manual' | 'sale' | 'test' = 'manual',
    saleId: number | null = null,
    showSuccess = true
  ) {
    if (reason === 'manual' && openingCashDrawer) return false;

    if (reason === 'manual') {
      setOpeningCashDrawer(true);
    }

    try {
      const result = await window.api.openCashDrawer({
        actor_id: user?.id,
        reason,
        sale_id: saleId
      });

      if (!result.success) {
        console.warn('Cash drawer failed:', result.message);

        // مهم: في الفتح التلقائي بعد البيع مانطلعش رسالة حمراء
        if (showSuccess) {
          showMessage(
            'error',
            'تعذر فتح درج الكاشير، تأكد من توصيل الدرج والطابعة',
            false
          );
        }

        return false;
      }

      if (showSuccess) {
        showMessage('success', 'تم إرسال أمر فتح درج الكاشير', false);
      }

      return true;
    } catch (error) {
      console.error('Failed to open cash drawer:', error);

      // مهم: في الفتح التلقائي بعد البيع مانطلعش رسالة حمراء
      if (showSuccess) {
        showMessage(
          'error',
          'تعذر فتح درج الكاشير، تأكد من توصيل الدرج والطابعة',
          false
        );
      }

      return false;
    } finally {
      if (reason === 'manual') {
        setOpeningCashDrawer(false);
      }
    }
  }

  async function saveSale() {
    if (saving) return;

    if (!user?.id) {
      showMessage('error', 'المستخدم غير مسجل');
      return;
    }

    if (activeInvoice.cart.length === 0) {
      showMessage('error', 'لا توجد أصناف في الفاتورة');
      return;
    }

    if (requestedRedeemPoints > 0 && !activeInvoice.customer) {
      showMessage('error', 'اختار عميل قبل استخدام نقاط الولاء');
      return;
    }

    if (requestedRedeemPoints > maxRedeemPoints && maxRedeemPoints > 0) {
      updateActiveInvoice({ loyaltyPointsDraft: String(maxRedeemPoints) });
    }

    if (remainingAmount > 0 && !activeInvoice.customer) {
      showMessage('error', 'لا يمكن تسجيل مديونية بدون اختيار عميل');
      return;
    }

    setSaving(true);

    try {
      const result = await window.api.createSale({
        user_id: user.id,
        customer_id: activeInvoice.customer?.id ?? null,
        sub_total: subTotal,
        discount_value: normalDiscountValue,
        grand_total: grandTotal,
        paid: paidAmount,
        remaining_amount: remainingAmount,
        payment_status: paymentStatus,
        change_amount: changeAmount,
        payment_method: activeInvoice.paymentMethod || 'cash',
        notes: null,
        loyalty_points_redeemed: redeemPoints,
        loyalty_discount_value: loyaltyDiscountValue,
        items: activeInvoice.cart.map((item) => ({
          variant_id: item.variant_id,
          product_name: item.product_name,
          barcode: item.barcode,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
          unit_price: Number(item.sell_price)
        }))
      });

      const savedSaleId = Number(result.saleId);
      const savedPaymentMethod = activeInvoice.paymentMethod || 'cash';

      if (savedPaymentMethod === 'cash' && cashDrawerAutoOpen) {
        void handleOpenCashDrawer('sale', savedSaleId, false);
      }

      try {
        const receipt = await window.api.getSaleReceipt(Number(result.saleId));
        setShowPaymentModal(false);
        setReceiptData(receipt);
      } catch (receiptError) {
        console.error('Failed to load receipt:', receiptError);

        const earned = Number(result?.loyalty_points_earned || 0);
        const successText = earned > 0
          ? `تم حفظ الفاتورة رقم ${result.saleId} وكسب العميل ${earned} نقطة`
          : `تم حفظ الفاتورة رقم ${result.saleId}`;

        setShowPaymentModal(false);
        showMessage('success', successText);
      }

      updateActiveInvoice({
        cart: [],
        barcodeDraft: '',
        productDraft: '',
        customer: null,
        loyaltyPointsDraft: '',
        paidDraft: '',
        paymentMethod: 'cash',
        discountType: 'amount',
        discountDraft: '',
      });

      if (invoices.length === 1) {
        updateActiveInvoice({
          cart: [],
          barcodeDraft: '',
          productDraft: '',
          customer: null,
          loyaltyPointsDraft: '',
          paidDraft: '',
          paymentMethod: 'cash',
          discountType: 'amount',
          discountDraft: ''
        });

        localStorage.removeItem(SALES_DRAFT_STORAGE_KEY);
      } else {
        const remainingInvoices = invoices.filter((invoice) => invoice.id !== activeInvoiceId);

        setInvoices(remainingInvoices);
        setActiveInvoiceId(remainingInvoices[0].id);
      }

      const licenseData = await window.api.getLicenseStatus();

      setStoreInfo({
        name: licenseData.app_name || 'اسم المحل',
        address: '',
        phone: ''
      });

      setProductResults([]);
      setDropdownRect(null);
      setCustomerSearch('');
      void loadCustomers('');
      setTimeout(focusMainInput, 0);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error && error.message
        ? error.message
        : 'حدث خطأ أثناء حفظ الفاتورة';
      showMessage('error', message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const q = activeInvoice.productDraft.trim();

    if (!q) {
      setProductResults([]);
      setDropdownRect(null);
      return;
    }

    updateDropdownPosition();

    const handle = setTimeout(() => {
      void window.api
        .searchSaleVariants({
          query: q,
          categoryId: saleCategoryFilter
        })
        .then((results) => {
          setProductResults(results);
          updateDropdownPosition();
        })
        .catch((error) => {
          console.error('Search failed:', error);
          setProductResults([]);
          setDropdownRect(null);
        });
    }, 200);

    return () => clearTimeout(handle);
  }, [activeInvoice.productDraft, activeInvoiceId, saleCategoryFilter]);

  useEffect(() => {
    function handleReposition() {
      if (productResults.length > 0) updateDropdownPosition();
    }

    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [productResults.length]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (showAddCustomerModal || receiptData) return;

      if (e.key === 'F8') {
        e.preventDefault();

        if (!saving && !openingCashDrawer) {
          void handleOpenCashDrawer('manual', null, true);
        }

        return;
      }

      if (showPaymentModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowPaymentModal(false);
          return;
        }

        if (e.key === 'F12') {
          e.preventDefault();
          if (!saving) void saveSale();
          return;
        }

        return;
      }

      if (e.key === 'F5') {
        e.preventDefault();
        firstQtyInputRef.current?.focus();
        firstQtyInputRef.current?.select();
        return;
      }

      if (e.key === 'F6') {
        e.preventDefault();

        if (barcodeMode) {
          barcodeInputRef.current?.focus();
          barcodeInputRef.current?.select();
        } else {
          productInputRef.current?.focus();
          productInputRef.current?.select();
        }

        return;
      }

      if (e.key === 'F9') {
        e.preventDefault();
        addInvoice();
        return;
      }

      if (e.key === 'F12') {
        e.preventDefault();
        if (!saving) openPaymentModal();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [
    activeInvoiceId,
    activeInvoice,
    subTotal,
    saving,
    barcodeMode,
    showAddCustomerModal,
    showPaymentModal,
    receiptData,
    grandTotal,
    redeemPoints,
    loyaltyDiscountValue,
    normalDiscountValue,
    paidAmount,
    changeAmount,
    remainingAmount,
    paymentStatus,
    requestedRedeemPoints,
    maxRedeemPoints,
    openingCashDrawer
  ]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SALES_DRAFT_STORAGE_KEY);

      if (!raw) {
        setSalesDraftHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw);
      const loadedInvoices = Array.isArray(parsed?.invoices)
        ? parsed.invoices
            .map((invoice: any, index: number) => normalizeInvoiceDraft(invoice, index + 1))
            .filter((invoice: InvoiceTab) => invoice.id > 0)
        : [];

      if (loadedInvoices.length > 0) {
        const validIds = loadedInvoices.map((invoice: InvoiceTab) => invoice.id);
        const requestedActiveId = Number(parsed?.activeInvoiceId || loadedInvoices[0].id);
        const nextIdFromDraft = Number(parsed?.nextInvoiceId || 0);
        const maxId = Math.max(...validIds);

        setInvoices(loadedInvoices);
        setActiveInvoiceId(validIds.includes(requestedActiveId) ? requestedActiveId : loadedInvoices[0].id);
        setNextInvoiceId(Math.max(nextIdFromDraft, maxId + 1, 2));
        setBarcodeMode(parsed?.barcodeMode === false ? false : true);
      }
    } catch (error) {
      console.error('Failed to restore sales draft:', error);
      localStorage.removeItem(SALES_DRAFT_STORAGE_KEY);
    } finally {
      setSalesDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!salesDraftHydrated) return;

    const hasDraft =
      invoices.length > 1 ||
      invoices.some((invoice) =>
        invoice.cart.length > 0 ||
        invoice.customer ||
        invoice.barcodeDraft.trim() ||
        invoice.productDraft.trim() 
      );

    if (!hasDraft) {
      localStorage.removeItem(SALES_DRAFT_STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      SALES_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        invoices: invoices.map(serializeInvoiceDraft),
        activeInvoiceId,
        nextInvoiceId,
        barcodeMode,
        savedAt: new Date().toISOString()
      })
    );
  }, [salesDraftHydrated, invoices, activeInvoiceId, nextInvoiceId, barcodeMode]);

  useEffect(() => {
    window.focus();
    void loadCustomers('');
    void loadLoyaltySettings();

    void window.api
      .getCategories()
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.error('Failed to load categories:', error);
        setCategories([]);
      });

    setTimeout(focusMainInput, 100);
  }, []);

  useEffect(() => {
    const element = pageRef.current;

    if (!element) return;

    function updateCompact(width: number) {
      setIsCompact(width <= 980);
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
    if (!customerDropdownOpen) return;

    const handle = setTimeout(() => {
      void loadCustomers(customerSearch);
    }, 220);

    return () => clearTimeout(handle);
  }, [customerSearch, customerDropdownOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        customerWrapperRef.current &&
        !customerWrapperRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div
      ref={pageRef}
      onMouseDown={handlePageMouseDown}
      style={{
        display: 'grid',
        gap: '18px',
        minHeight: 0,
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden'
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

      <div
        className="glass-card"
        style={{
          borderRadius: '18px',
          padding: '14px',
          display: 'grid',
          gridTemplateColumns: isCompact ? '1fr' : 'auto minmax(0, 1fr)',
          gap: '12px',
          direction: 'ltr',
          overflow: 'hidden',
          maxWidth: '100%',
          minWidth: 0
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: isCompact ? 'wrap' : 'nowrap',
            width: isCompact ? '100%' : undefined,
            justifySelf: isCompact ? 'stretch' : 'start'
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addInvoice}
            style={{
              ...primaryButtonStyle,
              width: isCompact ? '100%' : undefined
            }}
          >
            + فاتورة جديدة F9
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleOpenCashDrawer('manual', null, true)}
            disabled={openingCashDrawer || saving}
            style={{
              ...secondaryOutlineButtonStyle,
              minWidth: isCompact ? '100%' : '130px',
              width: isCompact ? '100%' : undefined,
              borderColor: 'rgba(34,197,94,0.45)',
              color: '#86efac',
              opacity: openingCashDrawer || saving ? 0.6 : 1,
              cursor: openingCashDrawer || saving ? 'not-allowed' : 'pointer'
            }}
          >
            {openingCashDrawer ? 'جاري الفتح...' : 'فتح الدرج F8'}
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'nowrap',
            direction: 'rtl',
            overflowX: 'auto',
            maxWidth: '100%',
            width: '100%',
            paddingBottom: '4px',
            minWidth: 0
          }}
        >
          {invoices.map((invoice) => {
            const active = invoice.id === activeInvoiceId;

            return (
              <div
                key={invoice.id}
                onClick={() => {
                  setActiveInvoiceId(invoice.id);
                  setProductResults([]);
                  setDropdownRect(null);
                  setCustomerSearch('');
                  setTimeout(focusMainInput, 0);
                }}
                style={{
                  minWidth: '130px',
                  height: '50px',
                  borderRadius: '12px',
                  border: active
                    ? '1px solid #7c3aed'
                    : '1px solid rgba(255,255,255,0.08)',
                  background: active
                    ? 'rgba(124,58,237,0.12)'
                    : 'rgba(255,255,255,0.04)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 12px',
                  cursor: 'pointer',
                  fontWeight: 700
                }}
              >
                <span>{invoice.title}</span>

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeInvoice(invoice.id);
                  }}
                  style={miniCloseButtonStyle}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="glass-card"
        style={{
          borderRadius: '18px',
          padding: isCompact ? '14px' : '28px',
          minHeight: 0,
          width: '100%',
          maxWidth: '100%',
          overflow: 'hidden',
          boxSizing: 'border-box'
        }}
      >
        <h2 style={{ margin: '0 0 24px', textAlign: 'right' }}>فاتورة بيع</h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isCompact ? '1fr' : 'minmax(280px, 1fr) auto',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '20px',
            maxWidth: '100%',
            minWidth: 0
          }}
        >
          <div
            ref={customerWrapperRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: isCompact ? '100%' : '420px',
              maxWidth: '100%',
              minWidth: 0
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                direction: 'ltr',
                width: '100%',
                minWidth: 0,
                height: '46px',
                borderRadius: '12px',
                border: customerDropdownOpen
                  ? '1px solid rgba(124,58,237,0.65)'
                  : '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
                boxShadow: customerDropdownOpen
                  ? '0 0 0 3px rgba(124,58,237,0.16)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.03)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  paddingLeft: '8px',
                  paddingRight: '6px'
                }}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openAddCustomerModal}
                  style={roundAddButtonStyle}
                >
                  +
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCustomerDropdownOpen((prev) => !prev)}
                  style={{
                    width: '22px',
                    height: '22px',
                    minWidth: '22px',
                    border: 'none',
                    background: 'transparent',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                    transform: customerDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.18s ease'
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M5 7.5L10 12.5L15 7.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <div
                style={{
                  width: '1px',
                  alignSelf: 'stretch',
                  background: 'rgba(255,255,255,0.06)'
                }}
              />

              <input
                type="text"
                placeholder="اختر عميل"
                className="customer-select-input"
                value={customerSearch || activeInvoice.customer?.name || ''}
                onFocus={() => setCustomerDropdownOpen(true)}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerDropdownOpen(true);
                }}
                style={{
                  flex: 1,
                  height: '100%',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  padding: '0 14px',
                  textAlign: 'right',
                  direction: 'rtl',
                  color: '#e5e7eb',
                  fontSize: '14px'
                }}
              />

              {activeInvoice.customer && !customerSearch && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearCustomer}
                  title="إزالة العميل"
                  style={clearButtonStyle}
                >
                  ×
                </button>
              )}
            </div>

            {customerDropdownOpen && (
              <div
                className="theme-popover theme-dropdown"
                style={{
                  position: 'absolute',
                  top: '54px',
                  left: 0,
                  width: '100%',
                  minWidth: 0,
                  maxHeight: '260px',
                  overflowY: 'auto',
                  borderRadius: '14px',
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: '#111827',
                  zIndex: 99999,
                  boxShadow: '0 22px 50px rgba(0,0,0,0.45)',
                  padding: '6px'
                }}
              >
                {loadingCustomers ? (
                  <div style={emptyDropdownStyle}>جاري تحميل العملاء...</div>
                ) : customers.length === 0 ? (
                  <div style={emptyDropdownStyle}>لا يوجد عملاء</div>
                ) : (
                  customers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectCustomer(customer)}
                      style={{
                        width: '100%',
                        border: 'none',
                        borderRadius: '10px',
                        background:
                          activeInvoice.customer?.id === customer.id
                            ? 'rgba(124,58,237,0.20)'
                            : 'transparent',
                        color: '#fff',
                        padding: '12px',
                        cursor: 'pointer',
                        textAlign: 'right',
                        direction: 'rtl',
                        display: 'grid',
                        gap: '5px'
                      }}
                    >
                      <strong>{customer.name}</strong>

                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                        {customer.phone || 'بدون رقم'} • {customer.points_balance || 0} نقطة
                      </span>
                    </button>
                  ))
                )}

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openAddCustomerModal}
                  style={{
                    width: '100%',
                    marginTop: '6px',
                    border: '1px dashed rgba(124,58,237,0.65)',
                    borderRadius: '10px',
                    background: 'rgba(124,58,237,0.10)',
                    color: '#c4b5fd',
                    padding: '12px',
                    cursor: 'pointer',
                    fontWeight: 800
                  }}
                >
                  + إضافة عميل جديد
                </button>
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: '#cbd5e1',
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}
          >
            <span>البيع بالباركود</span>

            <button
              type="button"
              role="switch"
              aria-checked={barcodeMode}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setBarcodeMode((prev) => !prev);
                setProductResults([]);
                setDropdownRect(null);
                setTimeout(focusMainInput, 0);
              }}
              style={{
                width: '48px',
                height: '26px',
                borderRadius: '999px',
                border: 'none',
                padding: '3px',
                cursor: 'pointer',
                background: barcodeMode ? '#2563eb' : '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: barcodeMode ? 'flex-end' : 'flex-start',
                transition: 'all 0.2s ease'
              }}
            >
              <span
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: '#fff',
                  display: 'block',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                  transition: 'all 0.2s ease'
                }}
              />
            </button>
          </div>
        </div>

        <div
          style={{
            ...summaryStyle,
            display: 'grid',
            gridTemplateColumns: isCompact
              ? 'repeat(2, minmax(0, 1fr))'
              : 'repeat(4, minmax(0, 1fr))',
            overflow: 'hidden'
          }}
        >
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            عدد الأصناف | <span>{activeInvoice.cart.length}</span>
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            الإجمالي قبل الخصم | <span>{subTotal.toFixed(2)} ج.م</span>
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            خصم النقاط | <span>{loyaltyDiscountValue.toFixed(2)} ج.م</span>
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            المطلوب دفعه | <span>{grandTotal.toFixed(2)} ج.م</span>
          </div>
        </div>

        {activeInvoice.customer && (
          <div style={loyaltyPanelStyle}>
            <div style={{ display: 'grid', gap: '4px' }}>
              <strong>نقاط العميل: {selectedCustomerPoints}</strong>
              <span style={{ color: '#94a3b8', fontSize: '13px' }}>
                {loyaltySettings.loyalty_enabled
                  ? `متاح استخدام حتى ${maxRedeemPoints} نقطة، والعميل سيكسب تقريبًا ${estimatedEarnedPoints} نقطة بعد الحفظ.`
                  : 'نظام نقاط الولاء غير مفعل من الإعدادات.'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="number"
                min={0}
                max={maxRedeemPoints}
                disabled={!loyaltyEnabled || maxRedeemPoints === 0}
                placeholder="استخدم نقاط"
                value={activeInvoice.loyaltyPointsDraft}
                onChange={(e) =>
                  updateActiveInvoice({ loyaltyPointsDraft: e.target.value })
                }
                style={{
                  ...tableInputStyle,
                  width: '150px',
                  textAlign: 'center',
                  opacity: !loyaltyEnabled || maxRedeemPoints === 0 ? 0.6 : 1
                }}
              />

              <div style={{ color: '#bfdbfe', fontWeight: 800 }}>
                الخصم الحالي: {loyaltyDiscountValue.toFixed(2)} ج.م
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: '10px',
            direction: 'rtl',
            marginBottom: '12px',
            flexWrap: 'wrap'
          }}
        >
          <span style={{ color: '#cbd5e1', fontWeight: 800 }}>
            تصنيف المنتجات
          </span>

          <select
            value={saleCategoryFilter}
            onChange={(e) => {
              setSaleCategoryFilter(e.target.value);
              setProductResults([]);
              setDropdownRect(null);
              setTimeout(focusMainInput, 0);
            }}
            style={{
              ...tableInputStyle,
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

        <div
          style={{
            overflowX: 'auto',
            overflowY: 'visible',
            width: '100%',
            maxWidth: '100%'
          }}
        >
          <div
            style={{
              minWidth: barcodeMode
                ? isCompact
                  ? '640px'
                  : '920px'
                : isCompact
                  ? '540px'
                  : '760px'
            }}
          >
            <div style={tableHeaderStyle}>
              <div></div>
              {barcodeMode && <div>باركود (F6)</div>}
              <div>المنتج</div>
              <div>الكمية (F5)</div>
              <div>السعر</div>
              <div>الإجمالي</div>
            </div>

            {activeInvoice.cart.map((item, index) => (
              <div key={item.variant_id} style={tableRowStyle}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => removeLine(item.variant_id)}
                  style={removeButtonStyle}
                >
                  −
                </button>

                {barcodeMode && (
                  <input value={item.barcode} readOnly style={tableInputStyle} />
                )}

                <input
                  value={`${item.product_name} | ${item.size || '—'} | ${item.color || '—'} | سعر: ${money(item.sell_price)} ج.م`}
                  readOnly
                  style={{
                    ...tableInputStyle,
                    direction: 'rtl',
                    textAlign: 'right'
                  }}
                />

                <input
                  ref={index === 0 ? firstQtyInputRef : null}
                  type="number"
                  min={1}
                  max={item.stock}
                  value={item.quantity}
                  onChange={(e) =>
                    updateQty(item.variant_id, Number(e.target.value || 1))
                  }
                  style={{
                    ...tableInputStyle,
                    color: '#f43f5e',
                    fontWeight: 800,
                    textAlign: 'center'
                  }}
                />

                <input value={item.sell_price} readOnly style={tableInputStyle} />

                <strong style={{ textAlign: 'left' }}>
                  {(item.quantity * Number(item.sell_price)).toFixed(2)}
                </strong>
              </div>
            ))}

            <div
              style={{
                ...tableRowStyle,
                background: 'rgba(124,58,237,0.10)'
              }}
            >
              <button
                type="button"
                disabled
                style={{
                  ...removeButtonStyle,
                  opacity: 0.4,
                  cursor: 'not-allowed'
                }}
              >
                −
              </button>

              {barcodeMode && (
                <input
                  ref={barcodeInputRef}
                  autoComplete="off"
                  value={activeInvoice.barcodeDraft}
                  onChange={(e) =>
                    updateActiveInvoice({ barcodeDraft: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleBarcodeEnter();
                    }
                  }}
                  placeholder="باركود"
                  style={tableInputStyle}
                />
              )}

              <input
                ref={productInputRef}
                autoComplete="off"
                value={activeInvoice.productDraft}
                onFocus={updateDropdownPosition}
                onChange={(e) => {
                  updateActiveInvoice({ productDraft: e.target.value });
                  updateDropdownPosition();
                }}
                placeholder="اختر منتج"
                style={{
                  ...tableInputStyle,
                  direction: 'rtl',
                  textAlign: 'right'
                }}
              />

              <strong style={{ textAlign: 'center' }}>1</strong>
              <strong>0.0</strong>
              <strong>0.0</strong>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: '24px',
            display: 'flex',
            justifyContent: 'flex-start',
            direction: 'rtl',
            maxWidth: '100%'
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openPaymentModal}
            disabled={saving || activeInvoice.cart.length === 0}
            style={{
              ...secondaryOutlineButtonStyle,
              minWidth: isCompact ? '100%' : '180px',
              width: isCompact ? '100%' : undefined,
              opacity: saving || activeInvoice.cart.length === 0 ? 0.6 : 1,
              cursor:
                saving || activeInvoice.cart.length === 0
                  ? 'not-allowed'
                  : 'pointer'
            }}
          >
            {saving ? 'جاري الحفظ...' : 'F12 / دفع'}
          </button>
        </div>
      </div>

      {productResults.length > 0 && dropdownRect && (
        <div
          className="theme-popover theme-dropdown"
          style={{
            position: 'fixed',
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            background: '#111827',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '12px',
            zIndex: 99998,
            maxHeight: '260px',
            overflowY: 'auto',
            boxShadow: '0 22px 50px rgba(0,0,0,0.45)'
          }}
        >
          {productResults.map((item) => (
            <button
              key={item.variant_id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addToCart(item)}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                color: '#fff',
                padding: '13px 14px',
                textAlign: 'right',
                cursor: 'pointer',
                display: 'block',
                fontWeight: 700
              }}
            >
              <div style={{ display: 'grid', gap: '4px' }}>
                <strong>
                  {item.product_name} | {item.size || '—'} | {item.color || '—'} | {item.sell_price} ج
                </strong>

                <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                  التصنيف: {item.category_name || 'بدون تصنيف'} | المخزون: {item.stock}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {receiptData && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.58)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              width: '760px',
              maxWidth: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: '#111827',
              boxShadow: '0 28px 80px rgba(0,0,0,0.58)',
              padding: '22px',
              direction: 'rtl',
              color: '#fff'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '14px',
                marginBottom: '18px'
              }}
            >
              <div style={{ display: 'grid', gap: '6px' }}>
                <h3 style={{ margin: 0 }}>تم حفظ الفاتورة #{receiptData.sale.id}</h3>
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>
                  {formatReceiptDate(receiptData.sale.created_at)}
                </span>
              </div>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setReceiptData(null);
                  setTimeout(focusMainInput, 0);
                }}
                style={miniCloseButtonStyle}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '10px',
                marginBottom: '16px'
              }}
            >
              <div style={receiptInfoCardStyle}>
                <span>العميل</span>
                <strong>{receiptData.sale.customer_name || 'عميل نقدي'}</strong>
              </div>

              <div style={receiptInfoCardStyle}>
                <span>الكاشير</span>
                <strong>{receiptData.sale.cashier_name || '—'}</strong>
              </div>

              <div style={receiptInfoCardStyle}>
                <span>طريقة الدفع</span>
                <strong>{getPaymentMethodLabel(receiptData.sale.payment_method)}</strong>
              </div>
            </div>

            <div
              style={{
                borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
                marginBottom: '16px'
              }}
            >
              <div style={receiptTableHeaderStyle}>
                <div>الصنف</div>
                <div>الكمية</div>
                <div>السعر</div>
                <div>الإجمالي</div>
              </div>

              {receiptData.items.map((item) => (
                <div key={item.id} style={receiptTableRowStyle}>
                  <div style={{ display: 'grid', gap: '4px' }}>
                    <strong>{item.product_name}</strong>
                    <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                      {item.size || '—'} / {item.color || '—'}
                    </span>
                  </div>

                  <div>{item.quantity}</div>
                  <div>{money(item.unit_price)} ج.م</div>
                  <div>{money(item.line_total)} ج.م</div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '10px',
                marginBottom: '18px'
              }}
            >
              <div style={receiptInfoCardStyle}>
                <span>الإجمالي قبل الخصم</span>
                <strong>{money(receiptData.sale.sub_total)} ج.م</strong>
              </div>

              <div style={receiptInfoCardStyle}>
                <span>خصم عادي</span>
                <strong>{money(receiptData.sale.discount_value)} ج.م</strong>
              </div>

              <div style={receiptInfoCardStyle}>
                <span>خصم النقاط</span>
                <strong>{money(receiptData.sale.loyalty_discount_value)} ج.م</strong>
              </div>

              <div style={{ ...receiptInfoCardStyle, borderColor: 'rgba(16,185,129,0.40)' }}>
                <span>الإجمالي النهائي</span>
                <strong>{money(receiptData.sale.grand_total)} ج.م</strong>
              </div>

              <div style={receiptInfoCardStyle}>
                <span>النقاط</span>
                <strong>
                  +{receiptData.sale.loyalty_points_earned || 0} / -
                  {receiptData.sale.loyalty_points_redeemed || 0}
                </strong>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-start',
                flexWrap: 'wrap'
              }}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void printReceipt()}
                style={primaryButtonStyle}
              >
                طباعة الفاتورة
              </button>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setReceiptData(null);
                  forceBarcodeFocus();
                }}
                style={secondaryOutlineButtonStyle}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCustomerModal && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              width: '420px',
              maxWidth: '100%',
              borderRadius: '18px',
              border: '1px solid rgba(255,255,255,0.10)',
              background: '#111827',
              boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
              padding: '22px',
              direction: 'rtl'
            }}
          >
            <h3 style={{ margin: '0 0 18px', color: '#fff' }}>إضافة عميل جديد</h3>

            <div style={{ display: 'grid', gap: '14px' }}>
              <input
                autoFocus
                placeholder="اسم العميل"
                value={newCustomer.name}
                onChange={(e) =>
                  setNewCustomer((prev) => ({ ...prev, name: e.target.value }))
                }
                style={{
                  ...tableInputStyle,
                  textAlign: 'right',
                  direction: 'rtl'
                }}
              />

              <input
                placeholder="رقم الهاتف"
                value={newCustomer.phone}
                onChange={(e) =>
                  setNewCustomer((prev) => ({ ...prev, phone: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveNewCustomer();
                  }
                }}
                style={{
                  ...tableInputStyle,
                  textAlign: 'right',
                  direction: 'rtl'
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-start',
                gap: '10px',
                marginTop: '22px'
              }}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void saveNewCustomer()}
                disabled={savingNewCustomer}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveNewCustomer();
                  }
                }}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingNewCustomer ? 0.6 : 1,
                  cursor: savingNewCustomer ? 'not-allowed' : 'pointer'
                }}
              >
                {savingNewCustomer ? 'جاري الحفظ...' : 'حفظ العميل'}
              </button>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setShowAddCustomerModal(false);
                  forceBarcodeFocus();
                }}
                style={secondaryOutlineButtonStyle}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div
          className="theme-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.62)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className="theme-modal-card"
            style={{
              width: '520px',
              maxWidth: '100%',
              borderRadius: '22px',
              background: 'linear-gradient(180deg, rgba(17,24,39,0.98), rgba(15,23,42,0.98))',
              color: '#f8fafc',
              padding: '22px',
              direction: 'rtl',
              boxShadow: '0 28px 80px rgba(0,0,0,0.55)',
              border: '1px solid rgba(255,255,255,0.10)',
              display: 'grid',
              gap: '14px'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                borderRadius: '14px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.10)',
                fontWeight: 900,
                fontSize: '20px'
              }}
            >
              <span>الإجمالي</span>
              <strong>{money(grandTotal)} ج.م</strong>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <button
                type="button"
                className={`discount-toggle-button ${
                  activeInvoice.discountType === 'amount' ? 'is-active' : ''
                }`}
                onClick={() => updateActiveInvoice({ discountType: 'amount' })}
                style={paymentToggleButtonStyle}
              >
                خصم جنيه
              </button>

              <button
                type="button"
                className={`discount-toggle-button ${
                  activeInvoice.discountType === 'percent' ? 'is-active' : ''
                }`}
                onClick={() => updateActiveInvoice({ discountType: 'percent' })}
                style={paymentToggleButtonStyle}
              >
                خصم %
              </button>
            </div>

            <label style={paymentLabelStyle}>
              الخصم
              <input
                type="number"
                min={0}
                value={activeInvoice.discountDraft}
                onChange={(e) => updateActiveInvoice({ discountDraft: e.target.value })}
                placeholder={activeInvoice.discountType === 'percent' ? 'مثال: 10%' : 'مثال: 50'}
                style={paymentInputStyle}
              />
            </label>

            <label style={paymentLabelStyle}>
              المدفوع
              <input
                type="number"
                min={0}
                autoFocus
                value={activeInvoice.paidDraft}
                onChange={(e) => updateActiveInvoice({ paidDraft: e.target.value })}
                style={{
                  ...paymentInputStyle,
                  borderColor: '#7c3aed'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void saveSale();
                  }

                  if (e.key === 'Escape') {
                    setShowPaymentModal(false);
                  }
                }}
              />
            </label>

            <label style={paymentLabelStyle}>
              طريقة الدفع

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '10px'
                }}
              >
                {CUSTOMER_PAYMENT_METHOD_OPTIONS.map((option) => {
                  const active = activeInvoice.paymentMethod === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateActiveInvoice({ paymentMethod: option.value })}
                      style={{
                        minHeight: '58px',
                        borderRadius: '14px',
                        border: active
                          ? '1px solid rgba(124,58,237,0.95)'
                          : '1px solid rgba(255,255,255,0.12)',
                        background: active
                          ? 'linear-gradient(135deg, rgba(37,99,235,0.36), rgba(124,58,237,0.44))'
                          : 'rgba(255,255,255,0.055)',
                        color: active ? '#fff' : '#cbd5e1',
                        fontWeight: 950,
                        cursor: 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                        textAlign: 'center',
                        padding: '8px 10px',
                        boxShadow: active ? '0 0 0 3px rgba(124,58,237,0.16)' : 'none',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </label>

            <div
              style={{
                padding: '14px',
                borderRadius: '14px',
                background: changeAmount > 0
                  ? 'rgba(16,185,129,0.10)'
                  : remainingAmount > 0
                    ? 'rgba(249,115,22,0.10)'
                    : 'rgba(255,255,255,0.06)',
                border: changeAmount > 0
                  ? '1px solid rgba(16,185,129,0.25)'
                  : remainingAmount > 0
                    ? '1px solid rgba(249,115,22,0.25)'
                    : '1px solid rgba(255,255,255,0.10)',
                display: 'grid',
                gap: '8px',
                fontWeight: 900
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>الإجمالي قبل الخصومات</span>
                <strong>{money(subTotal)} ج.م</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>الخصم</span>
                <strong>{money(normalDiscountValue)} ج.م</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>خصم النقاط</span>
                <strong>{money(loyaltyDiscountValue)} ج.م</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>المطلوب</span>
                <strong>{money(grandTotal)} ج.م</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>الباقي للعميل</span>
                <strong style={{ color: '#16a34a' }}>{money(changeAmount)} ج.م</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>مديونية على العميل</span>
                <strong style={{ color: '#ea580c' }}>{money(remainingAmount)} ج.م</strong>
              </div>
            </div>

            {remainingAmount > 0 && !activeInvoice.customer && (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  color: '#fca5a5',
                  fontWeight: 900,
                  textAlign: 'center'
                }}
              >
                لازم تختار عميل لتسجيل المديونية.
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginTop: '6px'
              }}
            >
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                style={{
                  height: '46px',
                  borderRadius: '12px',
                  border: '1px solid rgba(124,58,237,0.70)',
                  background: 'rgba(255,255,255,0.04)',
                  color: '#c4b5fd',
                  fontWeight: 900,
                  cursor: 'pointer'
                }}
              >
                ESC / إلغاء
              </button>

              <button
                type="button"
                onClick={() => void saveSale()}
                disabled={saving || (remainingAmount > 0 && !activeInvoice.customer)}
                style={{
                  height: '46px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor:
                    saving || (remainingAmount > 0 && !activeInvoice.customer)
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    saving || (remainingAmount > 0 && !activeInvoice.customer)
                      ? 0.6
                      : 1
                }}
              >
                {saving ? 'جاري الدفع...' : 'F12 / دفع الفاتورة'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const tableInputStyle: CSSProperties = {
  width: '100%',
  height: '42px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: '#fff',
  padding: '0 10px',
  outline: 'none',
  boxSizing: 'border-box'
};

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  height: '52px',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #6d5dfc, #7c3aed)',
  color: '#fff',
  fontWeight: 800,
  padding: '0 20px',
  cursor: 'pointer'
};

const secondaryOutlineButtonStyle: CSSProperties = {
  border: '1px solid #7c3aed',
  height: '50px',
  borderRadius: '8px',
  background: 'transparent',
  color: '#a78bfa',
  fontWeight: 800,
  padding: '0 24px',
  cursor: 'pointer'
};

const miniCloseButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#cbd5e1',
  fontSize: '16px',
  cursor: 'pointer'
};

const removeButtonStyle: CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  border: '1px solid #f43f5e',
  background: 'transparent',
  color: '#f43f5e',
  fontSize: '20px',
  cursor: 'pointer'
};

const roundAddButtonStyle: CSSProperties = {
  width: '24px',
  height: '24px',
  minWidth: '24px',
  borderRadius: '999px',
  border: 'none',
  background: '#5b3df5',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  lineHeight: 1
};

const clearButtonStyle: CSSProperties = {
  width: '28px',
  height: '100%',
  border: 'none',
  background: 'transparent',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: '18px'
};

const emptyDropdownStyle: CSSProperties = {
  padding: '14px',
  textAlign: 'center',
  color: '#94a3b8',
  fontWeight: 700
};

const summaryStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '14px',
  padding: '18px',
  marginBottom: '16px',
  fontSize: '18px',
  fontWeight: 800,
  gap: '12px',
  direction: 'rtl'
};

const receiptInfoCardStyle: CSSProperties = {
  borderRadius: '12px',
  padding: '12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  display: 'grid',
  gap: '6px',
  color: '#cbd5e1'
};

const receiptTableHeaderStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 90px 110px 120px',
  gap: '10px',
  padding: '12px',
  background: 'rgba(255,255,255,0.05)',
  color: '#cbd5e1',
  fontWeight: 800
};

const receiptTableRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 90px 110px 120px',
  gap: '10px',
  padding: '12px',
  borderTop: '1px solid rgba(255,255,255,0.06)',
  alignItems: 'center',
  color: '#e5e7eb'
};

const loyaltyPanelStyle: CSSProperties = {
  borderRadius: '14px',
  padding: '14px',
  marginBottom: '22px',
  background: 'rgba(37,99,235,0.10)',
  border: '1px solid rgba(37,99,235,0.25)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '14px',
  flexWrap: 'wrap',
  direction: 'rtl'
};

const paymentInputStyle: React.CSSProperties = {
  height: '48px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#f8fafc',
  outline: 'none',
  padding: '0 12px',
  textAlign: 'right',
  fontSize: '18px',
  fontWeight: 900,
  boxSizing: 'border-box',
  colorScheme: 'dark'
};

const paymentLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '6px',
  color: '#cbd5e1',
  fontWeight: 900
};

const paymentToggleButtonStyle: React.CSSProperties = {
  height: '38px',
  borderRadius: '999px',
  border: '1px solid #e5e7eb',
  padding: '0 14px',
  color: '#111827',
  fontWeight: 900,
  cursor: 'pointer'
};