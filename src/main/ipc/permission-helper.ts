import { getDb } from '../database/db';

export function requireAdmin(actorId?: number | null): void {
  const cleanActorId = Number(actorId || 0);

  if (!cleanActorId) {
    throw new Error('غير مصرح بتنفيذ هذه العملية');
  }

  const db = getDb();

  const user = db
    .prepare(
      `
      SELECT id, role, is_active
      FROM users
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(cleanActorId) as
    | {
        id: number;
        role: string;
        is_active: number;
      }
    | undefined;

  if (!user || user.is_active !== 1 || user.role !== 'admin') {
    throw new Error('هذه العملية متاحة لمدير النظام فقط');
  }
}