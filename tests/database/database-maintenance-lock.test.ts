import { describe, expect, it } from 'vitest';

import { runDatabaseMaintenanceExclusive } from '../../src/main/database/database-maintenance-lock';

describe('database maintenance serialization', () => {
  it('never runs two database maintenance jobs concurrently', async () => {
    let active = 0;
    let maxActive = 0;

    async function job() {
      return runDatabaseMaintenanceExclusive(async () => {
        active += 1;

        maxActive = Math.max(maxActive, active);

        await new Promise((resolve) => setTimeout(resolve, 20));

        active -= 1;
      });
    }

    await Promise.all([job(), job(), job(), job()]);

    expect(maxActive).toBe(1);
  });
});
