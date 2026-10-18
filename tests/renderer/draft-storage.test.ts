import { describe, expect, it } from 'vitest';

import {
  clearAllErpDrafts,
  getUserScopedDraftKey,
  readUserScopedDraft,
  writeUserScopedDraft,
  PURCHASE_DRAFT_STORAGE_BASE,
  SALES_DRAFT_STORAGE_BASE,
} from '../../src/renderer/utils/draft-storage';

function createMemoryStorage() {
  const data = new Map<string, string>();

  const storage = {
    get length() {
      return data.size;
    },

    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },

    getItem(key: string) {
      return data.get(key) ?? null;
    },

    setItem(key: string, value: string) {
      data.set(key, value);
    },

    removeItem(key: string) {
      data.delete(key);
    },
  };

  return {
    data,
    storage,
  };
}

describe('user scoped drafts', () => {
  it('gives every user a different draft key', () => {
    expect(getUserScopedDraftKey(SALES_DRAFT_STORAGE_BASE, 1)).toBe(
      'fony_sales_invoice_draft_v1:user:1',
    );

    expect(getUserScopedDraftKey(SALES_DRAFT_STORAGE_BASE, 2)).toBe(
      'fony_sales_invoice_draft_v1:user:2',
    );

    expect(getUserScopedDraftKey(SALES_DRAFT_STORAGE_BASE, null)).toBeNull();
  });

  it('keeps user A drafts private across logout and user switching', () => {
    for (const baseKey of [
      SALES_DRAFT_STORAGE_BASE,
      PURCHASE_DRAFT_STORAGE_BASE,
    ]) {
      const { storage } = createMemoryStorage();

      expect(writeUserScopedDraft(storage, baseKey, 101, 'draft-user-a')).toBe(
        true,
      );

      /*
       * User A logs out.
       *
       * User B logs in on the same device.
       * B must not receive A's draft.
       */
      expect(readUserScopedDraft(storage, baseKey, 202)).toBeNull();

      expect(writeUserScopedDraft(storage, baseKey, 202, 'draft-user-b')).toBe(
        true,
      );

      expect(readUserScopedDraft(storage, baseKey, 202)).toBe('draft-user-b');

      /*
       * When A returns, A gets only A's
       * own saved draft.
       */
      expect(readUserScopedDraft(storage, baseKey, 101)).toBe('draft-user-a');
    }
  });

  it('refuses to read or write a draft without a valid authenticated user', () => {
    const { storage } = createMemoryStorage();

    expect(
      writeUserScopedDraft(
        storage,
        SALES_DRAFT_STORAGE_BASE,
        null,
        'should-not-save',
      ),
    ).toBe(false);

    expect(
      readUserScopedDraft(storage, SALES_DRAFT_STORAGE_BASE, null),
    ).toBeNull();
  });

  it('clears all legacy and scoped ERP drafts after database replacement', () => {
    const { data, storage } = createMemoryStorage();

    data.set(SALES_DRAFT_STORAGE_BASE, 'legacy-sale');

    data.set(`${SALES_DRAFT_STORAGE_BASE}:user:1`, 'sale-1');

    data.set(`${PURCHASE_DRAFT_STORAGE_BASE}:user:2`, 'purchase-2');

    data.set('unrelated-setting', 'keep-me');

    clearAllErpDrafts(storage);

    expect(data.has(SALES_DRAFT_STORAGE_BASE)).toBe(false);

    expect(data.has(`${SALES_DRAFT_STORAGE_BASE}:user:1`)).toBe(false);

    expect(data.has(`${PURCHASE_DRAFT_STORAGE_BASE}:user:2`)).toBe(false);

    expect(data.get('unrelated-setting')).toBe('keep-me');
  });
});
