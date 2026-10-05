import { ipcMain } from 'electron';

import {
  createPromotion,
  getActivePromotions,
  getPromotion,
  listPromotions,
  togglePromotion,
  updatePromotion,
} from '../database/repositories/promotions.repo';

import { runCriticalActionWithAudit } from './activity-helper';
import { requirePermission } from '../auth-session';

import {
  requireArrayInput,
  requireBinaryFlag,
  requireEnumValue,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveMoney,
  requirePositiveNumber,
  requireTrimmedString,
} from './input-validation';

const PROMOTION_TYPES = [
  'percent',
  'fixed_per_item',
  'fixed_invoice',
  'buy_x_get_y',
] as const;

const PROMOTION_SCOPES = ['all', 'category', 'products'] as const;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
}

function normalizePromotionWriteInput(input: unknown) {
  const payload = requireObjectInput(input, 'بيانات العرض');

  const type = requireEnumValue(payload.type, PROMOTION_TYPES, 'نوع العرض');

  const scopeType = requireEnumValue(
    payload.scope_type,
    PROMOTION_SCOPES,
    'نطاق العرض',
  );

  let value = 0;

  if (type === 'percent') {
    value = requirePositiveNumber(payload.value, 'نسبة العرض');

    if (value > 100) {
      throw new Error('نسبة الخصم لا يمكن أن تتجاوز 100%');
    }
  } else if (type !== 'buy_x_get_y') {
    value = requirePositiveMoney(payload.value, 'قيمة العرض');
  }

  let durationHours: number | null | undefined;

  if (payload.duration_hours === undefined) {
    durationHours = undefined;
  } else if (payload.duration_hours === null || payload.duration_hours === '') {
    durationHours = null;
  } else {
    durationHours = requirePositiveNumber(payload.duration_hours, 'مدة العرض');
  }

  let categoryId: number | null = null;

  if (scopeType === 'category') {
    categoryId = requirePositiveInteger(payload.category_id, 'رقم تصنيف العرض');
  }

  let productIds: number[] = [];

  if (scopeType === 'products') {
    const rawProductIds = requireArrayInput(
      payload.product_ids,
      'منتجات العرض',
      500,
    );

    if (rawProductIds.length === 0) {
      throw new Error('اختار منتج واحد على الأقل');
    }

    productIds = Array.from(
      new Set(
        rawProductIds.map((productId) =>
          requirePositiveInteger(productId, 'رقم منتج العرض'),
        ),
      ),
    );
  }

  const buyQty =
    type === 'buy_x_get_y'
      ? requirePositiveInteger(payload.buy_qty, 'كمية الشراء في العرض')
      : null;

  const freeQty =
    type === 'buy_x_get_y'
      ? requirePositiveInteger(payload.free_qty, 'كمية الهدية في العرض')
      : null;

  return {
    name: requireTrimmedString(payload.name, 'اسم العرض', 500),

    type,

    value,

    buy_qty: buyQty,

    free_qty: freeQty,

    scope_type: scopeType,

    duration_hours: durationHours,

    category_id: categoryId,

    product_ids: productIds,
  };
}

export function registerPromotionsIpc(): void {
  ipcMain.handle('promotions:list', (event) => {
    requirePermission(event, 'promotions.manage');

    return listPromotions();
  });

  ipcMain.handle('promotions:get', (event, promotionId: unknown) => {
    requirePermission(event, 'promotions.manage');

    return getPromotion(requirePositiveInteger(promotionId, 'رقم العرض'));
  });

  ipcMain.handle('promotions:get-active', (event) => {
    requirePermission(event, 'sales.use');

    return getActivePromotions();
  });

  ipcMain.handle('promotions:create', (event, input) => {
    try {
      const actorId = requirePermission(event, 'promotions.manage').id;

      const promotion = normalizePromotionWriteInput(input);

      const result = runCriticalActionWithAudit(
        () =>
          createPromotion({
            ...promotion,

            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          action: 'promotion_created',

          entity: 'promotions',

          entity_id: result.promotionId,

          details: {
            name: promotion.name,

            type: promotion.type,

            value: promotion.value,

            buy_qty: promotion.buy_qty,

            free_qty: promotion.free_qty,

            scope_type: promotion.scope_type,
          },
        }),
      );

      return result;
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('promotions:update', (event, input) => {
    try {
      const actorId = requirePermission(event, 'promotions.manage').id;

      const payload = requireObjectInput(input, 'بيانات تعديل العرض');

      const promotionId = requirePositiveInteger(payload.id, 'رقم العرض');

      const promotion = normalizePromotionWriteInput(payload);

      const result = runCriticalActionWithAudit(
        () =>
          updatePromotion({
            id: promotionId,

            ...promotion,

            actor_id: actorId,
          }),

        () => ({
          actor_id: actorId,

          action: 'promotion_updated',

          entity: 'promotions',

          entity_id: promotionId,

          details: {
            name: promotion.name,

            type: promotion.type,

            value: promotion.value,

            buy_qty: promotion.buy_qty,

            free_qty: promotion.free_qty,

            scope_type: promotion.scope_type,
          },
        }),
      );

      return result;
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('promotions:toggle', (event, input) => {
    try {
      const actorId = requirePermission(event, 'promotions.manage').id;

      const payload = requireObjectInput(input, 'بيانات تفعيل العرض');

      const promotionId = requirePositiveInteger(payload.id, 'رقم العرض');

      const isActive = requireBinaryFlag(payload.is_active, 'حالة العرض');

      const result = runCriticalActionWithAudit(
        () => togglePromotion(promotionId, isActive),

        () => ({
          actor_id: actorId,

          action: isActive ? 'promotion_activated' : 'promotion_deactivated',

          entity: 'promotions',

          entity_id: promotionId,

          details: {
            is_active: isActive,
          },
        }),
      );

      return result;
    } catch (error) {
      return {
        success: false,

        message: getErrorMessage(error),
      };
    }
  });
}
