import { safeCreateActivityLog } from '../database/repositories/activity.repo';

export function getActorId(input: any): number | null {
  return (
    input?.actor_id ??
    input?.user_id ??
    input?.created_by ??
    input?.created_by_id ??
    null
  );
}

export function logAction(input: {
  actor_id?: number | null;
  action: string;
  entity: string;
  entity_id?: number | null;
  details?: any;
}) {
  safeCreateActivityLog({
    user_id: input.actor_id ?? null,
    action: input.action,
    entity: input.entity,
    entity_id: input.entity_id ?? null,
    details:
      typeof input.details === 'string'
        ? input.details
        : JSON.stringify(input.details ?? {})
  });
}