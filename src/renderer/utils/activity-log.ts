import { getPaymentMethodLabel } from './payment-method'

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  auth_login_succeeded: 'تسجيل دخول',
  auth_login_failed: 'محاولة دخول فاشلة',
  auth_logout: 'تسجيل خروج',

  user_created: 'إضافة مستخدم',
  user_updated: 'تعديل مستخدم',
  user_activated: 'تفعيل مستخدم',
  user_deactivated: 'تعطيل مستخدم',
  user_password_reset: 'تغيير كلمة مرور',

  sale_created: 'إنشاء فاتورة بيع',
  sale_return_created: 'إنشاء مرتجع بيع',
  sale_cancelled: 'إلغاء فاتورة بيع',
  sale_return_cancelled: 'إلغاء مرتجع بيع',
  sale_exchange_created: 'إنشاء استبدال بيع',
  sale_exchange_cancelled: 'إلغاء استبدال بيع',

  purchase_created: 'إنشاء فاتورة شراء',
  purchase_cancelled: 'إلغاء فاتورة شراء',
  purchase_return_created: 'إنشاء مرتجع شراء',

  supplier_payment_recorded: 'تسجيل دفعة مورد',
  supplier_payment_created: 'تسجيل دفعة مورد',
  supplier_payment_updated: 'تعديل دفعة مورد',
  supplier_payment_cancelled: 'إلغاء دفعة مورد',

  customer_created: 'إضافة عميل',
  customer_updated: 'تعديل عميل',
  customer_deactivated: 'تعطيل عميل',
  customer_points_adjusted: 'تعديل نقاط عميل',
  customer_payment_created: 'تسجيل دفعة عميل',
  customer_payment_updated: 'تعديل دفعة عميل',
  customer_payment_cancelled: 'إلغاء دفعة عميل',

  supplier_created: 'إضافة مورد',
  supplier_updated: 'تعديل مورد',
  supplier_deactivated: 'تعطيل مورد',

  category_created: 'إضافة تصنيف',
  category_updated: 'تعديل تصنيف',
  category_activated: 'تفعيل تصنيف',
  category_deactivated: 'تعطيل تصنيف',

  product_created: 'إضافة منتج',
  product_updated: 'تعديل منتج',
  product_activated: 'تفعيل منتج',
  product_deactivated: 'تعطيل منتج',

  variant_created: 'إضافة صنف',
  variant_updated: 'تعديل صنف',
  variant_activated: 'تفعيل صنف',
  variant_deactivated: 'تعطيل صنف',

  promotion_created: 'إضافة عرض',
  promotion_updated: 'تعديل عرض',
  promotion_activated: 'تفعيل عرض',
  promotion_deactivated: 'تعطيل عرض',

  stock_count_created: 'إنشاء جلسة جرد',
  stock_count_item_updated: 'تعديل كمية في الجرد',
  stock_count_barcode_scanned: 'مسح باركود في الجرد',
  stock_count_approved: 'اعتماد الجرد',
  stock_count_canceled: 'إلغاء الجرد',

  cash_in: 'دخول مبلغ للخزنة',
  cash_out: 'خروج مبلغ من الخزنة',

  // دعم لأي Logs قديمة
  cash_deposit: 'إيداع خزنة',
  cash_withdraw: 'سحب خزنة',

  cash_day_closed: 'تقفيل يوم الخزنة',
  cash_day_close_updated: 'تعديل تقفيل يوم',
  cash_day_close_cancelled: 'إلغاء تقفيل يوم',
  cash_movement_updated: 'تعديل حركة خزنة',
  cash_movement_cancelled: 'إلغاء حركة خزنة',
  cash_transfer_updated: 'تعديل تحويل بين الحسابات',
  cash_transfer_cancelled: 'إلغاء تحويل بين الحسابات',

  expense_created: 'إضافة مصروف',
  expense_updated: 'تعديل مصروف',
  expense_cancelled: 'إلغاء مصروف',

  liability_created: 'إضافة التزام',
  liability_updated: 'تعديل التزام',
  liability_cancelled: 'إلغاء التزام',
  liability_payment_created: 'تسجيل دفعة التزام',
  liability_payment_updated: 'تعديل دفعة التزام',
  liability_payment_cancelled: 'إلغاء دفعة التزام',

  database_backup_created: 'إنشاء نسخة احتياطية',
  database_restored: 'استرجاع نسخة احتياطية',
  database_reset: 'تصفير البرنامج',

  auto_backup_dir_changed: 'تغيير مكان النسخ الاحتياطي التلقائي',

  auto_backup_run_now: 'تشغيل النسخ الاحتياطي يدويًا',

  auto_backup_created: 'إنشاء نسخة احتياطية تلقائية',

  auto_backup_failed: 'فشل النسخ الاحتياطي التلقائي',

  barcode_print_settings_saved: 'حفظ إعدادات طباعة الباركود',

  receipt_print_settings_saved: 'حفظ إعدادات طباعة الفاتورة',

  loyalty_settings_saved: 'حفظ إعدادات نقاط الولاء',

  app_activated: 'تفعيل البرنامج',
  app_deactivated: 'إلغاء تفعيل البرنامج',
  app_logo_saved: 'تغيير لوجو البرنامج',
  app_name_saved: 'تغيير اسم البرنامج',

  store_contact_info_saved: 'تعديل بيانات المتجر',

  store_qr_settings_saved: 'تعديل إعدادات QR المتجر',

  app_theme_saved: 'تغيير مظهر البرنامج',

  cash_drawer_settings_saved: 'حفظ إعدادات درج الكاشير',

  cash_drawer_opened: 'فتح درج الكاشير',

  cash_drawer_open_failed: 'فشل فتح درج الكاشير',
}

