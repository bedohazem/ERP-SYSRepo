const { contextBridge, ipcRenderer } = require('electron');

function cleanUserErrorMessage(value) {
  const raw =
    value instanceof Error
      ? value.message
      : value && typeof value === 'object' && typeof value.message === 'string'
        ? value.message
        : String(value ?? '');

  let message = raw.trim();

  /*
   * Electron بيضيف Prefix تقني
   * للـIPC errors. ممنوع يظهر
   * للمستخدم في الواجهة.
   */
  message = message.replace(/^Error invoking remote method '[^']+':\s*/i, '');

  message = message.replace(/^Unhandled error in IPC handler:\s*/i, '');

  /*
   * ممكن Electron / Node يكرر
   * Error: أكثر من مرة.
   */
  while (/^(?:Error|TypeError|RangeError|ReferenceError):\s*/i.test(message)) {
    message = message.replace(
      /^(?:Error|TypeError|RangeError|ReferenceError):\s*/i,
      '',
    );
  }

  message = message.trim();

  if (!message) {
    return 'حدث خطأ غير متوقع أثناء تنفيذ العملية. حاول مرة أخرى.';
  }

  /*
   * لو الخطأ تقني إنجليزي بالكامل
   * مثل SQLite / Node / Electron،
   * ما نعرضوش للمستخدم.
   *
   * التفاصيل الأصلية تظل موجودة
   * في console للمراجعة.
   */
  if (!/[\u0600-\u06ff]/.test(message)) {
    return 'حدث خطأ غير متوقع أثناء تنفيذ العملية. حاول مرة أخرى.';
  }

  return message;
}

function sanitizeFailedResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }

  const failed = result.success === false || result.ok === false;

  if (failed && typeof result.message === 'string') {
    return {
      ...result,
      message: cleanUserErrorMessage(result.message),
    };
  }

  return result;
}

async function invokeMain(channel, ...args) {
  try {
    const result = await ipcRenderer.invoke(channel, ...args);

    return sanitizeFailedResult(result);
  } catch (error) {
    /*
     * نحتفظ بالخطأ الأصلي كاملًا
     * للمطور فقط.
     */
    console.error(`IPC failed: ${channel}`, error);

    /*
     * الـRenderer يستلم رسالة
     * نظيفة للمستخدم فقط.
     */
    throw new Error(cleanUserErrorMessage(error), { cause: error });
  }
}

