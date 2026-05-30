import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
import { requireAdmin } from './permission-helper';
import {
  approveStockCountSession,
  cancelStockCountSession,
  createStockCountSession,
  getStockCountSession,
  listStockCountSessions,
  scanStockCountBarcode,
  updateStockCountItem
} from '../database/repositories/stock-count.repo';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'حدث خطأ غير متوقع';
}

export function registerStockCountIpc(): void {
  ipcMain.handle('stock-count:list', () => {
    return listStockCountSessions();
  });

  ipcMain.handle('stock-count:get', (_, sessionId: number) => {
    return getStockCountSession(Number(sessionId));
  });

  ipcMain.handle('stock-count:create', (_, input) => {
    try {
      const actorId = getActorId(input);
      requireAdmin(actorId);

      const result = createStockCountSession({
        title: input.title,
        notes: input.notes,
        actor_id: actorId
      });

      logAction({
        actor_id: actorId,
        action: 'stock_count_created',
        entity: 'stock_counts',
        entity_id: result.id,
        details: {
          title: input.title,
          items_count: result.items_count
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

  ipcMain.handle('stock-count:update-item', (_, input) => {
    try {
      return updateStockCountItem(input);
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('stock-count:scan', (_, input) => {
    try {
      return scanStockCountBarcode(input);
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('stock-count:approve', (_, input) => {
    try {
      const actorId = getActorId(input);
      requireAdmin(actorId);

      const result = approveStockCountSession({
        session_id: input.session_id,
        actor_id: actorId
      });

      logAction({
        actor_id: actorId,
        action: 'stock_count_approved',
        entity: 'stock_counts',
        entity_id: input.session_id,
        details: result
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('stock-count:cancel', (_, input) => {
    try {
      const actorId = getActorId(input);
      requireAdmin(actorId);

      const result = cancelStockCountSession({
        session_id: input.session_id,
        actor_id: actorId
      });

      logAction({
        actor_id: actorId,
        action: 'stock_count_canceled',
        entity: 'stock_counts',
        entity_id: input.session_id,
        details: {
          session_id: input.session_id
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
}