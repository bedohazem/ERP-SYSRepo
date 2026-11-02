import { userHasPermission } from '../database/repositories/user.repo';

const SALES_COST_FIELDS = new Set([
  'buy_price',
  'unit_cost',
  'old_unit_cost',
  'new_unit_cost',
  'original_unit_cost',
  'current_unit_cost',
]);

const SALES_COST_JSON_FIELDS = new Set([
  'before_state_json',
  'after_state_json',
]);

function redactSalesCostData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSalesCostData(item)) as T;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(source)) {
    if (SALES_COST_FIELDS.has(key)) {
      result[key] = 0;
      continue;
    }

    if (SALES_COST_JSON_FIELDS.has(key)) {
      result[key] = '[]';
      continue;
    }

    result[key] = redactSalesCostData(child);
  }

  return result as T;
}

export function protectSalesCostData<T>(
  actor: {
    id: number;
    role: string;
  },
  value: T,
): T {
  if (actor.role === 'admin' || userHasPermission(actor.id, 'costs.view')) {
    return value;
  }

  return redactSalesCostData(value);
}
