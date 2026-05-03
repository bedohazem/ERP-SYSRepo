import { getDb } from '../db';

export type UserRow = {
  id: number;
  name: string;
  username: string;
  password: string;
  role: string;
  is_active: number;
  created_at: string;
};

export function createUser(
  name: string,
  username: string,
  password: string,
  role: string = 'cashier'
) {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO users (name, username, password, role)
    VALUES (?, ?, ?, ?)
  `);

  return stmt.run(name, username, password, role);
}

export function findUserByUsername(username: string): UserRow | undefined {
  const db = getDb();

  return db
    .prepare(`SELECT * FROM users WHERE username = ? AND is_active = 1`)
    .get(username) as UserRow | undefined;
}