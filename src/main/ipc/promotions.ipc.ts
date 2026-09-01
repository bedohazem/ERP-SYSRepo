import { ipcMain } from 'electron'

import {
  createPromotion,
  getActivePromotion,
  getPromotion,
  listPromotions,
  togglePromotion,
  updatePromotion,
} from '../database/repositories/promotions.repo'

import { getActorId, logAction } from './activity-helper'

import { requireAdmin } from './permission-helper'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع'
}

export function registerPromotionsIpc(): void {
  ipcMain.handle('promotions:list', () => {
    return listPromotions()
  })

  ipcMain.handle('promotions:get', (_, promotionId: number) => {
    return getPromotion(promotionId)
  })

  ipcMain.handle('promotions:get-active', () => {
    return getActivePromotion()
  })

  ipcMain.handle('promotions:create', (_, input) => {
    try {
      const actorId = getActorId(input)

      requireAdmin(actorId)

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

  ipcMain.handle('promotions:update', (_, input) => {
    try {
      const actorId = getActorId(input)

      requireAdmin(actorId)

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

  ipcMain.handle('promotions:toggle', (_, input) => {
    try {
      const actorId = getActorId(input)

      requireAdmin(actorId)

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
