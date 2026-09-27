import { ipcMain } from 'electron'

import {
  createPromotion,
  getActivePromotion,
  getPromotion,
  listPromotions,
  togglePromotion,
  updatePromotion,
} from '../database/repositories/promotions.repo'

import { logAction } from './activity-helper'
import { requirePermission } from '../auth-session'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع'
}

export function registerPromotionsIpc(): void {
  ipcMain.handle('promotions:list', (event) => {
    requirePermission(event, 'promotions.manage')

    return listPromotions()
  })

  ipcMain.handle('promotions:get', (event, promotionId: number) => {
    requirePermission(event, 'promotions.manage')

    return getPromotion(promotionId)
  })

  ipcMain.handle('promotions:get-active', (event) => {
    /*
     * شاشة البيع تحتاج معرفة العرض النشط،
     * لذلك Admin + Cashier.
     */
    requirePermission(event, 'sales.use')

    return getActivePromotion()
  })

  ipcMain.handle('promotions:create', (event, input) => {
    try {
      const actorId = requirePermission(event, 'promotions.manage').id

      const result = createPromotion({
        ...input,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        action: 'promotion_created',
        entity: 'promotions',
        entity_id: result.promotionId,

        details: {
          name: input.name,
          type: input.type,
          value: input.value,

          buy_qty: input.buy_qty ?? null,

          free_qty: input.free_qty ?? null,

          scope_type: input.scope_type,
        },
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('promotions:update', (event, input) => {
    try {
      const actorId = requirePermission(event, 'promotions.manage').id

      const result = updatePromotion({
        ...input,
        actor_id: actorId,
      })

      logAction({
        actor_id: actorId,
        action: 'promotion_updated',
        entity: 'promotions',
        entity_id: Number(input.id),

        details: {
          name: input.name,
          type: input.type,
          value: input.value,

          buy_qty: input.buy_qty ?? null,

          free_qty: input.free_qty ?? null,

          scope_type: input.scope_type,
        },
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })

  ipcMain.handle('promotions:toggle', (event, input) => {
    try {
      const actorId = requirePermission(event, 'promotions.manage').id

      const result = togglePromotion(Number(input.id), Number(input.is_active))

      logAction({
        actor_id: actorId,

        action: Number(input.is_active)
          ? 'promotion_activated'
          : 'promotion_deactivated',

        entity: 'promotions',

        entity_id: Number(input.id),

        details: {
          is_active: Number(input.is_active) ? 1 : 0,
        },
      })

      return result
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      }
    }
  })
}