export const ACTIVITY_ACTION_OPTIONS = Object.entries(
  ACTIVITY_ACTION_LABELS,
).map(([value, label]) => ({
  value,
  label,
}))

export const ACTIVITY_ENTITY_LABELS: Record<string, string> = {
  auth: 'الدخول والأمان',

  users: 'المستخدمون',

  sales: 'المبيعات',

  // Logs قديمة
  sale: 'المبيعات',

  sale_returns: 'مرتجعات البيع',
  sale_exchanges: 'استبدالات البيع',

  purchase_invoices: 'المشتريات',
  purchase_returns: 'مرتجعات الشراء',

  supplier_payment_batches: 'دفعات الموردين',

  customer_payment_batches: 'دفعات العملاء',

  cash_movements: 'الخزنة',
  cash_day_closings: 'تقفيل الخزنة',
  cash_drawer: 'درج الكاشير',

  expenses: 'المصروفات',

  products: 'المنتجات',
  product_variants: 'أصناف المنتجات',
  categories: 'التصنيفات',

  promotions: 'العروض',

  stock_counts: 'الجرد',

  suppliers: 'الموردون',
  customers: 'العملاء',

  store_liabilities: 'الالتزامات',

  store_liability_payments: 'دفعات الالتزامات',

  settings: 'الإعدادات',
}

export const ACTIVITY_ENTITY_OPTIONS = Object.entries(ACTIVITY_ENTITY_LABELS)
  .filter(([value]) => value !== 'sale')
  .map(([value, label]) => ({
    value,
    label,
  }))

export function getActivityActionLabel(action?: string | null) {
  const key = String(action || '').trim()

  if (!key) {
    return '—'
  }

  return ACTIVITY_ACTION_LABELS[key] || 'عملية أخرى بالنظام'
}

export function getActivityEntityLabel(entity?: string | null) {
  const key = String(entity || '').trim()

  if (!key) {
    return '—'
  }

  return ACTIVITY_ENTITY_LABELS[key] || 'قسم آخر'
}

