import { ipcMain } from 'electron';
import { createUser, findUserByUsername } from '../database/repositories/user.repo';

type AuthPayload = {
  name?: string;
  username: string;
  password: string;
  role?: string;
};

export function registerAuthIpc(): void {
  ipcMain.handle('auth:register', (_, data: AuthPayload) => {
    return createUser(
      data.name ?? '',
      data.username,
      data.password,
      data.role ?? 'cashier'
    );
  });

  ipcMain.handle('auth:login', (_, data: AuthPayload) => {
    const user = findUserByUsername(data.username);

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    if (user.password !== data.password) {
      return { success: false, message: 'Wrong password' };
    }

    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role
      }
    };
  });
}