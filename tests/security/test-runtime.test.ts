import { describe, expect, it } from 'vitest';

import {
  isE2eSmokeAllowed,
  isTestAdminSeedAllowed,
} from '../../src/main/test-runtime';

describe('test runtime gates', () => {
  it('never enables test admin seeding in a packaged build', () => {
    expect(
      isTestAdminSeedAllowed(true, {
        VITEST: 'true',
        NODE_ENV: 'test',
        ERP_TEST_ADMIN_PASSWORD: 'secret',
      }),
    ).toBe(false);
  });

  it('allows test admin seeding only in an explicit non-packaged test environment', () => {
    expect(
      isTestAdminSeedAllowed(false, {
        VITEST: 'true',
      }),
    ).toBe(true);

    expect(
      isTestAdminSeedAllowed(false, {
        ERP_TEST_ADMIN_PASSWORD: 'secret',
      }),
    ).toBe(false);
  });

  it('never enables E2E smoke hooks in a packaged build', () => {
    expect(
      isE2eSmokeAllowed(true, {
        ERP_E2E_SMOKE: '1',
      }),
    ).toBe(false);

    expect(
      isE2eSmokeAllowed(false, {
        ERP_E2E_SMOKE: '1',
      }),
    ).toBe(true);
  });
});