contextBridge.exposeInMainWorld('api', {
  getAppVersion: () => invokeMain('app:get-version'),
  login: (data) => invokeMain('auth:login', data),
  getAuthBootstrapStatus: () => invokeMain('auth:bootstrap-status'),

  bootstrapInitialAdmin: (data) => invokeMain('auth:bootstrap-admin', data),

  requestAdminPasswordRecovery: () => invokeMain('auth:recovery-request'),

  recoverAdminPassword: (input) => invokeMain('auth:recover-admin', input),

  changeOwnPassword: (input) => invokeMain('auth:change-password', input),

  touchAuthSession: () => invokeMain('auth:touch'),

  lockAuthSession: () => invokeMain('auth:lock'),
  logout: () => invokeMain('auth:logout'),

  getUsers: (input) => invokeMain('users:list', input),
  getUsersPage: (input) => invokeMain('users:list-page', input),
  getUserPermissions: (userId) => invokeMain('users:get-permissions', userId),

  setUserPermissions: (input) => invokeMain('users:set-permissions', input),
  createSystemUser: (input) => invokeMain('users:create', input),
  updateSystemUser: (input) => invokeMain('users:update', input),
  setUserActive: (userId, isActive) =>
    invokeMain('users:set-active', userId, isActive),
  resetUserPassword: (userId, password) =>
    invokeMain('users:reset-password', userId, password),

  getCategories: (input) => invokeMain('products:get-categories', input),
  createCategory: (input) => invokeMain('products:create-category', input),
  updateCategory: (input) => invokeMain('products:update-category', input),
  toggleCategoryActive: (categoryId, isActive) =>
    invokeMain('products:toggle-category', categoryId, isActive),
  getProducts: (payload) => invokeMain('products:list', payload),
  getProductsPage: (input) => invokeMain('products:list-page', input),
  getProductVariants: (payload) => invokeMain('products:get-variants', payload),
  toggleVariantActive: (variantId, isActive) =>
    invokeMain('products:toggle-variant-active', variantId, isActive),
  createProduct: (input) => invokeMain('products:create', input),
  updateProduct: (input) => invokeMain('products:update', input),
  updateVariant: (input) => invokeMain('products:update-variant', input),
  toggleProductActive: (productId, isActive) =>
    invokeMain('products:toggle-active', productId, isActive),
  addProductVariant: (input) => invokeMain('products:add-variant', input),

  getBarcodePrintSettings: () => invokeMain('settings:get-barcode-print'),
  saveBarcodePrintSettings: (input) =>
    invokeMain('settings:save-barcode-print', input),
  getReceiptPrintSettings: () => invokeMain('settings:get-receipt-print'),
  saveReceiptPrintSettings: (input) =>
    invokeMain('settings:save-receipt-print', input),

  searchSaleVariants: (query) => invokeMain('sales:search-variants', query),
  getVariantByBarcode: (barcode) =>
    invokeMain('sales:get-variant-by-barcode', barcode),
  getPromotions: () => invokeMain('promotions:list'),

  getPromotion: (promotionId) => invokeMain('promotions:get', promotionId),

  getActivePromotions: () => invokeMain('promotions:get-active'),

  createPromotion: (input) => invokeMain('promotions:create', input),

  updatePromotion: (input) => invokeMain('promotions:update', input),

  togglePromotion: (input) => invokeMain('promotions:toggle', input),
  createSale: (input) => invokeMain('sales:create', input),
  holdSale: (input) => invokeMain('sales:hold', input),

  listHeldSales: () => invokeMain('sales:list-held'),

  getHeldSale: (heldSaleId) => invokeMain('sales:get-held', heldSaleId),

  deleteHeldSale: (input) => invokeMain('sales:delete-held', input),
  updateSaleInvoice: (input) => invokeMain('sales:update', input),
  cancelSaleInvoice: (input) => invokeMain('sales:cancel', input),
  getSaleReceipt: (saleId) => invokeMain('sales:get-receipt', saleId),

  getSaleCurrentState: (saleId) => invokeMain('sales:current-state', saleId),
  listSales: (input) => invokeMain('sales:list', input),
  createSaleReturn: (input) => invokeMain('sales:return', input),
  cancelSaleReturn: (input) => invokeMain('sales:cancel-return', input),
  listSaleReturns: (input) => invokeMain('sales:list-returns', input),
  getSaleReturnHistory: (saleId) => invokeMain('sales:return-history', saleId),

  getSaleExchangeState: (saleId) => invokeMain('sales:exchange-state', saleId),

  createSaleExchange: (input) => invokeMain('sales:exchange', input),

  listSaleExchanges: (input) => invokeMain('sales:list-exchanges', input),

  cancelSaleExchange: (input) => invokeMain('sales:cancel-exchange', input),
  getCustomers: () => invokeMain('customers:list'),
  listCustomers: (input) => invokeMain('customers:list-page', input),
  searchCustomers: (query) => invokeMain('customers:search', query),
  getCustomerById: (id) => invokeMain('customers:get-by-id', id),
  createCustomer: (input) => invokeMain('customers:create', input),
  updateCustomer: (input) => invokeMain('customers:update', input),
  deleteCustomer: (id) => invokeMain('customers:delete', id),
  getCustomerHistory: (customerId) =>
    invokeMain('customers:history', customerId),
  adjustCustomerPoints: (input) => invokeMain('customers:adjust-points', input),
  recordCustomerPayment: (input) =>
    invokeMain('customers:record-payment', input),
  cancelCustomerPayment: (input) =>
    invokeMain('customers:cancel-payment', input),
  updateCustomerPayment: (input) =>
    invokeMain('customers:update-payment', input),
  getCustomerStatement: (customerId) =>
    invokeMain('customers:statement', customerId),

  getLoyaltySettings: () => invokeMain('settings:get-loyalty'),
  saveLoyaltySettings: (input) => invokeMain('settings:save-loyalty', input),

  backupDatabase: () => invokeMain('settings:backup-database'),

  backupSelectiveData: (sections) =>
    invokeMain('settings:backup-selective', {
      sections,
    }),

  chooseSelectiveRestoreFile: () =>
    invokeMain('settings:choose-selective-restore'),

  restoreSelectiveData: (sections) =>
    invokeMain('settings:restore-selective', {
      sections,
    }),

  resetKeepingSelectiveData: (sections) =>
    invokeMain('settings:reset-keeping-selective', {
      sections,
    }),

  restoreDatabase: () => invokeMain('settings:restore-database'),

  resetDatabase: () => invokeMain('settings:reset-database'),

  getAutoBackupInfo: () => invokeMain('settings:get-auto-backup-info'),

  chooseAutoBackupDir: () => invokeMain('settings:choose-auto-backup-dir'),

  runAutoBackupNow: () => invokeMain('settings:run-auto-backup-now'),

  getReportsSummary: (input) => invokeMain('reports:summary', input),

  getAdminCashFlowAlerts: () => invokeMain('reports:admin-cash-flow-alerts'),

  getCashierDashboardSummary: () => invokeMain('reports:cashier-dashboard'),
  getInventoryList: (input) => invokeMain('inventory:list', input),
  getInventoryPage: (input) => invokeMain('inventory:list-page', input),
  getInventoryAnalytics: (input) => invokeMain('inventory:analytics', input),
  adjustVariantStock: (input) => invokeMain('inventory:adjust-stock', input),
  getStockMovements: (input) => invokeMain('inventory:movements', input),

  getStockCountSessions: () => invokeMain('stock-count:list'),
  getStockCountSession: (sessionId) => invokeMain('stock-count:get', sessionId),
  createStockCountSession: (input) => invokeMain('stock-count:create', input),
  updateStockCountItem: (input) => invokeMain('stock-count:update-item', input),
  scanStockCountBarcode: (input) => invokeMain('stock-count:scan', input),
  approveStockCountSession: (input) => invokeMain('stock-count:approve', input),
  cancelStockCountSession: (input) => invokeMain('stock-count:cancel', input),

  getSuppliers: (search) => invokeMain('suppliers:list', search),
  listSuppliers: (input) => invokeMain('suppliers:list-page', input),
  getSupplierById: (id) => invokeMain('suppliers:get-by-id', id),
  createSupplier: (input) => invokeMain('suppliers:create', input),
  updateSupplier: (input) => invokeMain('suppliers:update', input),
  deleteSupplier: (id) => invokeMain('suppliers:delete', id),

  createPurchaseInvoice: (input) => invokeMain('purchases:create', input),
  getPurchaseReorderSuggestions: (input) =>
    invokeMain('purchases:reorder-suggestions', input),

  listPurchaseOrders: (input) => invokeMain('purchases:orders:list', input),

  getPurchaseOrder: (purchaseOrderId) =>
    invokeMain('purchases:orders:get', purchaseOrderId),

  createPurchaseOrder: (input) => invokeMain('purchases:orders:create', input),

  updatePurchaseOrder: (input) => invokeMain('purchases:orders:update', input),

  markPurchaseOrderOrdered: (input) =>
    invokeMain('purchases:orders:mark-ordered', input),

  cancelPurchaseOrder: (input) => invokeMain('purchases:orders:cancel', input),

  receivePurchaseOrder: (input) =>
    invokeMain('purchases:orders:receive', input),

  updatePurchaseInvoice: (input) => invokeMain('purchases:update', input),

  listPurchaseInvoices: (input) => invokeMain('purchases:list', input),

  getPurchaseInvoice: (purchaseId) =>
    invokeMain('purchases:get-by-id', purchaseId),

  cancelPurchaseInvoice: (input) => invokeMain('purchases:cancel', input),

  createPurchaseReturn: (input) =>
    invokeMain('purchases:returns:create', input),

  updatePurchaseReturn: (input) =>
    invokeMain('purchases:returns:update', input),

  cancelPurchaseReturn: (input) =>
    invokeMain('purchases:returns:cancel', input),

  listPurchaseReturns: (input) => invokeMain('purchases:returns:list', input),

  getPurchaseReturn: (returnId) =>
    invokeMain('purchases:returns:get-by-id', returnId),

  recordSupplierPayment: (input) =>
    invokeMain('suppliers:record-payment', input),
  cancelSupplierPayment: (input) =>
    invokeMain('suppliers:cancel-payment', input),
  updateSupplierPayment: (input) =>
    invokeMain('suppliers:update-payment', input),
  getSupplierStatement: (supplierId) =>
    invokeMain('suppliers:statement', supplierId),

  getCashSummary: (input) => invokeMain('cash:summary', input),
  getCashShiftDaySummary: (input) =>
    invokeMain('cash-shifts:day-summary', input),
  getCashShifts: (input) => invokeMain('cash-shifts:list', input),
  getCashShiftUsers: () => invokeMain('cash-shifts:users'),
  getCashShiftDetails: (shiftId) => invokeMain('cash-shifts:details', shiftId),
  listCashShiftVariances: (input) =>
    invokeMain('cash-shifts:list-variances', input),
  checkCashShiftClock: () => invokeMain('cash-shifts:clock-check'),
  resolveCashShiftVariance: (input) =>
    invokeMain('cash-shifts:resolve-variance', input),
  getCashMovements: (input) => invokeMain('cash:list', input),
  createCashMovement: (input) => invokeMain('cash:create-movement', input),
  updateCashMovement: (input) => invokeMain('cash:update-movement', input),
  cancelCashMovement: (input) => invokeMain('cash:cancel-movement', input),
  createCashTransfer: (input) => invokeMain('cash:transfer', input),
  getCashShiftOpeningPreview: () => invokeMain('cash-shifts:opening-preview'),
  getOpenCashShift: () => invokeMain('cash-shifts:get-open'),

  openCashShift: (input) => invokeMain('cash-shifts:open', input),

  getCashShiftExpectedBalance: (shiftId) =>
    invokeMain('cash-shifts:preview', shiftId),

  closeCashShift: (input) => invokeMain('cash-shifts:close', input),
  forceCloseCashShift: (input) => invokeMain('cash-shifts:force-close', input),
  createExpense: (input) => invokeMain('expenses:create', input),
  updateExpense: (input) => invokeMain('expenses:update', input),
  cancelExpense: (input) => invokeMain('expenses:cancel', input),
  getExpenses: (input) => invokeMain('expenses:list', input),
  getExpensesPage: (input) => invokeMain('expenses:list-page', input),

  getActivityLogs: (input) => invokeMain('activity:list', input),

  getLicenseStatus: () => invokeMain('settings:get-license-status'),
  activateApp: (code) => invokeMain('settings:activate-app', code),
  deactivateApp: () => invokeMain('settings:deactivate-app'),

  saveAppLogoUrl: (url) => invokeMain('settings:save-app-logo-url', url),

  chooseAppLogo: () => invokeMain('settings:choose-app-logo'),

  saveAppName: (name) => invokeMain('settings:save-app-name', name),

  saveStoreContactInfo: (phone, address) =>
    invokeMain('settings:save-store-contact-info', phone, address),

  saveStoreQrSettings: (input) =>
    invokeMain('settings:save-store-qr-settings', input),

  saveAppTheme: (theme) => invokeMain('settings:save-app-theme', theme),

  getLiabilities: (input) => invokeMain('liabilities:list', input),

  getLiabilitiesPage: (input) => invokeMain('liabilities:list-page', input),
  createLiability: (input) => invokeMain('liabilities:create', input),
  updateLiability: (input) => invokeMain('liabilities:update', input),
  recordLiabilityPayment: (input) =>
    invokeMain('liabilities:record-payment', input),
  updateLiabilityPayment: (input) =>
    invokeMain('liabilities:update-payment', input),
  getLiabilityStatement: (liabilityId) =>
    invokeMain('liabilities:statement', liabilityId),
  cancelLiability: (input) => invokeMain('liabilities:cancel', input),
  cancelLiabilityPayment: (input) =>
    invokeMain('liabilities:cancel-payment', input),
  getLiabilitiesSummary: (input) => invokeMain('liabilities:summary', input),

  savePdfFromHtml: (input) => invokeMain('print:save-pdf', input),
  saveReportPdfFromHtml: (input) => invokeMain('print:save-report-pdf', input),

  saveReportCsvText: (input) => invokeMain('print:save-report-csv', input),
  printHtmlSilent: (input) => invokeMain('print:silent-html', input),

  printHtmlWithDialog: (input) => invokeMain('print:dialog-html', input),

  getCashDrawerSettings: () => invokeMain('cash-drawer:get-settings'),
  saveCashDrawerSettings: (input) =>
    invokeMain('cash-drawer:save-settings', input),
  getCashDrawerPrinters: () => invokeMain('cash-drawer:list-printers'),

  getCashDrawerNoSaleEvents: (input) =>
    invokeMain('cash-drawer:list-no-sale-events', input),

  openCashDrawer: (input) => invokeMain('cash-drawer:open', input),
});
