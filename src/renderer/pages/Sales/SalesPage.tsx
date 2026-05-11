import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAuthStore } from '../../store/auth.store';

type SaleVariant = {
  variant_id: number;
  product_id: number;
  product_name: string;
  barcode: string;
  size: string;
  color: string;
  sell_price: number;
  buy_price: number;
  stock: number;
  min_stock: number;
  is_active: number;
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

const createInvoice = (id: number): InvoiceTab => ({
  id,
  title: `فاتورة ${id}`,
  cart: [],
  barcodeDraft: '',
  productDraft: '',
  customer: null,
  loyaltyPointsDraft: '',
  paidDraft: '',
  paymentMethod: 'cash'
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

  const [invoices, setInvoices] = useState<InvoiceTab[]>([createInvoice(1)]);
  const [activeInvoiceId, setActiveInvoiceId] = useState(1);
  const [nextInvoiceId, setNextInvoiceId] = useState(2);

  const [productResults, setProductResults] = useState<SaleVariant[]>([]);
  const [saving, setSaving] = useState(false);
  const [barcodeMode, setBarcodeMode] = useState(true);

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

  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>(
    defaultLoyaltySettings
  );

  const [pageMessage, setPageMessage] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  const [receiptData, setReceiptData] = useState<SaleReceipt | null>(null);

  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const productInputRef = useRef<HTMLInputElement | null>(null);
  const firstQtyInputRef = useRef<HTMLInputElement | null>(null);
  const customerWrapperRef = useRef<HTMLDivElement | null>(null);

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
    pointValue > 0 ? Math.floor(subTotal / pointValue) : 0;

  const maxRedeemPoints = loyaltyEnabled
    ? Math.max(0, Math.min(selectedCustomerPoints, maxRedeemByTotal))
    : 0;

  const redeemPoints = Math.min(requestedRedeemPoints, maxRedeemPoints);
  const loyaltyDiscountValue = redeemPoints * pointValue;
  const grandTotal = Math.max(0, subTotal - loyaltyDiscountValue);

  const paidAmount =
    activeInvoice.paidDraft.trim() === ''
      ? grandTotal
      : Math.min(
          Math.max(Number(activeInvoice.paidDraft || 0), 0),
          grandTotal
        );

  const remainingAmount = Math.max(0, grandTotal - paidAmount);

  const paymentStatus =
    remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

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

  const salesGridColumns = barcodeMode
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
      if (showAddCustomerModal || receiptData) return;

      if (barcodeMode) {
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
      } else {
        productInputRef.current?.focus();
        productInputRef.current?.select();
      }
    });
  }

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
    setTimeout(focusMainInput, 0);
  }

  function clearCustomer() {
    updateActiveInvoice({ customer: null, loyaltyPointsDraft: '' });
    setCustomerSearch('');
    setCustomerDropdownOpen(false);
    setTimeout(focusMainInput, 0);
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
      showMessage('success', 'تم إضافة العميل');
    } catch (error) {
      console.error('Failed to create customer:', error);
      showMessage('error', 'حدث خطأ أثناء إضافة العميل، تأكد أن رقم الهاتف غير مكرر', false);
    } finally {
      setSavingNewCustomer(false);
    }
  }

  function buildReceiptPrintHtml(receipt: SaleReceipt) {
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
            .muted { color: #555; font-size: 11px; }
            .line { border-top: 1px dashed #777; margin: 10px 0; }
            .row { display: flex; justify-content: space-between; gap: 8px; margin: 5px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { padding: 5px 0; border-bottom: 1px dashed #ddd; text-align: right; vertical-align: top; }
            th { font-size: 11px; color: #333; }
            .total { font-weight: 800; font-size: 14px; }
            @media print { body { padding: 0; } .receipt { width: 100%; } }
          </style>
        </head>
        <body>
          <div class="receipt">
            <div class="center">
              <h2>فاتورة بيع</h2>
              <p class="muted">رقم الفاتورة: #${escapeHtml(receipt.sale.id)}</p>
              <p class="muted">${escapeHtml(formatReceiptDate(receipt.sale.created_at))}</p>
            </div>

            <div class="line"></div>

            <div class="row"><span>العميل</span><strong>${escapeHtml(receipt.sale.customer_name || 'عميل نقدي')}</strong></div>
            <div class="row"><span>الكاشير</span><strong>${escapeHtml(receipt.sale.cashier_name || '-')}</strong></div>

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
            <div class="row"><span>خصم النقاط</span><strong>${money(receipt.sale.loyalty_discount_value)} ج.م</strong></div>
            <div class="row total"><span>الإجمالي النهائي</span><strong>${money(receipt.sale.grand_total)} ج.م</strong></div>

            <div class="line"></div>

            <div class="row"><span>نقاط مستخدمة</span><strong>${escapeHtml(receipt.sale.loyalty_points_redeemed || 0)}</strong></div>
            <div class="row"><span>نقاط مكتسبة</span><strong>${escapeHtml(receipt.sale.loyalty_points_earned || 0)}</strong></div>

            <div class="line"></div>
            <p class="center muted">شكرًا لتعاملكم معنا</p>
          </div>
        </body>
      </html>
    `;
  }

  function printReceipt() {
    if (!receiptData) return;

    const popup = window.open('', '_blank', 'width=420,height=700');

    if (!popup) {
      showMessage('error', 'المتصفح منع فتح نافذة الطباعة', false);
      return;
    }

    popup.document.open();
    popup.document.write(buildReceiptPrintHtml(receiptData));
    popup.document.close();
    popup.focus();

    setTimeout(() => {
      popup.print();
      popup.close();
    }, 350);
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
      showMessage('error', 'لا يمكن البيع آجل بدون اختيار عميل');
      return;
    }

    setSaving(true);

    try {
      const result = await window.api.createSale({
        user_id: user.id,
        customer_id: activeInvoice.customer?.id ?? null,
        sub_total: subTotal,
        discount_value: 0,
        grand_total: grandTotal,
        paid: paidAmount,
        remaining_amount: remainingAmount,
        payment_status: paymentStatus,
        change_amount: 0,
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

      try {
        const receipt = await window.api.getSaleReceipt(Number(result.saleId));
        setReceiptData(receipt);
      } catch (receiptError) {
        console.error('Failed to load receipt:', receiptError);

        const earned = Number(result?.loyalty_points_earned || 0);
        const successText = earned > 0
          ? `تم حفظ الفاتورة رقم ${result.saleId} وكسب العميل ${earned} نقطة`
          : `تم حفظ الفاتورة رقم ${result.saleId}`;

        showMessage('success', successText);
      }

      updateActiveInvoice({
        cart: [],
        barcodeDraft: '',
        productDraft: '',
        customer: null,
        loyaltyPointsDraft: '',
        paidDraft: '',
        paymentMethod: 'cash'
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
        .searchSaleVariants(q)
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
  }, [activeInvoice.productDraft, activeInvoiceId]);

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
        if (!saving) void saveSale();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [
    activeInvoiceId,
    activeInvoice.cart,
    subTotal,
    saving,
    barcodeMode,
    showAddCustomerModal,
    receiptData,
    grandTotal,
    redeemPoints,
    loyaltyDiscountValue
  ]);

  useEffect(() => {
    window.focus();
    void loadCustomers('');
    void loadLoyaltySettings();
    setTimeout(focusMainInput, 100);
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
    <div style={{ display: 'grid', gap: '18px', minHeight: 0, overflow: 'visible' }}>
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
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          direction: 'ltr',
          overflow: 'visible'
        }}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addInvoice}
          style={primaryButtonStyle}
        >
          + فاتورة جديدة F9
        </button>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            direction: 'rtl'
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
          padding: '28px',
          minHeight: 0,
          overflow: 'visible'
        }}
      >
        <h2 style={{ margin: '0 0 24px', textAlign: 'right' }}>فاتورة بيع</h2>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
            marginBottom: '20px'
          }}
        >
          <div
            ref={customerWrapperRef}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginLeft: 'auto'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                direction: 'ltr',
                width: '360px',
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
                style={{
                  position: 'absolute',
                  top: '54px',
                  left: 0,
                  width: '360px',
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

        <div style={summaryStyle}>
          <div>
            عدد الأصناف | <span>{activeInvoice.cart.length}</span>
          </div>
          <div>
            الإجمالي قبل الخصم | <span>{subTotal.toFixed(2)} ج.م</span>
          </div>
          <div>
            خصم النقاط | <span>{loyaltyDiscountValue.toFixed(2)} ج.م</span>
          </div>
          <div>
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

        <div style={{ overflowX: 'auto', overflowY: 'visible', width: '100%' }}>
          <div style={{ minWidth: barcodeMode ? '920px' : '760px' }}>
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
                  value={`${item.product_name} ${item.size || ''} ${item.color || ''}`}
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
            direction: 'ltr'
          }}
        >

          <div
            className="glass-card"
            style={{
              marginTop: '22px',
              padding: '18px',
              borderRadius: '16px',
              display: 'grid',
              gap: '14px',
              direction: 'rtl',
              background: 'rgba(255,255,255,0.03)'
            }}
          >
            <h3 style={{ margin: 0 }}>الدفع</h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px'
              }}
            >
              <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                  الإجمالي المطلوب
                </label>
                <input
                  value={`${grandTotal.toFixed(2)} ج.م`}
                  readOnly
                  style={{ ...tableInputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                  المدفوع الآن
                </label>
                <input
                  type="number"
                  min={0}
                  max={grandTotal}
                  value={activeInvoice.paidDraft}
                  onChange={(e) =>
                    updateActiveInvoice({
                      paidDraft: e.target.value
                    })
                  }
                  placeholder={grandTotal.toFixed(2)}
                  style={tableInputStyle}
                />
              </div>

              <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                  المتبقي على العميل
                </label>
                <input
                  value={`${remainingAmount.toFixed(2)} ج.م`}
                  readOnly
                  style={{
                    ...tableInputStyle,
                    opacity: 0.7,
                    color: remainingAmount > 0 ? '#fca5a5' : '#6ee7b7',
                    fontWeight: 900
                  }}
                />
              </div>

              <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ color: '#cbd5e1', fontWeight: 800 }}>
                  طريقة الدفع
                </label>
                <select
                  value={activeInvoice.paymentMethod}
                  onChange={(e) =>
                    updateActiveInvoice({
                      paymentMethod: e.target.value
                    })
                  }
                  style={tableInputStyle}
                >
                  <option value="cash">كاش</option>
                  <option value="card">كارت</option>
                  <option value="wallet">محفظة</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                </select>
              </div>
            </div>

            {remainingAmount > 0 && !activeInvoice.customer && (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(239,68,68,0.10)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  color: '#fca5a5',
                  fontWeight: 800
                }}
              >
                لا يمكن حفظ فاتورة آجل بدون اختيار عميل.
              </div>
            )}

            {remainingAmount > 0 && activeInvoice.customer && (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(249,115,22,0.10)',
                  border: '1px solid rgba(249,115,22,0.25)',
                  color: '#fdba74',
                  fontWeight: 800
                }}
              >
                سيتم تسجيل {remainingAmount.toFixed(2)} ج.م على حساب العميل.
              </div>
            )}
          </div>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void saveSale()}
            disabled={saving || activeInvoice.cart.length === 0}
            style={{
              ...secondaryOutlineButtonStyle,
              minWidth: '150px',
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
              {item.product_name} | {item.size || '—'} | {item.color || '—'} |{' '}
              {item.sell_price} ج
            </button>
          ))}
        </div>
      )}

      {receiptData && (
        <div
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
                <strong>{receiptData.sale.payment_method || 'cash'}</strong>
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
                onClick={printReceipt}
                style={primaryButtonStyle}
              >
                طباعة الفاتورة
              </button>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setReceiptData(null);
                  setTimeout(focusMainInput, 0);
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
                  setTimeout(focusMainInput, 0);
                }}
                style={secondaryOutlineButtonStyle}
              >
                إلغاء
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
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '18px',
  fontWeight: 800,
  gap: '16px',
  flexWrap: 'wrap',
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
