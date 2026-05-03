import { ipcMain } from 'electron';
import {
  createProduct,
  getCategories,
  getProducts,
  getProductVariants,
  toggleVariantActive,
  updateProduct,
  updateVariant,
  toggleProductActive
} from '../database/repositories/product.repo';

export function registerProductsIpc(): void {
  ipcMain.handle('products:get-categories', () => {
    return getCategories();
  });

  ipcMain.handle('products:list',(_, payload?: { search?: string; includeInactive?: boolean }) => {
      return getProducts(payload?.search ?? '', payload?.includeInactive ?? false);
  });

  ipcMain.handle('products:get-variants',(_, payload: { productId: number; includeInactive?: boolean }) => {
        return getProductVariants(
        payload.productId,
        payload.includeInactive ?? true
      );
  });

  ipcMain.handle('products:toggle-variant-active',(_, variantId: number, isActive: number) => {
    return toggleVariantActive(variantId, isActive);
  });

  ipcMain.handle('products:create', (_, input) => {
    return createProduct(input);
  });
  
  ipcMain.handle('products:update', (_, input) => {
  return updateProduct(input);
  });

  ipcMain.handle('products:update-variant', (_, input) => {
    return updateVariant(input);
  });

  ipcMain.handle('products:toggle-active', (_, productId: number, isActive: number) => {
    return toggleProductActive(productId, isActive);
  });

  
}