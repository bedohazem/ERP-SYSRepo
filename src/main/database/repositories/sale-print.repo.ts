import { getDb } from '../db';
import { createActivityLog } from './activity.repo';

export type SalePrintMethod = 'silent' | 'dialog';

export type SalePrintSource = 'sale' | 'history';

export type SalePrintHistoryRow = {
  id: number;
  user_id: number | null;
  user_name: string | null;
  username: string | null;
  created_at: string;
  method: SalePrintMethod | null;
  source: SalePrintSource | null;
};

export function assertSalePrintTarget(saleIdInput: number): number {
  const saleId = Number(saleIdInput);

  if (!Number.isSafeInteger(saleId) || saleId <= 0) {
    throw new Error('رقم فاتورة البيع غير صحيح');
  }

  const sale = getDb()
    .prepare(
      `
      SELECT id
      FROM sales
      WHERE id = ?
        AND type = 'sale'
      LIMIT 1
    `,
    )
    .get(saleId);

  if (!sale) {
    throw new Error('فاتورة البيع غير موجودة');
  }

  return saleId;
}

export function recordSalePrint(
  saleIdInput: number,
  actorIdInput: number,
  method: SalePrintMethod,
  source: SalePrintSource | null = null,
): number {
  const saleId = assertSalePrintTarget(saleIdInput);
  const actorId = Number(actorIdInput);

  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new Error('المستخدم الذي طبع الفاتورة غير صحيح');
  }

  if (method !== 'silent' && method !== 'dialog') {
    throw new Error('طريقة الطباعة غير صحيحة');
  }

  const result = createActivityLog({
    user_id: actorId,
    action: 'sale_printed',
    entity: 'sales',
    entity_id: saleId,
    details: JSON.stringify({ method, source }),
  });

  return Number(result.lastInsertRowid);
}

export function getSalePrintHistory(
  saleIdInput: number,
): SalePrintHistoryRow[] {
  const saleId = assertSalePrintTarget(saleIdInput);

  const rows = getDb()
    .prepare(
      `
      SELECT
        al.id,
        al.user_id,
        u.name AS user_name,
        u.username,
        al.created_at,
        al.details
      FROM activity_logs al
      LEFT JOIN users u
        ON u.id = al.user_id
      WHERE al.entity = 'sales'
        AND al.entity_id = ?
        AND al.action = 'sale_printed'
      ORDER BY
        al.created_at DESC,
        al.id DESC
    `,
    )
    .all(saleId) as Array<{
    id: number;
    user_id: number | null;
    user_name: string | null;
    username: string | null;
    created_at: string;
    details: string | null;
  }>;

  return rows.map((row) => {
    let method: SalePrintMethod | null = null;
    let source: SalePrintSource | null = null;
    try {
      const details = JSON.parse(row.details || '{}');

      if (details.method === 'silent' || details.method === 'dialog') {
        method = details.method;
      }
      if (details.source === 'sale' || details.source === 'history') {
        source = details.source;
      }
    } catch {
      method = null;
    }

    return {
      id: Number(row.id),
      user_id: row.user_id,
      user_name: row.user_name,
      username: row.username,
      created_at: row.created_at,
      method,
      source,
    };
  });
}
