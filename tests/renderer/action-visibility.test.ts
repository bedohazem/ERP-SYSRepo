import { describe, expect, it } from 'vitest';

import { canUseRecordAction } from '../../src/renderer/utils/action-visibility';

describe('record action visibility', () => {
  const cashier = { id: 2, role: 'cashier' };
  const admin = { id: 1, role: 'admin' };

  it('allows cashier to manage own current-shift record', () => {
    expect(
      canUseRecordAction({
        user: cashier,
        recordOwnerId: 2,
        recordShiftId: 10,
        openShiftId: 10,
      }),
    ).toBe(true);
  });

  it('hides another cashier record', () => {
    expect(
      canUseRecordAction({
        user: cashier,
        recordOwnerId: 3,
        recordShiftId: 10,
        openShiftId: 10,
      }),
    ).toBe(false);
  });

  it('hides previous shift operations', () => {
    expect(
      canUseRecordAction({
        user: cashier,
        recordOwnerId: 2,
        recordShiftId: 9,
        openShiftId: 10,
      }),
    ).toBe(false);
  });

  it('hides actions without an open shift', () => {
    expect(
      canUseRecordAction({
        user: cashier,
        recordOwnerId: 2,
        recordShiftId: 10,
        openShiftId: null,
      }),
    ).toBe(false);
  });

  it('hides legacy records without shift attribution', () => {
    expect(
      canUseRecordAction({
        user: cashier,
        recordOwnerId: 2,
        recordShiftId: null,
        openShiftId: 10,
      }),
    ).toBe(false);
  });

  it('allows admin to cancel historical operations', () => {
    expect(
      canUseRecordAction({
        user: admin,
        recordOwnerId: 2,
        recordShiftId: 9,
        openShiftId: 10,
      }),
    ).toBe(true);
  });

  it('does not allow admin to edit a closed-shift sale', () => {
    expect(
      canUseRecordAction({
        user: admin,
        recordOwnerId: 2,
        recordShiftId: 9,
        openShiftId: 10,
        adminRequiresSameShift: true,
      }),
    ).toBe(false);
  });

  it('allows admin to edit a sale in the open shift', () => {
    expect(
      canUseRecordAction({
        user: admin,
        recordOwnerId: 2,
        recordShiftId: 10,
        openShiftId: 10,
        adminRequiresSameShift: true,
      }),
    ).toBe(true);
  });

  it('denies unauthenticated users', () => {
    expect(
      canUseRecordAction({
        user: null,
        recordOwnerId: 2,
        recordShiftId: 10,
        openShiftId: 10,
      }),
    ).toBe(false);
  });
});