const DETAIL_LABELS: Record<string, string> = {
  id: 'الرقم',
  action: 'العملية',
  entity: 'القسم',
  entity_id: 'رقم المرجع',

  name: 'الاسم',
  username: 'اسم المستخدم',
  phone: 'الهاتف',
  email: 'البريد الإلكتروني',
  address: 'العنوان',
  role: 'الصلاحية',

  title: 'العنوان',
  description: 'الوصف',
  message: 'التفاصيل',
  notes: 'ملاحظات',
  reason: 'السبب',
  error: 'الخطأ',

  type: 'النوع',
  direction: 'الاتجاه',
  status: 'الحالة',
  payment_status: 'حالة الدفع',

  payment_method: 'طريقة الدفع',
  from_account: 'من حساب',
  to_account: 'إلى حساب',
  target_account: 'الحساب المستهدف',

  amount: 'المبلغ',
  old_amount: 'المبلغ القديم',
  new_amount: 'المبلغ الجديد',
  cancelled_amount: 'المبلغ الملغي',

  grand_total: 'الإجمالي',
  total_amount: 'الإجمالي',
  paid_amount: 'المدفوع',
  remaining_amount: 'المتبقي',
  remaining_after: 'المتبقي بعد العملية',

  refund_amount: 'المبلغ المردود',
  refunded_amount: 'المبلغ المردود',
  removed_debt: 'المديونية المحذوفة',

  reversed_total: 'الإجمالي المعكوس',
  reversed_paid: 'المدفوع المعكوس',
  reversed_remaining: 'المتبقي المعكوس',

  customer_id: 'رقم العميل',
  supplier_id: 'رقم المورد',
  purchase_id: 'رقم فاتورة الشراء',
  sale_id: 'رقم فاتورة البيع',
  original_sale_id: 'رقم الفاتورة الأصلية',

  return_id: 'رقم المرتجع',
  return_code: 'كود المرتجع',
  exchange_code: 'كود الاستبدال',

  product_id: 'رقم المنتج',
  variant_id: 'رقم الصنف',
  item_id: 'رقم البند',
  user_id: 'رقم المستخدم',

  product_name: 'المنتج',
  barcode: 'الباركود',
  size: 'المقاس',
  color: 'اللون',

  category: 'التصنيف',
  category_id: 'رقم التصنيف',
  categoryId: 'رقم التصنيف',

  quantity: 'الكمية',
  actual_stock: 'الكمية الفعلية',
  old_stock: 'المخزون القديم',
  new_stock: 'المخزون الجديد',
  diff: 'الفرق',

  items_count: 'عدد الأصناف',
  variants_count: 'عدد الأصناف',

  buy_price: 'سعر الشراء',
  sell_price: 'سعر البيع',
  discount_price: 'سعر الخصم',
  min_stock: 'الحد الأدنى للمخزون',
  opening_qty: 'الكمية الافتتاحية',

  session_id: 'رقم جلسة الجرد',

  changed_items: 'أصناف تم تعديلها',
  shortage_items: 'أصناف بها عجز',
  surplus_items: 'أصناف بها زيادة',

  total_shortage_qty: 'إجمالي العجز',
  total_surplus_qty: 'إجمالي الزيادة',

  buy_difference_value: 'قيمة فرق الشراء',

  sell_difference_value: 'قيمة فرق البيع',

  promotion_group_id: 'مجموعة العرض',

  old_group_total: 'قيمة المجموعة قبل الاستبدال',

  new_group_total: 'قيمة المجموعة بعد الاستبدال',

  difference_amount: 'فرق صافي الفاتورة',

  amount_to_collect: 'المبلغ المطلوب تحصيله',

  amount_to_refund: 'المبلغ المطلوب رده',

  debt_reduction_amount: 'تخفيض المديونية',

  cash_refunded: 'المبلغ المردود',

  cash_collected: 'المبلغ المحصل',

  debt_restored: 'المديونية المعادة',

  loyalty_balance_reversed: 'تغير رصيد النقاط',

  loyalty_points_reversed: 'النقاط الملغاة',

  points: 'النقاط',

  before: 'قبل التعديل',
  after: 'بعد التعديل',

  is_active: 'الحالة',
  enabled: 'مفعل',

  due_date: 'تاريخ الاستحقاق',
  party_name: 'الجهة أو الشخص',

  initial_paid: 'الدفعة المبدئية',

  business_date: 'تاريخ العملية',

  opening_drawer_balance: 'رصيد الدرج الافتتاحي',

  counted_amount: 'المبلغ الفعلي',

  carry_over_amount: 'المبلغ المرحل',

  printer_name: 'اسم الطابعة',

  auto_open_cash_sale: 'فتح الدرج تلقائيًا',

  path: 'المسار',

  restored_from: 'تم الاسترجاع من',

  safety_backup: 'نسخة الأمان',

  file_name: 'اسم الملف',
  has_logo: 'يوجد لوجو',

  theme: 'المظهر',

  store_qr_enabled: 'QR المتجر مفعل',

  store_qr_title: 'عنوان QR',

  store_qr_primary_url: 'رابط QR',

  scope_type: 'نطاق العرض',
  buy_qty: 'كمية الشراء',
  free_qty: 'الكمية المجانية',

  discount_type: 'نوع الخصم',
  value: 'القيمة',

  allocations: 'توزيعات الدفعة',

  replacement_batch_id: 'رقم الدفعة البديلة',

  source: 'المصدر',

  success: 'النتيجة',

  backup: 'بيانات النسخة الاحتياطية',
  info: 'معلومات إضافية',
}

const MONEY_KEYS = new Set([
  'amount',
  'old_amount',
  'new_amount',
  'cancelled_amount',
  'grand_total',
  'total_amount',
  'paid_amount',
  'remaining_amount',
  'remaining_after',
  'refund_amount',
  'refunded_amount',
  'removed_debt',
  'reversed_total',
  'reversed_paid',
  'reversed_remaining',
  'old_group_total',
  'new_group_total',
  'difference_amount',
  'amount_to_collect',
  'amount_to_refund',
  'debt_reduction_amount',
  'cash_refunded',
  'cash_collected',
  'debt_restored',
  'buy_difference_value',
  'sell_difference_value',
  'initial_paid',
  'opening_drawer_balance',
  'counted_amount',
  'carry_over_amount',
])

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح',
  paid: 'مسدد',
  partial: 'مدفوع جزئيًا',
  unpaid: 'غير مدفوع',
  cancelled: 'ملغي',
  canceled: 'ملغي',
  approved: 'معتمد',
  active: 'فعال',
  inactive: 'غير فعال',
}

