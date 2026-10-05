import { ipcMain } from 'electron';
import { logAction, runCriticalActionWithAudit } from './activity-helper';
import { requireAuthenticatedAdmin, requirePermission } from '../auth-session';
import {
  approveStockCountSession,
  cancelStockCountSession,
  createStockCountSession,
  getStockCountSession,
  listStockCountSessions,
  scanStockCountBarcode,
  updateStockCountItem,
} from '../database/repositories/stock-count.repo';
import {
  optionalTrimmedString,
  requireNonNegativeNumber,
  requireObjectInput,
  requirePositiveInteger,
  requirePositiveNumber,
  requireTrimmedString,
} from './input-validation';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'حدث خطأ غير متوقع';
}

function getCashierSessionView(session: any) {
  if (!session) {
    return session;
  }

  const {
    matched_count: _matchedCount,
    shortage_count: _shortageCount,
    surplus_count: _surplusCount,
    buy_difference_value: _buyDifferenceValue,
    sell_difference_value: _sellDifferenceValue,
    ...safeSession
  } = session;

  return safeSession;
}

function getCashierSessionDetailsView(details: any) {
  if (!details) {
    return details;
  }

  return {
    session: getCashierSessionView(details.session),

    items: Array.isArray(details.items)
      ? details.items.map((item: any) => {
          const {
            system_stock: _systemStock,

            difference: _difference,

            buy_difference_value: _buyDifferenceValue,

            sell_difference_value: _sellDifferenceValue,

            ...safeItem
          } = item;

          return safeItem;
        })
      : [],
  };
}

export function registerStockCountIpc(): void {
  ipcMain.handle('stock-count:list', (event) => {
    const actor = requirePermission(event, 'stock_count.view');

    const sessions = listStockCountSessions();

    if (actor.role === 'admin') {
      return sessions;
    }

    return sessions.map(getCashierSessionView);
  });

  ipcMain.handle('stock-count:get', (event, sessionId: unknown) => {
    const actor = requirePermission(event, 'stock_count.view');

    const safeSessionId = requirePositiveInteger(sessionId, 'رقم جلسة الجرد');

    const details = getStockCountSession(safeSessionId);

    if (actor.role === 'admin') {
      return details;
    }

    return getCashierSessionDetailsView(details);
  });

  ipcMain.handle('stock-count:create', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);

      const payload = requireObjectInput(input, 'بيانات جلسة الجرد');

      const rawCategoryId = payload.categoryId;

      const categoryId =
        rawCategoryId === undefined ||
        rawCategoryId === null ||
        rawCategoryId === '' ||
        rawCategoryId === 'all'
          ? null
          : requirePositiveInteger(rawCategoryId, 'رقم التصنيف');

      const title = requireTrimmedString(payload.title, 'اسم جلسة الجرد', 300);

      const notes = optionalTrimmedString(
        payload.notes,
        'ملاحظات جلسة الجرد',
        2000,
      );

      const result = createStockCountSession({
        title,
        notes,
        actor_id: actorId,
        categoryId,
      });

      logAction({
        actor_id: actorId,
        action: 'stock_count_created',
        entity: 'stock_counts',
        entity_id: result.id,
        details: {
          title,
          items_count: result.items_count,
          categoryId,
        },
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('stock-count:update-item', (event, input) => {
    try {
      const actorId = requirePermission(event, 'stock_count.count').id;

      const payload = requireObjectInput(input, 'بيانات بند الجرد');

      const sessionId = requirePositiveInteger(
        payload.session_id,
        'رقم جلسة الجرد',
      );

      const itemId = requirePositiveInteger(payload.item_id, 'رقم بند الجرد');

      const actualStock = requireNonNegativeNumber(
        payload.actual_stock,
        'الكمية الفعلية',
      );

      const notes = optionalTrimmedString(
        payload.notes,
        'ملاحظات بند الجرد',
        1000,
      );

      const result = updateStockCountItem({
        session_id: sessionId,
        item_id: itemId,
        actual_stock: actualStock,
        notes,
      });

      logAction({
        actor_id: actorId,
        action: 'stock_count_item_updated',
        entity: 'stock_counts',
        entity_id: sessionId,
        details: {
          item_id: itemId,
          actual_stock: actualStock,
          notes: notes ?? '',
        },
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('stock-count:scan', (event, input) => {
    try {
      const actorId = requirePermission(event, 'stock_count.count').id;

      const payload = requireObjectInput(input, 'بيانات مسح الباركود');

      const sessionId = requirePositiveInteger(
        payload.session_id,
        'رقم جلسة الجرد',
      );

      const barcode = requireTrimmedString(payload.barcode, 'الباركود', 200);

      const quantity =
        payload.quantity === undefined ||
        payload.quantity === null ||
        payload.quantity === ''
          ? 1
          : requirePositiveNumber(payload.quantity, 'كمية المسح');

      const result = scanStockCountBarcode({
        session_id: sessionId,
        barcode,
        quantity,
      });

      logAction({
        actor_id: actorId,
        action: 'stock_count_barcode_scanned',
        entity: 'stock_counts',
        entity_id: sessionId,
        details: {
          item_id: result.item_id,
          barcode: result.barcode,
          product_name: result.product_name,
          actual_stock: result.actual_stock,
          quantity,
        },
      });

      return result;
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error),
      };
    }
  });

  ipcMain.handle('stock-count:approve', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);

      const payload = requireObjectInput(input, 'بيانات اعتماد جلسة الجرد');

      const sessionId = requirePositiveInteger(
        payload.session_id,
        'رقم جلسة الجرد',
      );

      const result = runCriticalActionWithAudit(
        () =>
          approveStockCountSession({
            session_id: sessionId,
            actor_id: actorId,
          }),

        (result) => ({
          actor_id: actorId,

          action: 'stock_count_approved',

          entity: 'stock_counts',

          entity_id: sessionId,

          details: result,
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

  ipcMain.handle('stock-count:cancel', (event, input) => {
    try {
      const actorId = requireAuthenticatedAdmin(event);
      const payload = requireObjectInput(input, 'بيانات إلغاء جلسة الجرد');

      const sessionId = requirePositiveInteger(
        payload.session_id,
        'رقم جلسة الجرد',
      );
      const result = runCriticalActionWithAudit(
        () =>
          cancelStockCountSession({
            session_id: sessionId,

            actor_id: actorId,
          }),

        () => ({
          actor_id: actorId,

          action: 'stock_count_canceled',

          entity: 'stock_counts',

          entity_id: sessionId,

          details: {
            session_id: sessionId,
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
