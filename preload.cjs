const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (data) => ipcRenderer.invoke('auth:login', data),
  register: (data) => ipcRenderer.invoke('auth:register', data),

  getUsers: (search) => ipcRenderer.invoke('users:list', search),
  createSystemUser: (input) => ipcRenderer.invoke('users:create', input),
  updateSystemUser: (input) => ipcRenderer.invoke('users:update', input),
  setUserActive: (userId, isActive) => ipcRenderer.invoke('users:set-active', userId, isActive),
  resetUserPassword: (userId, password, actorId) => ipcRenderer.invoke('users:reset-password', userId, password, actorId),
  

  getCategories: () => ipcRenderer.invoke('products:get-categories'),
  getProducts: (payload) => ipcRenderer.invoke('products:list', payload),
  getProductVariants: (payload) => ipcRenderer.invoke('products:get-variants', payload),
  toggleVariantActive: (variantId, isActive) => ipcRenderer.invoke('products:toggle-variant-active', variantId, isActive),
  createProduct: (input) => ipcRenderer.invoke('products:create', input),
  updateProduct: (input) => ipcRenderer.invoke('products:update', input),
  updateVariant: (input) => ipcRenderer.invoke('products:update-variant', input),
  toggleProductActive: (productId, isActive) => ipcRenderer.invoke('products:toggle-active', productId, isActive),
  addProductVariant: (input) => ipcRenderer.invoke('products:add-variant', input),

  getBarcodePrintSettings: () => ipcRenderer.invoke('settings:get-barcode-print'),
  saveBarcodePrintSettings: (input) => ipcRenderer.invoke('settings:save-barcode-print', input),

  searchSaleVariants: (query) => ipcRenderer.invoke('sales:search-variants', query),
  getVariantByBarcode: (barcode) => ipcRenderer.invoke('sales:get-variant-by-barcode', barcode),
  createSale: (input) => ipcRenderer.invoke('sales:create', input),
  getSaleReceipt: (saleId) => ipcRenderer.invoke('sales:get-receipt', saleId),
  listSales: (input) => ipcRenderer.invoke('sales:list', input),
  createSaleReturn: (input) => ipcRenderer.invoke('sales:return', input),
  listSaleReturns: (input) => ipcRenderer.invoke('sales:list-returns', input),
  getSaleReturnHistory: (saleId) => ipcRenderer.invoke('sales:return-history', saleId),

  getCustomers: () => ipcRenderer.invoke('customers:list'),
  searchCustomers: (query) => ipcRenderer.invoke('customers:search', query),
  getCustomerById: (id) => ipcRenderer.invoke('customers:get-by-id', id),
  createCustomer: (input) => ipcRenderer.invoke('customers:create', input),
  updateCustomer: (input) => ipcRenderer.invoke('customers:update', input),
  deleteCustomer: (id) => ipcRenderer.invoke('customers:delete', id),
  getCustomerHistory: (customerId) => ipcRenderer.invoke('customers:history', customerId),
  adjustCustomerPoints: (input) => ipcRenderer.invoke('customers:adjust-points', input),
  recordCustomerPayment: (input) => ipcRenderer.invoke('customers:record-payment', input),
  getCustomerStatement: (customerId) => ipcRenderer.invoke('customers:statement', customerId),

  getLoyaltySettings: () => ipcRenderer.invoke('settings:get-loyalty'),
  saveLoyaltySettings: (input) => ipcRenderer.invoke('settings:save-loyalty', input),

  backupDatabase: () => ipcRenderer.invoke('settings:backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('settings:restore-database'),
  resetDatabase: () => ipcRenderer.invoke('settings:reset-database'),

  getReportsSummary: (input) => ipcRenderer.invoke('reports:summary', input),

  getInventoryList: (input) => ipcRenderer.invoke('inventory:list', input),
  adjustVariantStock: (input) => ipcRenderer.invoke('inventory:adjust-stock', input),
  getStockMovements: (input) => ipcRenderer.invoke('inventory:movements', input),
  
  getSuppliers: (search) => ipcRenderer.invoke('suppliers:list', search),
  getSupplierById: (id) => ipcRenderer.invoke('suppliers:get-by-id', id),
  createSupplier: (input) => ipcRenderer.invoke('suppliers:create', input),
  updateSupplier: (input) => ipcRenderer.invoke('suppliers:update', input),
  deleteSupplier: (id) => ipcRenderer.invoke('suppliers:delete', id),

  createPurchaseInvoice: (input) => ipcRenderer.invoke('purchases:create', input),
  listPurchaseInvoices: (input) => ipcRenderer.invoke('purchases:list', input),
  getPurchaseInvoice: (purchaseId) => ipcRenderer.invoke('purchases:get-by-id', purchaseId),
  recordSupplierPayment: (input) => ipcRenderer.invoke('suppliers:record-payment', input),
  getSupplierStatement: (supplierId) => ipcRenderer.invoke('suppliers:statement', supplierId),

  getCashSummary: (input) => ipcRenderer.invoke('cash:summary', input),
  getCashMovements: (input) => ipcRenderer.invoke('cash:list', input),
  createCashMovement: (input) => ipcRenderer.invoke('cash:create-movement', input),

  createExpense: (input) => ipcRenderer.invoke('expenses:create', input),
  getExpenses: () => ipcRenderer.invoke('expenses:list'),

  getActivityLogs: (input) => ipcRenderer.invoke('activity:list', input),

  getLicenseStatus: () => ipcRenderer.invoke('settings:get-license-status'),
  activateApp: (code) => ipcRenderer.invoke('settings:activate-app', code),
  deactivateApp: () => ipcRenderer.invoke('settings:deactivate-app'),
  saveAppLogoUrl: (url) => ipcRenderer.invoke('settings:save-app-logo-url', url),
  chooseAppLogo: () => ipcRenderer.invoke('settings:choose-app-logo'),
  saveAppName: (name) => ipcRenderer.invoke('settings:save-app-name', name),

});