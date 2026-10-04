import { getDb } from '../database/db';
import {
  CRITICAL_AUDIT_ERROR_MESSAGE,
  createCriticalActivityLog,
  safeCreateActivityLog,
  type ActivityLogInput,
} from '../database/repositories/activity.repo';

export { CRITICAL_AUDIT_ERROR_MESSAGE };

export type ActionLogInput = {
  actor_id?: number | null;

  approved_by?: number | null;

  action: string;

  entity: string;

  entity_id?: number | null;

  details?: any;
};

export function getActorId(input: any): number | null {
  return (
    input?.actor_id ??
    input?.user_id ??
    input?.created_by ??
    input?.created_by_id ??
    null
  );
}

function normalizeActionLog(input: ActionLogInput): ActivityLogInput {
  return {
    user_id: input.actor_id ?? null,

    approved_by: input.approved_by ?? null,

    action: input.action,

    entity: input.entity,

    entity_id: input.entity_id ?? null,

    details:
      typeof input.details === 'string'
        ? input.details
        : JSON.stringify(input.details ?? {}),
  };
}

/*
 * Best-effort audit.
 *
 * يفضل للعمليات غير الحرجة فقط،
 * لأن فشل الـAudit هنا لا يفشل العملية.
 */
export function logAction(input: ActionLogInput) {
  safeCreateActivityLog(normalizeActionLog(input));
}

/*
 * Strict audit.
 *
 * أي فشل في كتابة الـAudit
 * يتم رميه ولا يتم تجاهله.
 */
export function logCriticalAction(input: ActionLogInput) {
  return createCriticalActivityLog(normalizeActionLog(input));
}

/*
 * العملية الحرجة والـAudit يتمان
 * داخل Transaction واحدة.
 *
 * لو العملية فشلت -> Rollback.
 * لو الـAudit فشل -> Rollback للعملية أيضًا.
 */

export function runCriticalActionWithAudit<T>(
  run: () => T,

  buildAudit:
    ((result: T) => ActionLogInput) | ((result: T) => ActionLogInput[]),
): T {
  const db = getDb();

  const tx = db.transaction(() => {
    const result = run();

    try {
      const auditResult = buildAudit(result);

      const logs = Array.isArray(auditResult) ? auditResult : [auditResult];

      if (logs.length === 0) {
        throw new Error('Missing critical audit log');
      }

      for (const log of logs) {
        logCriticalAction(log);
      }
    } catch (error) {
      console.error('Critical audit failed:', error);

      throw new Error(CRITICAL_AUDIT_ERROR_MESSAGE);
    }

    return result;
  });

  return tx();
}
