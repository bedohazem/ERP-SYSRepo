import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
import { requireAdmin } from './permission-helper';
import {
  createProduct,
  getCategories,
  getProducts,
  getProductVariants,
  toggleVariantActive,
  updateProduct,
  updateVariant,
  toggleProductActive,
  addProductVariant,
  createCategory,
  updateCategory,
  toggleCategoryActive
} from '../database/repositories/product.repo';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
}

export function registerProductsIpc(): void {

  ipcMain.handle('products:get-categories', (_, input?: { includeInactive?: boolean }) => {
    return getCategories(Boolean(input?.includeInactive));
  });

  ipcMain.handle('products:create-category', (_, input) => {
    try {
      requireAdmin(getActorId(input));
      const result = createCategory(input);

      logAction({
        actor_id: getActorId(input),
        action: 'category_created',
        entity: 'categories',
        entity_id: result.id,
        details: { name: input.name }
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('products:update-category', (_, input) => {
    try {
      requireAdmin(getActorId(input));
      const result = updateCategory(input);

      logAction({
        actor_id: getActorId(input),
        action: 'category_updated',
        entity: 'categories',
        entity_id: input.id,
        details: { name: input.name }
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('products:toggle-category', (_, categoryId: number, isActive: number, actorId?: number) => {
    try {
      requireAdmin(actorId);
      const result = toggleCategoryActive(categoryId, isActive);

      logAction({
        actor_id: actorId ?? null,
        action: isActive ? 'category_activated' : 'category_deactivated',
        entity: 'categories',
        entity_id: categoryId,
        details: { is_active: isActive }
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle(
    'products:list',
    (
      _,
      payload?: {
        search?: string;
        includeInactive?: boolean;
        categoryId?: number | string | null;
      }
    ) => {
      return getProducts(
        payload?.search ?? '',
        payload?.includeInactive ?? false,
        payload?.categoryId ?? null
      );
    }
  );

  ipcMain.handle('products:get-variants', (_, payload: { productId: number; includeInactive?: boolean }) => {
    return getProductVariants(payload.productId, payload.includeInactive ?? true);
  });

  ipcMain.handle('products:create', (_, input) => {
    try {
      requireAdmin(getActorId(input));

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
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('products:add-variant', (_, input) => {
    try {
      requireAdmin(getActorId(input));

      const result = addProductVariant(input);

      logAction({
        actor_id: getActorId(input),
        action: 'variant_created',
        entity: 'product_variants',
        entity_id: result.variantId,
        details: {
          product_id: input.product_id,
          barcode: input.barcode,
          size: input.size,
          color: input.color,
          buy_price: input.buy_price,
          sell_price: input.sell_price,
          min_stock: input.min_stock,
          opening_qty: input.opening_qty ?? 0
        }
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('products:update', (_, input) => {
    try {
      requireAdmin(getActorId(input));

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
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('products:update-variant', (_, input) => {
    try {
      requireAdmin(getActorId(input));

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
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('products:toggle-active', (_, productId: number, isActive: number, actorId?: number) => {
    try {
      requireAdmin(actorId);

      const result = toggleProductActive(productId, isActive);

      logAction({
        actor_id: actorId ?? null,
        action: isActive ? 'product_activated' : 'product_deactivated',
        entity: 'products',
        entity_id: productId,
        details: { is_active: isActive }
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('products:toggle-variant-active', (_, variantId: number, isActive: number, actorId?: number) => {
    try {
      requireAdmin(actorId);

      const result = toggleVariantActive(variantId, isActive);

      logAction({
        actor_id: actorId ?? null,
        action: isActive ? 'variant_activated' : 'variant_deactivated',
        entity: 'product_variants',
        entity_id: variantId,
        details: { is_active: isActive }
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });
}