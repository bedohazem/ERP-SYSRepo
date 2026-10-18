export const SALES_DRAFT_STORAGE_BASE = 'fony_sales_invoice_draft_v1';

export const PURCHASE_DRAFT_STORAGE_BASE = 'fony_purchase_invoice_draft_v1';

export function getUserScopedDraftKey(
  baseKey: string,
  userId: unknown,
): string | null {
  const id = Number(userId);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return `${baseKey}:user:${id}`;
}

type DraftReadStorage = Pick<Storage, 'getItem'>;

type DraftWriteStorage = Pick<Storage, 'setItem'>;

type DraftCleanupStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

export function readUserScopedDraft(
  storage: DraftReadStorage,
  baseKey: string,
  userId: unknown,
): string | null {
  const key = getUserScopedDraftKey(baseKey, userId);

  if (!key) {
    return null;
  }

  return storage.getItem(key);
}

export function writeUserScopedDraft(
  storage: DraftWriteStorage,
  baseKey: string,
  userId: unknown,
  value: string,
): boolean {
  const key = getUserScopedDraftKey(baseKey, userId);

  if (!key) {
    return false;
  }

  storage.setItem(key, value);

  return true;
}

export function clearAllErpDrafts(storage: DraftCleanupStorage) {
  const bases = [SALES_DRAFT_STORAGE_BASE, PURCHASE_DRAFT_STORAGE_BASE];

  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (key) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    const shouldRemove = bases.some(
      (base) => key === base || key.startsWith(`${base}:user:`),
    );

    if (shouldRemove) {
      storage.removeItem(key);
    }
  }
}
