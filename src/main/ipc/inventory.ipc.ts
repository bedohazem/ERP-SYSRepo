import { ipcMain } from 'electron';
import { runCriticalActionWithAudit } from './activity-helper';
import { requireAnyPermission, requirePermission } from '../auth-session';
import {
  optionalEnumValue,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalTrimmedString,
  requireArrayInput,
  requireEnumValue,
  requireNonNegativeNumber,
  requireObjectInput,
  requirePositiveInteger,
} from './input-validation';
import { userHasPermission } from '../database/repositories/user.repo';

import {
  adjustVariantStock,
  getInventoryAnalytics,
  getInventoryList,
  getStockMovements,
  listInventoryPage,
} from '../database/repositories/inventory.repo';

const INVENTORY_COST_FIELDS = new Set([
  'buy_price',
  'average_cost',
  'inventory_value',
  'unit_cost',
  'cost_value',

  'total_buy_value',
  'totalBuyValue',

  'dead_stock_value_90d',
  'potential_gross_profit',
]);

function redactInventoryCosts<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(redactInventoryCosts) as T;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (INVENTORY_COST_FIELDS.has(key)) {
      result[key] = 0;

      continue;
    }

    result[key] = redactInventoryCosts(child);
  }

  return result as T;
}

function protectInventoryCosts<T>(
  actor: {
    id: number;
    role: string;
  },

  value: T,
): T {
  if (actor.role === 'admin' || userHasPermission(actor.id, 'costs.view')) {
    return value;
  }

  return redactInventoryCosts(value);
}

const INVENTORY_STATUSES = [
  'all',
  'available',
  'low',
  'out',
  'inactive',
] as const;

const INVENTORY_PAGE_STATUSES = [
  'available',
  'low',
  'out',
  'inactive',
] as const;

function normalizeInventoryCategoryId(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '' || value === 'all') {
    return null;
  }

  return requirePositiveInteger(value, 'رقم التصنيف');
}

function normalizeInventoryListInput(input: unknown) {
  const payload = requireObjectInput(input ?? {}, 'فلتر المخزون');

  return {
    search:
      optionalTrimmedString(payload.search, 'بحث المخزون', 500) ?? undefined,

    status:
      optionalEnumValue(payload.status, INVENTORY_STATUSES, 'حالة المخزون') ??
      'all',

    categoryId: normalizeInventoryCategoryId(payload.categoryId),
  };
}

function normalizeInventoryPageInput(input: unknown) {
  const payload = requireObjectInput(input ?? {}, 'فلتر صفحة المخزون');

  const statuses =
    payload.statuses === undefined || payload.statuses === null
      ? undefined
      : requireArrayInput(
          payload.statuses,
          'حالات المخزون',
          INVENTORY_PAGE_STATUSES.length,
        ).map((status) =>
          requireEnumValue(status, INVENTORY_PAGE_STATUSES, 'حالة المخزون'),
        );

  return {
    search:
      optionalTrimmedString(payload.search, 'بحث المخزون', 500) ?? undefined,

    status:
      optionalEnumValue(payload.status, INVENTORY_STATUSES, 'حالة المخزون') ??
      'all',

    statuses,

    categoryId: normalizeInventoryCategoryId(payload.categoryId),

    limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? undefined,

    offset:
      optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ?? undefined,
  };
}

function normalizeInventoryAnalyticsInput(input: unknown) {
  const payload = requireObjectInput(input ?? {}, 'فلتر تحليلات المخزون');

  return {
    categoryId: normalizeInventoryCategoryId(payload.categoryId),
  };
}

function normalizeInventoryMovementsInput(input: unknown) {
  const payload = requireObjectInput(input ?? {}, 'فلتر حركات المخزون');

  return {
    variant_id:
      optionalPositiveInteger(payload.variant_id, 'رقم الصنف') ?? undefined,

    search:
      optionalTrimmedString(payload.search, 'بحث حركات المخزون', 500) ??
      undefined,

    limit: optionalPositiveInteger(payload.limit, 'عدد النتائج') ?? undefined,

    offset:
      optionalNonNegativeInteger(payload.offset, 'بداية النتائج') ?? undefined,
  };
}

export function registerInventoryIpc(): void {
  ipcMain.handle('inventory:list', (event, input) => {
    const actor = requirePermission(event, 'inventory.view');

    return protectInventoryCosts(
      actor,
      getInventoryList(normalizeInventoryListInput(input)),
    );
  });

  ipcMain.handle('inventory:list-page', (event, input) => {
    const actor = requireAnyPermission(event, [
      'inventory.view',
      'purchases.manage',
    ]);

    return protectInventoryCosts(
      actor,
      listInventoryPage(normalizeInventoryPageInput(input)),
    );
  });

  ipcMain.handle('inventory:analytics', (event, input) => {
    const actor = requirePermission(event, 'inventory.view');

    return protectInventoryCosts(
      actor,
      getInventoryAnalytics(normalizeInventoryAnalyticsInput(input)),
    );
  });

  ipcMain.handle('inventory:adjust-stock', (event, input) => {
    const actorId = requirePermission(event, 'inventory.adjust').id;

    const payload = requireObjectInput(input, 'بيانات تسوية المخزون');

    const variantId = requirePositiveInteger(payload.variant_id, 'رقم الصنف');

    const targetStock = requireNonNegativeNumber(
      payload.target_stock,
      'المخزون الجديد',
    );

    const notes = optionalTrimmedString(
      payload.notes,
      'ملاحظات تسوية المخزون',
      1000,
    );

    const result = runCriticalActionWithAudit(
      () =>
        adjustVariantStock({
          variant_id: variantId,
          target_stock: targetStock,
          notes,
          actor_id: actorId,
        }),

      (result) => ({
        actor_id: actorId,

        action: 'inventory_stock_adjusted',

        entity: 'inventory',

        entity_id: Number(result.variant_id),

        details: {
          variant_id: Number(result.variant_id),
          old_stock: Number(result.old_stock),
          new_stock: Number(result.new_stock),
          diff: Number(result.diff),
          notes: notes ?? '',
        },
      }),
    );

    return result;
  });

  ipcMain.handle('inventory:movements', (event, input) => {
    const actor = requirePermission(event, 'inventory.view');

    return protectInventoryCosts(
      actor,
      getStockMovements(normalizeInventoryMovementsInput(input)),
    );
  });
}