const TYPE_LABELS: Record<string, string> = {
  sale: 'بيع',
  sale_return: 'مرتجع بيع',
  sale_exchange: 'استبدال بيع',

  purchase_return: 'مرتجع شراء',

  customer_payment: 'دفعة عميل',
  supplier_payment: 'دفعة مورد',
  liability_payment: 'دفعة التزام',

  expense: 'مصروف',
  withdraw: 'سحب',
  deposit: 'إيداع',
  transfer: 'تحويل',

  percentage: 'نسبة مئوية',
  percent: 'نسبة مئوية',
  fixed: 'مبلغ ثابت',
  amount: 'مبلغ ثابت',

  buy_x_get_y: 'اشتري وخد',
}

const SCOPE_LABELS: Record<string, string> = {
  all: 'الكل',
  category: 'تصنيف',
  products: 'منتجات محددة',
}

const REASON_LABELS: Record<string, string> = {
  manual: 'يدوي',
  sale: 'فاتورة بيع',
  test: 'اختبار',
  startup: 'عند تشغيل البرنامج',
  hourly: 'نسخ دوري',
  shutdown: 'عند إغلاق البرنامج',
}

const SOURCE_LABELS: Record<string, string> = {
  exact: 'محفوظ من وقت العملية',
  manual: 'يدوي',
  startup: 'تشغيل البرنامج',
  hourly: 'نسخ دوري',
  shutdown: 'إغلاق البرنامج',
}

export function formatActivityDetails(value?: string | null) {
  if (!value) {
    return '—'
  }

  try {
    const parsed = JSON.parse(value)

    if (Array.isArray(parsed)) {
      return `${parsed.length} عنصر`
    }

    if (!parsed || typeof parsed !== 'object') {
      return String(parsed ?? value)
    }

    return formatDetailObject(parsed as Record<string, unknown>)
  } catch {
    return String(value)
  }
}

function formatDetailObject(parsed: Record<string, unknown>) {
  const parts = Object.entries(parsed)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== '',
    )
    .map(([key, value]) => {
      const label = DETAIL_LABELS[key] || 'بيان إضافي'

      return `${label}: ${formatDetailValue(key, value)}`
    })

  return parts.join(' • ') || '—'
}

function formatDetailValue(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? `${value.length} عنصر` : 'لا يوجد'
  }

  if (value && typeof value === 'object') {
    return formatDetailObject(value as Record<string, unknown>)
  }

  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا'
  }

  if (MONEY_KEYS.has(key)) {
    return moneyValue(value)
  }

  const text = String(value ?? '')

  if (
    key === 'payment_method' ||
    key === 'from_account' ||
    key === 'to_account' ||
    key === 'target_account'
  ) {
    return getPaymentMethodLabel(text)
  }

  if (key === 'action') {
    return getActivityActionLabel(text)
  }

  if (key === 'entity') {
    return getActivityEntityLabel(text)
  }

  if (key === 'role') {
    if (text === 'admin') {
      return 'مدير'
    }

    if (text === 'cashier') {
      return 'كاشير'
    }
  }

  if (key === 'direction') {
    if (text === 'in') {
      return 'داخل'
    }

    if (text === 'out') {
      return 'خارج'
    }
  }

  if (key === 'status' || key === 'payment_status') {
    return STATUS_LABELS[text] || text
  }

  if (key === 'type') {
    return TYPE_LABELS[text] || 'نوع آخر'
  }

  if (key === 'scope_type') {
    return SCOPE_LABELS[text] || 'نطاق آخر'
  }

  if (key === 'reason') {
    return REASON_LABELS[text] || text
  }

  if (key === 'source') {
    return SOURCE_LABELS[text] || 'مصدر آخر'
  }

  if (key === 'discount_type') {
    if (text === 'percent') {
      return 'نسبة مئوية'
    }

    if (text === 'amount') {
      return 'مبلغ ثابت'
    }
  }

  if (key === 'theme') {
    if (text === 'dark') {
      return 'داكن'
    }

    if (text === 'light') {
      return 'فاتح'
    }
  }

  if (key === 'is_active' || key === 'enabled' || key.endsWith('_enabled')) {
    if (text === '1') {
      return 'نعم'
    }

    if (text === '0') {
      return 'لا'
    }
  }

  return text
}

function moneyValue(value: unknown) {
  return `${Number(value || 0).toFixed(2)} ج.م`
}
