import { ipcMain } from 'electron';
import {
  runCriticalActionWithAudit,
  type ActionLogInput,
} from './activity-helper';
import {
  requireAuthenticatedUser,
  requireAnyPermission,
  requirePermission,
} from '../auth-session';
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
  listProductsPage,
  toggleCategoryActive,
} from '../database/repositories/product.repo';
import { userHasPermission } from '../database/repositories/user.repo';
import {
  optionalBooleanValue,
  optionalNonNegativeNumber,
  optionalPositiveInteger,
  optionalPositiveMoney,
  optionalStringValue,
  optionalTrimmedString,
  requireArrayInput,
  requireBinaryFlag,
  requireNonNegativeMoney,
  requireNonNegativeNumber,
  requireObjectInput,
  requirePositiveInteger,
  requireTrimmedString,
} from './input-validation';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
}

function normalizeVariantInput(
  input: unknown,
  options?: {
    withId?: boolean;
    withProductId?: boolean;
    withOpeningQty?: boolean;
  },
) {
  const payload = requireObjectInput(input, 'بيانات الصنف');

  return {
    ...(options?.withId
      ? {
          id: requirePositiveInteger(payload.id, 'رقم الصنف'),
        }
      : {}),

    ...(options?.withProductId
      ? {
          product_id: requirePositiveInteger(payload.product_id, 'رقم المنتج'),
        }
      : {}),

    barcode: requireTrimmedString(payload.barcode, 'الباركود', 200),

    size: optionalTrimmedString(payload.size, 'المقاس', 100) ?? '',

    color: optionalTrimmedString(payload.color, 'اللون', 100) ?? '',

    buy_price: requireNonNegativeMoney(payload.buy_price, 'سعر الشراء'),

    sell_price: requireNonNegativeMoney(payload.sell_price, 'سعر البيع'),

    discount_price: optionalPositiveMoney(
      payload.discount_price,
      'السعر بعد الخصم',
    ),

    min_stock: requireNonNegativeNumber(payload.min_stock, 'حد المخزون الأدنى'),

    ...(options?.withOpeningQty
      ? {
          opening_qty:
            optionalNonNegativeNumber(
              payload.opening_qty,
              'المخزون الافتتاحي',
            ) ?? 0,
        }
      : {}),

    ...(payload.is_active === undefined
      ? {}
      : {
          is_active: requireBinaryFlag(payload.is_active, 'حالة الصنف'),
        }),
  };
}

function normalizeCategoryFilter(value: unknown) {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    value === 'all'
  ) {
    return 'all';
  }

  if (value === 'uncategorized') {
    return 'uncategorized';
  }

  return requirePositiveInteger(value, 'رقم التصنيف');
}

