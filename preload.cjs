const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (data) => ipcRenderer.invoke('auth:login', data),
  register: (data) => ipcRenderer.invoke('auth:register', data),

  getCategories: () => ipcRenderer.invoke('products:get-categories'),
  getProducts: (payload) => ipcRenderer.invoke('products:list', payload),
  getProductVariants: (payload) => ipcRenderer.invoke('products:get-variants', payload),
  toggleVariantActive: (variantId, isActive) => ipcRenderer.invoke('products:toggle-variant-active', variantId, isActive),
  createProduct: (input) => ipcRenderer.invoke('products:create', input),
  updateProduct: (input) => ipcRenderer.invoke('products:update', input),
  updateVariant: (input) => ipcRenderer.invoke('products:update-variant', input),
  toggleProductActive: (productId, isActive) => ipcRenderer.invoke('products:toggle-active', productId, isActive),

  getBarcodePrintSettings: () => ipcRenderer.invoke('settings:get-barcode-print'),
  saveBarcodePrintSettings: (input) => ipcRenderer.invoke('settings:save-barcode-print', input),

  searchSaleVariants: (query) => ipcRenderer.invoke('sales:search-variants', query),
  getVariantByBarcode: (barcode) => ipcRenderer.invoke('sales:get-variant-by-barcode', barcode),
  createSale: (input) => ipcRenderer.invoke('sales:create', input),

  getCustomers: () => ipcRenderer.invoke('customers:list'),
  searchCustomers: (query) => ipcRenderer.invoke('customers:search', query),
  getCustomerById: (id) => ipcRenderer.invoke('customers:get-by-id', id),
  createCustomer: (input) => ipcRenderer.invoke('customers:create', input),
  updateCustomer: (input) => ipcRenderer.invoke('customers:update', input),
  deleteCustomer: (id) => ipcRenderer.invoke('customers:delete', id),
  getCustomerHistory: (customerId) => ipcRenderer.invoke('customers:history', customerId),
  adjustCustomerPoints: (input) => ipcRenderer.invoke('customers:adjust-points', input),

  getLoyaltySettings: () => ipcRenderer.invoke('settings:get-loyalty'),
  saveLoyaltySettings: (input) => ipcRenderer.invoke('settings:save-loyalty', input),
  
});