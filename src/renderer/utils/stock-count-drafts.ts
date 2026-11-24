export type StockCountDraftValues = {
  actual: Record<number, string>;
  notes: Record<number, string>;
};

type CountItem = {
  id: number;
  actual_stock?: number | null;
  notes?: string | null;
};

export function getStockCountDraftKey(userId: number, sessionId: number) {
  return `erp:stock-count-drafts:v1:${userId}:${sessionId}`;
}

// Empty input cancels a new draft; zero is a valid counted quantity.
export function normalizeActualDraft(
  value: string,
  saved: number | null | undefined,
): string | null {
  if (value.trim() === '') return null;
  if (
    saved !== null &&
    saved !== undefined &&
    Number(value) === Number(saved)
  ) {
    return null;
  }
  return value;
}

export function readStockCountDrafts(
  key: string,
  items: CountItem[],
): StockCountDraftValues {
  const drafts: StockCountDraftValues = { actual: {}, notes: {} };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return drafts;
    const data = JSON.parse(raw) as {
      version?: unknown;
      actual?: Record<string, unknown>;
      notes?: Record<string, unknown>;
    } | null;
    if (!data || data.version !== 1) return drafts;

    // Only restore items belonging to the currently opened session.
    for (const item of items) {
      const actual = data.actual?.[String(item.id)];
      if (typeof actual === 'string' && actual.length <= 50) {
        const normalized = normalizeActualDraft(actual, item.actual_stock);
        if (normalized !== null) drafts.actual[item.id] = normalized;
      }
      const notes = data.notes?.[String(item.id)];
      if (
        typeof notes === 'string' &&
        notes.length <= 10000 &&
        notes !== (item.notes ?? '')
      ) {
        drafts.notes[item.id] = notes;
      }
    }
  } catch (error) {
    console.error('Failed to restore stock count draft:', error);
  }
  return drafts;
}

export function writeStockCountDrafts(
  key: string,
  drafts: StockCountDraftValues,
) {
  try {
    if (
      Object.keys(drafts.actual).length === 0 &&
      Object.keys(drafts.notes).length === 0
    ) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify({ version: 1, ...drafts }));
    }
    return true;
  } catch (error) {
    console.error('Failed to persist stock count draft:', error);
    return false;
  }
}

export function clearStockCountDrafts(key: string) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Failed to clear stock count draft:', error);
  }
}
