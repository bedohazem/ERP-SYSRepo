import { getDb } from '../db';
import { hashPassword } from '../../security/password';

export type UserRow = {
  id: number;
  name: string;
  username: string;
  password: string;
  role: string;
  is_active: number;
  created_at: string;
};

export type PublicUserRow = Omit<UserRow, 'password'>;

type UpdateUserInput = {
  id: number;
  name: string;
  username: string;
  role: string;
  is_active?: number;
};

function toPublicUser(user: UserRow): PublicUserRow {
  const { password, ...safeUser } = user;
  return safeUser;
}

function normalizeRole(role?: string) {
  return role === 'admin' ? 'admin' : 'cashier';
}

function getUserByIdInternal(id: number): UserRow | undefined {
  const db = getDb();

  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

function countOtherActiveAdmins(userId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM users
      WHERE id <> ?
        AND role = 'admin'
        AND is_active = 1
      `
    )
    .get(userId) as { count: number };

  return Number(row.count || 0);
}

function ensureUsernameAvailable(username: string, exceptUserId?: number) {
  const db = getDb();

  const existing = exceptUserId
    ? db
        .prepare(`SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1`)
        .get(username, exceptUserId)
    : db.prepare(`SELECT id FROM users WHERE username = ? LIMIT 1`).get(username);

  if (existing) {
    throw new Error('اسم المستخدم مستخدم بالفعل');
  }
}

function ensureCanChangeAdminStatus(userId: number, nextRole: string, nextActive: number) {
  const current = getUserByIdInternal(userId);

  if (!current) {
    throw new Error('المستخدم غير موجود');
  }

  const isRemovingAdminPower =
    current.role === 'admin' && (nextRole !== 'admin' || Number(nextActive) !== 1);

  if (isRemovingAdminPower && countOtherActiveAdmins(userId) === 0) {
    throw new Error('لا يمكن تعطيل أو تغيير آخر مدير في النظام');
  }
}

export function listUsers(search = ''): PublicUserRow[] {
  const db = getDb();
  const cleanSearch = search.trim();

  if (!cleanSearch) {
    return db
      .prepare(
        `
        SELECT id, name, username, role, is_active, created_at
        FROM users
        ORDER BY id ASC
        `
      )
      .all() as PublicUserRow[];
  }

  return db
    .prepare(
      `
      SELECT id, name, username, role, is_active, created_at
      FROM users
      WHERE name LIKE ?
         OR username LIKE ?
         OR role LIKE ?
      ORDER BY id ASC
      `
    )
    .all(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`) as PublicUserRow[];
}

export function createUser(
  name: string,
  username: string,
  password: string,
  role: string = 'cashier'
): PublicUserRow {
  const db = getDb();

  const cleanName = name.trim();
  const cleanUsername = username.trim();
  const cleanPassword = password.trim();
  const cleanRole = normalizeRole(role);

  if (!cleanName) {
    throw new Error('اسم المستخدم مطلوب');
  }

  if (!cleanUsername) {
    throw new Error('اسم الدخول مطلوب');
  }

  if (cleanPassword.length < 4) {
    throw new Error('كلمة المرور يجب ألا تقل عن 4 أحرف');
  }

  ensureUsernameAvailable(cleanUsername);

  const result = db
    .prepare(
      `
      INSERT INTO users (name, username, password, role, is_active)
      VALUES (?, ?, ?, ?, 1)
      `
    )
    .run(cleanName, cleanUsername, hashPassword(cleanPassword), cleanRole);

  const created = getUserByIdInternal(Number(result.lastInsertRowid));

  if (!created) {
    throw new Error('فشل إنشاء المستخدم');
  }

  return toPublicUser(created);
}

export function updateUser(input: UpdateUserInput): PublicUserRow {
  const db = getDb();

  const current = getUserByIdInternal(input.id);

  if (!current) {
    throw new Error('المستخدم غير موجود');
  }

  const cleanName = input.name.trim();
  const cleanUsername = input.username.trim();
  const cleanRole = normalizeRole(input.role);
  const nextActive = input.is_active === 0 ? 0 : 1;

  if (!cleanName) {
    throw new Error('اسم المستخدم مطلوب');
  }

  if (!cleanUsername) {
    throw new Error('اسم الدخول مطلوب');
  }

  ensureUsernameAvailable(cleanUsername, input.id);
  ensureCanChangeAdminStatus(input.id, cleanRole, nextActive);

  db.prepare(
    `
    UPDATE users
    SET name = ?,
        username = ?,
        role = ?,
        is_active = ?
    WHERE id = ?
    `
  ).run(cleanName, cleanUsername, cleanRole, nextActive, input.id);

  const updated = getUserByIdInternal(input.id);

  if (!updated) {
    throw new Error('فشل تحديث المستخدم');
  }

  return toPublicUser(updated);
}

export function setUserActive(userId: number, isActive: number): PublicUserRow {
  const db = getDb();
  const current = getUserByIdInternal(userId);

  if (!current) {
    throw new Error('المستخدم غير موجود');
  }

  const nextActive = isActive ? 1 : 0;

  ensureCanChangeAdminStatus(userId, current.role, nextActive);

  db.prepare(`UPDATE users SET is_active = ? WHERE id = ?`).run(nextActive, userId);

  const updated = getUserByIdInternal(userId);

  if (!updated) {
    throw new Error('فشل تحديث حالة المستخدم');
  }

  return toPublicUser(updated);
}

export function resetUserPassword(userId: number, password: string): PublicUserRow {
  const db = getDb();
  const cleanPassword = password.trim();

  if (cleanPassword.length < 4) {
    throw new Error('كلمة المرور يجب ألا تقل عن 4 أحرف');
  }

  const current = getUserByIdInternal(userId);

  if (!current) {
    throw new Error('المستخدم غير موجود');
  }

  db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(
    hashPassword(cleanPassword),
    userId
  );

  const updated = getUserByIdInternal(userId);

  if (!updated) {
    throw new Error('فشل تغيير كلمة المرور');
  }

  return toPublicUser(updated);
}

export function findUserByUsername(username: string): UserRow | undefined {
  const db = getDb();

  return db
    .prepare(`SELECT * FROM users WHERE username = ? AND is_active = 1`)
    .get(username) as UserRow | undefined;
}

export function upgradeUserPasswordHash(userId: number, password: string): void {
  const db = getDb();

  db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(
    hashPassword(password.trim()),
    userId
  );
}