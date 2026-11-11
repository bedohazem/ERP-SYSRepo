export type ActionUser =
  | {
      id?: number | null;
      role?: string | null;
    }
  | null
  | undefined;

type RecordActionInput = {
  user: ActionUser;
  recordOwnerId?: number | null;
  recordShiftId?: number | null;
  openShiftId?: number | null;

  // تعديل فاتورة البيع يحتاج شيفتها الأصلي
  // حتى لو المستخدم أدمن.
  adminRequiresSameShift?: boolean;
};

export function canUseRecordAction({
  user,
  recordOwnerId,
  recordShiftId,
  openShiftId,
  adminRequiresSameShift = false,
}: RecordActionInput): boolean {
  const userId = Number(user?.id || 0);

  if (!Number.isInteger(userId) || userId <= 0) {
    return false;
  }

  const isAdmin = user?.role === 'admin';

  // الأدمن له صلاحية الإلغاء عبر الشيفتات.
  if (isAdmin && !adminRequiresSameShift) {
    return true;
  }

  // الكاشير لا يعدل عملية مستخدم آخر.
  if (!isAdmin && Number(recordOwnerId || 0) !== userId) {
    return false;
  }

  const originShift = Number(recordShiftId || 0);
  const currentShift = Number(openShiftId || 0);

  // عملية بلا شفت أو شفت مقفول.
  if (originShift <= 0 || currentShift <= 0) {
    return false;
  }

  return originShift === currentShift;
}