export function registerProductsIpc(): void {
  ipcMain.handle(
    'products:get-categories',
    (event, input?: { includeInactive?: boolean }) => {
      const actor = requireAuthenticatedUser(event);

      /*
       * الكاشير يحتاج التصنيفات في شاشة البيع والجرد،
       * لكن لا يحتاج رؤية التصنيفات المعطلة.
       */
      const includeInactive =
        actor.role === 'admin' || userHasPermission(actor.id, 'products.manage')
          ? Boolean(input?.includeInactive)
          : false;

      return getCategories(includeInactive);
    },
  );

  ipcMain.handle('products:create-category', (event, input) => {
    try {
      const actorId = requirePermission(event, 'products.manage').id;

      const payload = requireObjectInput(input, 'بيانات التصنيف');

      input = {
        name: requireTrimmedString(payload.name, 'اسم التصنيف', 200),

        description: optionalTrimmedString(
          payload.description,
          'وصف التصنيف',
          2000,
        ),
      };

      return runCriticalActionWithAudit(
        () => createCategory(input),

        (result) => ({
          actor_id: actorId,

          action: 'category_created',

          entity: 'categories',

          entity_id: result.id,

          details: {
            name: input.name,
          },
        }),
      );
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('products:update-category', (event, input) => {
    try {
      const actorId = requirePermission(event, 'products.manage').id;

      const payload = requireObjectInput(input, 'بيانات تعديل التصنيف');

      input = {
        id: requirePositiveInteger(payload.id, 'رقم التصنيف'),

        name: requireTrimmedString(payload.name, 'اسم التصنيف', 200),

        description: optionalTrimmedString(
          payload.description,
          'وصف التصنيف',
          2000,
        ),
      };

      return runCriticalActionWithAudit(
        () => updateCategory(input),

        () => ({
          actor_id: actorId,

          action: 'category_updated',

          entity: 'categories',

          entity_id: input.id,

          details: {
            name: input.name,
          },
        }),
      );
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle(
    'products:toggle-category',
    (event, categoryId: number, isActive: number) => {
      try {
        const actorId = requirePermission(event, 'products.manage').id;

        categoryId = requirePositiveInteger(categoryId, 'رقم التصنيف');

        isActive = requireBinaryFlag(isActive, 'حالة التصنيف');

        return runCriticalActionWithAudit(
          () => toggleCategoryActive(categoryId, isActive),

          () => ({
            actor_id: actorId,

            action: isActive ? 'category_activated' : 'category_deactivated',

            entity: 'categories',

            entity_id: categoryId,

            details: {
              is_active: isActive,
            },
          }),
        );
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle(
    'products:list',
    (
      event,
      payload?: {
        search?: string;
        includeInactive?: boolean;
        categoryId?: number | string | null;
      },
    ) => {
      const actor = requireAnyPermission(event, [
        'products.manage',
        'promotions.manage',
      ]);

      const canManageProducts =
        actor.role === 'admin' ||
        userHasPermission(actor.id, 'products.manage');

      return getProducts(
        payload?.search ?? '',

        canManageProducts ? (payload?.includeInactive ?? false) : false,

        payload?.categoryId ?? null,
      );
    },
  );

  ipcMain.handle('products:list-page', (event, input) => {
    requirePermission(event, 'products.manage');

    return listProductsPage(input);
  });

  ipcMain.handle(
    'products:get-variants',
    (
      event,
      payload: {
        productId: number;
        includeInactive?: boolean;
      },
    ) => {
      requirePermission(event, 'products.manage');

      const safePayload = requireObjectInput(payload, 'بيانات المنتج');

      return getProductVariants(
        requirePositiveInteger(safePayload.productId, 'رقم المنتج'),

        optionalBooleanValue(
          safePayload.includeInactive,
          'إظهار الأصناف المعطلة',
        ) ?? true,
      );
    },
  );

  ipcMain.handle('products:create', (event, input) => {
    try {
      const actorId = requirePermission(event, 'products.manage').id;

      const payload = requireObjectInput(input, 'بيانات المنتج');

      const variants = requireArrayInput(payload.variants, 'أصناف المنتج', 500);

      if (variants.length === 0) {
        throw new Error('لازم تضيف صنف واحد على الأقل');
      }

      input = {
        name: requireTrimmedString(payload.name, 'اسم المنتج', 300),

        category_id:
          optionalPositiveInteger(payload.category_id, 'رقم التصنيف') ?? null,

        image_path: optionalStringValue(
          payload.image_path,
          'صورة المنتج',
          5000,
        ),

        description: optionalTrimmedString(
          payload.description,
          'وصف المنتج',
          5000,
        ),

        variants: variants.map((variant) =>
          normalizeVariantInput(variant, {
            withOpeningQty: true,
          }),
        ),
      };

      return runCriticalActionWithAudit(
        () =>
          createProduct({
            ...input,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          action: 'product_created',

          entity: 'products',

          entity_id: result.productId,

          details: {
            name: input.name,

            variants_count: input.variants?.length || 0,
          },
        }),
      );
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('products:add-variant', (event, input) => {
    try {
      const actorId = requirePermission(event, 'products.manage').id;

      input = normalizeVariantInput(input, {
        withProductId: true,
        withOpeningQty: true,
      });

      return runCriticalActionWithAudit(
        () =>
          addProductVariant({
            ...input,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

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

            discount_price: input.discount_price ?? null,

            min_stock: input.min_stock,

            opening_qty: input.opening_qty ?? 0,
          },
        }),
      );
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('products:update', (event, input) => {
    try {
      const actorId = requirePermission(event, 'products.manage').id;

      const payload = requireObjectInput(input, 'بيانات تعديل المنتج');

      const variants =
        payload.variants === undefined || payload.variants === null
          ? undefined
          : requireArrayInput(payload.variants, 'أصناف المنتج', 500).map(
              (variant) =>
                normalizeVariantInput(variant, {
                  withId: true,
                }),
            );

      input = {
        id: requirePositiveInteger(payload.id, 'رقم المنتج'),

        name: requireTrimmedString(payload.name, 'اسم المنتج', 300),

        category_id:
          optionalPositiveInteger(payload.category_id, 'رقم التصنيف') ?? null,

        image_path: optionalStringValue(
          payload.image_path,
          'صورة المنتج',
          5000,
        ),

        description: optionalTrimmedString(
          payload.description,
          'وصف المنتج',
          5000,
        ),

        variants,
      };

      return runCriticalActionWithAudit(
        () => updateProduct(input),

        () => {
          const logs: ActionLogInput[] = [
            {
              actor_id: actorId,

              action: 'product_updated',

              entity: 'products',

              entity_id: input.id,

              details: {
                name: input.name,

                category_id: input.category_id,

                variants_count: Array.isArray(input.variants)
                  ? input.variants.length
                  : 0,
              },
            },
          ];

          for (const variant of Array.isArray(input.variants)
            ? input.variants
            : []) {
            logs.push({
              actor_id: actorId,

              action: 'variant_updated',

              entity: 'product_variants',

              entity_id: variant.id,

              details: {
                product_id: input.id,

                barcode: variant.barcode,
                size: variant.size,
                color: variant.color,

                buy_price: variant.buy_price,

                sell_price: variant.sell_price,

                discount_price: variant.discount_price ?? null,

                min_stock: variant.min_stock,
              },
            });
          }

          return logs;
        },
      );
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('products:update-variant', (event, input) => {
    try {
      const actorId = requirePermission(event, 'products.manage').id;

      input = normalizeVariantInput(input, {
        withId: true,
      });

      return runCriticalActionWithAudit(
        () => updateVariant(input),

        () => ({
          actor_id: actorId,

          action: 'variant_updated',

          entity: 'product_variants',

          entity_id: input.id,

          details: {
            barcode: input.barcode,
            size: input.size,
            color: input.color,

            buy_price: input.buy_price,

            sell_price: input.sell_price,

            discount_price: input.discount_price ?? null,

            min_stock: input.min_stock,
          },
        }),
      );
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle(
    'products:toggle-active',
    (event, productId: number, isActive: number) => {
      try {
        const actorId = requirePermission(event, 'products.manage').id;

        productId = requirePositiveInteger(productId, 'رقم المنتج');

        isActive = requireBinaryFlag(isActive, 'حالة المنتج');

        return runCriticalActionWithAudit(
          () => toggleProductActive(productId, isActive),

          () => ({
            actor_id: actorId,

            action: isActive ? 'product_activated' : 'product_deactivated',

            entity: 'products',

            entity_id: productId,

            details: {
              is_active: isActive,
            },
          }),
        );
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle(
    'products:toggle-variant-active',
    (event, variantId: number, isActive: number) => {
      try {
        const actorId = requirePermission(event, 'products.manage').id;

        variantId = requirePositiveInteger(variantId, 'رقم الصنف');

        isActive = requireBinaryFlag(isActive, 'حالة الصنف');

        return runCriticalActionWithAudit(
          () => toggleVariantActive(variantId, isActive),

          () => ({
            actor_id: actorId,

            action: isActive ? 'variant_activated' : 'variant_deactivated',

            entity: 'product_variants',

            entity_id: variantId,

            details: {
              is_active: isActive,
            },
          }),
        );
      } catch (error) {
        return {
          success: false,

          message: getErrorMessage(error),
        };
      }
    },
  );
}
