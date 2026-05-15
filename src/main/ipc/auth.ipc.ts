import { ipcMain } from 'electron';
import {
  createUser,
  findUserByUsername,
  listUsers,
  resetUserPassword,
  setUserActive,
  updateUser
} from '../database/repositories/user.repo';

type AuthPayload = {
  name?: string;
  username: string;
  password: string;
  role?: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'حدث خطأ غير متوقع';
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:register', (_, data: AuthPayload) => {
    try {
      const user = createUser(
        data.name ?? '',
        data.username,
        data.password,
        data.role ?? 'cashier'
      );

      return {
        success: true,
        user
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('auth:login', (_, data: AuthPayload) => {
    const user = findUserByUsername(data.username);

    if (!user) {
      return { success: false, message: 'المستخدم غير موجود أو غير مفعل' };
    }

    if (user.password !== data.password) {
      return { success: false, message: 'كلمة المرور غير صحيحة' };
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

  ipcMain.handle('users:list', (_, search?: string) => {
    return listUsers(search || '');
  });

  ipcMain.handle('users:create', (_, data: AuthPayload) => {
    try {
      const user = createUser(
        data.name ?? '',
        data.username,
        data.password,
        data.role ?? 'cashier'
      );

      return {
        success: true,
        user
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('users:update', (_, input) => {
    try {
      const user = updateUser(input);

      return {
        success: true,
        user
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('users:set-active', (_, userId: number, isActive: number) => {
    try {
      const user = setUserActive(userId, isActive);

      return {
        success: true,
        user
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle('users:reset-password', (_, userId: number, password: string) => {
    try {
      const user = resetUserPassword(userId, password);

      return {
        success: true,
        user
      };
    } catch (error) {
      return {
        success: false,
        message: getErrorMessage(error)
      };
    }
  });
}