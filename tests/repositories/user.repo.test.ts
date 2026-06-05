import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createUser,
  findUserByUsername,
  listUsers,
  resetUserPassword,
  setUserActive,
  updateUser,
  upgradeUserPasswordHash
} from '../../src/main/database/repositories/user.repo';

type PublicUserTestRow = {
  id: number;
  name: string;
  username: string;
  role: string;
  is_active: number;
  created_at: string;
  password?: string;
};

function getUserRawById(id: number) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT *
      FROM users
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(id) as PublicUserTestRow & { password: string };
}

describe('user repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('seeds default admin user', () => {
    const users = listUsers() as PublicUserTestRow[];

    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('admin');
    expect(users[0].role).toBe('admin');
    expect(users[0].is_active).toBe(1);
    expect(users[0].password).toBeUndefined();
  });

  it('creates a cashier user without returning password', () => {
    const user = createUser('Cashier One', 'cashier1', '1234', 'cashier') as PublicUserTestRow;

    expect(user.id).toBeGreaterThan(0);
    expect(user.name).toBe('Cashier One');
    expect(user.username).toBe('cashier1');
    expect(user.role).toBe('cashier');
    expect(user.is_active).toBe(1);
    expect(user.password).toBeUndefined();

    const raw = getUserRawById(user.id);
    expect(raw.password).not.toBe('1234');
    expect(raw.password.length).toBeGreaterThan(10);
  });

  it('creates an admin user', () => {
    const user = createUser('Second Admin', 'admin2', '1234', 'admin') as PublicUserTestRow;

    expect(user.role).toBe('admin');
    expect(user.username).toBe('admin2');
  });

  it('normalizes unknown role to cashier', () => {
    const user = createUser('Unknown Role', 'unknown_role', '1234', 'manager') as PublicUserTestRow;

    expect(user.role).toBe('cashier');
  });

  it('rejects empty name', () => {
    expect(() =>
      createUser('   ', 'user1', '1234', 'cashier')
    ).toThrow('اسم المستخدم مطلوب');
  });

  it('rejects empty username', () => {
    expect(() =>
      createUser('User One', '   ', '1234', 'cashier')
    ).toThrow('اسم الدخول مطلوب');
  });

  it('rejects short password', () => {
    expect(() =>
      createUser('User One', 'user1', '123', 'cashier')
    ).toThrow('كلمة المرور يجب ألا تقل عن 4 أحرف');
  });

  it('rejects duplicate username', () => {
    createUser('Cashier One', 'duplicate_user', '1234', 'cashier');

    expect(() =>
      createUser('Cashier Two', 'duplicate_user', '1234', 'cashier')
    ).toThrow('اسم المستخدم مستخدم بالفعل');
  });

  it('lists users and searches by name username and role', () => {
    createUser('Search Cashier', 'search_cashier', '1234', 'cashier');

    const allUsers = listUsers() as PublicUserTestRow[];
    const byName = listUsers('Search') as PublicUserTestRow[];
    const byUsername = listUsers('search_cashier') as PublicUserTestRow[];
    const byRole = listUsers('cashier') as PublicUserTestRow[];

    expect(allUsers.length).toBeGreaterThanOrEqual(2);
    expect(byName).toHaveLength(1);
    expect(byName[0].username).toBe('search_cashier');

    expect(byUsername).toHaveLength(1);
    expect(byUsername[0].name).toBe('Search Cashier');

    expect(byRole.some((user) => user.username === 'search_cashier')).toBe(true);
  });

  it('updates user name username role and active status', () => {
    const user = createUser('Old Name', 'old_username', '1234', 'cashier') as PublicUserTestRow;

    const updated = updateUser({
      id: user.id,
      name: 'New Name',
      username: 'new_username',
      role: 'admin',
      is_active: 1
    }) as PublicUserTestRow;

    expect(updated.id).toBe(user.id);
    expect(updated.name).toBe('New Name');
    expect(updated.username).toBe('new_username');
    expect(updated.role).toBe('admin');
    expect(updated.is_active).toBe(1);
    expect(updated.password).toBeUndefined();
  });

  it('rejects updating missing user', () => {
    expect(() =>
      updateUser({
        id: 999999,
        name: 'Missing',
        username: 'missing',
        role: 'cashier',
        is_active: 1
      })
    ).toThrow('المستخدم غير موجود');
  });

  it('rejects updating user with duplicate username', () => {
    const user1 = createUser('User One', 'user_one', '1234', 'cashier') as PublicUserTestRow;
    const user2 = createUser('User Two', 'user_two', '1234', 'cashier') as PublicUserTestRow;

    expect(() =>
      updateUser({
        id: user2.id,
        name: 'User Two',
        username: user1.username,
        role: 'cashier',
        is_active: 1
      })
    ).toThrow('اسم المستخدم مستخدم بالفعل');
  });

  it('deactivates and reactivates cashier user', () => {
    const user = createUser('Cashier', 'cashier_toggle', '1234', 'cashier') as PublicUserTestRow;

    const inactive = setUserActive(user.id, 0) as PublicUserTestRow;
    expect(inactive.is_active).toBe(0);

    expect(findUserByUsername('cashier_toggle')).toBeUndefined();

    const active = setUserActive(user.id, 1) as PublicUserTestRow;
    expect(active.is_active).toBe(1);

    const found = findUserByUsername('cashier_toggle');
    expect(found?.username).toBe('cashier_toggle');
  });

  it('rejects deactivating the last active admin', () => {
    const admin = findUserByUsername('admin') as any;

    expect(() => setUserActive(admin.id, 0)).toThrow(
      'لا يمكن تعطيل أو تغيير آخر مدير في النظام'
    );
  });

  it('allows deactivating one admin when another active admin exists', () => {
    const admin = findUserByUsername('admin') as any;

    createUser('Second Admin', 'admin_second', '1234', 'admin');

    const inactive = setUserActive(admin.id, 0) as PublicUserTestRow;

    expect(inactive.is_active).toBe(0);
  });

  it('rejects changing the last admin role to cashier', () => {
    const admin = findUserByUsername('admin') as any;

    expect(() =>
      updateUser({
        id: admin.id,
        name: 'Administrator',
        username: 'admin',
        role: 'cashier',
        is_active: 1
      })
    ).toThrow('لا يمكن تعطيل أو تغيير آخر مدير في النظام');
  });

  it('resets user password without returning password', () => {
    const user = createUser('Password User', 'password_user', '1234', 'cashier') as PublicUserTestRow;
    const oldRaw = getUserRawById(user.id);

    const updated = resetUserPassword(user.id, '5678') as PublicUserTestRow;

    expect(updated.id).toBe(user.id);
    expect(updated.password).toBeUndefined();

    const newRaw = getUserRawById(user.id);

    expect(newRaw.password).not.toBe(oldRaw.password);
    expect(newRaw.password).not.toBe('5678');
  });

  it('rejects reset password with short password', () => {
    const user = createUser('Password User', 'short_password_user', '1234', 'cashier') as PublicUserTestRow;

    expect(() =>
      resetUserPassword(user.id, '123')
    ).toThrow('كلمة المرور يجب ألا تقل عن 4 أحرف');
  });

  it('finds only active user by username', () => {
    const user = createUser('Find User', 'find_user', '1234', 'cashier') as PublicUserTestRow;

    expect(findUserByUsername('find_user')?.id).toBe(user.id);

    setUserActive(user.id, 0);

    expect(findUserByUsername('find_user')).toBeUndefined();
  });

  it('upgrades user password hash', () => {
    const user = createUser('Upgrade User', 'upgrade_user', '1234', 'cashier') as PublicUserTestRow;
    const before = getUserRawById(user.id);

    upgradeUserPasswordHash(user.id, '9999');

    const after = getUserRawById(user.id);

    expect(after.password).not.toBe(before.password);
    expect(after.password).not.toBe('9999');
  });
});