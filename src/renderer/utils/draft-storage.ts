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

type DraftStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

export function clearAllErpDrafts(storage: DraftStorage) {
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
