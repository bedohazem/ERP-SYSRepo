import { describe, expect, it } from 'vitest';

import {
  clearAllErpDrafts,
  getUserScopedDraftKey,
  PURCHASE_DRAFT_STORAGE_BASE,
  SALES_DRAFT_STORAGE_BASE,
} from '../../src/renderer/utils/draft-storage';

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

  it('clears all legacy and scoped ERP drafts after database replacement', () => {
    const data = new Map<string, string>([
      [SALES_DRAFT_STORAGE_BASE, 'legacy-sale'],
      [`${SALES_DRAFT_STORAGE_BASE}:user:1`, 'sale-1'],
      [`${PURCHASE_DRAFT_STORAGE_BASE}:user:2`, 'purchase-2'],
      ['unrelated-setting', 'keep-me'],
    ]);

    const storage = {
      get length() {
        return data.size;
      },

      key(index: number) {
        return Array.from(data.keys())[index] ?? null;
      },

      removeItem(key: string) {
        data.delete(key);
      },
    };

    clearAllErpDrafts(storage as Storage);

    expect(data.has(SALES_DRAFT_STORAGE_BASE)).toBe(false);

    expect(data.has(`${SALES_DRAFT_STORAGE_BASE}:user:1`)).toBe(false);

    expect(data.has(`${PURCHASE_DRAFT_STORAGE_BASE}:user:2`)).toBe(false);

    expect(data.get('unrelated-setting')).toBe('keep-me');
  });
});
