import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStockCountDraftKey,
  normalizeActualDraft,
  readStockCountDrafts,
  writeStockCountDrafts,
} from '../../src/renderer/utils/stock-count-drafts';

afterEach(() => vi.unstubAllGlobals());

function useStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  return values;
}

describe('stock count unsaved drafts', () => {
  it('drops erased and unchanged amounts, but keeps zero', () => {
    expect(normalizeActualDraft('17', null)).toBe('17');
    expect(normalizeActualDraft('', null)).toBeNull();
    expect(normalizeActualDraft('', 5)).toBeNull();
    expect(normalizeActualDraft('5', 5)).toBeNull();
    expect(normalizeActualDraft('0', null)).toBe('0');
  });

  it('restores quantities and notes only for the correct session and user', () => {
    useStorage();
    const key = getStockCountDraftKey(12, 45);
    expect(
      writeStockCountDrafts(key, {
        actual: { 1: '0', 2: '9' },
        notes: { 1: 'المراجعة مطلوبة' },
      }),
    ).toBe(true);

    expect(
      readStockCountDrafts(key, [{ id: 1, actual_stock: null, notes: null }]),
    ).toEqual({ actual: { 1: '0' }, notes: { 1: 'المراجعة مطلوبة' } });
    expect(
      readStockCountDrafts(getStockCountDraftKey(13, 45), [
        { id: 1, actual_stock: null },
      ]),
    ).toEqual({ actual: {}, notes: {} });
    expect(
      readStockCountDrafts(getStockCountDraftKey(12, 46), [
        { id: 1, actual_stock: null },
      ]),
    ).toEqual({ actual: {}, notes: {} });
  });

  it('removes empty drafts and ignores already saved quantities', () => {
    const values = useStorage();
    const key = getStockCountDraftKey(1, 2);
    writeStockCountDrafts(key, { actual: { 1: '5' }, notes: {} });
    expect(readStockCountDrafts(key, [{ id: 1, actual_stock: 5 }])).toEqual({
      actual: {},
      notes: {},
    });
    writeStockCountDrafts(key, { actual: {}, notes: {} });
    expect(values.has(key)).toBe(false);
  });
});
