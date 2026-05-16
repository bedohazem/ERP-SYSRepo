import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
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

  ipcMain.handle('products:create', (_, input) => {
    const result = createProduct(input);

    logAction({
      actor_id: getActorId(input),
      action: 'product_created',
      entity: 'products',
      entity_id: result.productId,
      details: {
        name: input.name,
        variants_count: input.variants?.length || 0
      }
  });

    return result;
  });

  ipcMain.handle('products:update', (_, input) => {
    const result = updateProduct(input);

    logAction({
      actor_id: getActorId(input),
      action: 'product_updated',
      entity: 'products',
      entity_id: input.id,
      details: {
        name: input.name,
        category_id: input.category_id
      }
    });

    return result;
  });

  ipcMain.handle('products:update-variant', (_, input) => {
    const result = updateVariant(input);

    logAction({
      actor_id: getActorId(input),
      action: 'variant_updated',
      entity: 'product_variants',
      entity_id: input.id,
      details: {
        barcode: input.barcode,
        size: input.size,
        color: input.color,
        buy_price: input.buy_price,
        sell_price: input.sell_price,
        min_stock: input.min_stock
      }
    });

    return result;
  });

  ipcMain.handle('products:toggle-active', (_, productId: number, isActive: number, actorId?: number) => {
    const result = toggleProductActive(productId, isActive);

    logAction({
      actor_id: actorId ?? null,
      action: isActive ? 'product_activated' : 'product_deactivated',
      entity: 'products',
      entity_id: productId,
      details: { is_active: isActive }
    });

    return result;
  });

  ipcMain.handle('products:toggle-variant-active', (_, variantId: number, isActive: number, actorId?: number) => {
    const result = toggleVariantActive(variantId, isActive);

    logAction({
      actor_id: actorId ?? null,
      action: isActive ? 'variant_activated' : 'variant_deactivated',
      entity: 'product_variants',
      entity_id: variantId,
      details: { is_active: isActive }
    });

    return result;
  });

  
}