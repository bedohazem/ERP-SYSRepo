import { ipcMain } from 'electron';
import { getActorId, logAction } from './activity-helper';
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

      logAction({
        actor_id: getActorId(data),
        action: 'user_created',
        entity: 'users',
        entity_id: user.id,
        details: {
          name: user.name,
          username: user.username,
          role: user.role
        }
      });

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

      logAction({
        actor_id: getActorId(input),
        action: 'user_updated',
        entity: 'users',
        entity_id: user.id,
        details: {
          name: user.name,
          username: user.username,
          role: user.role,
          is_active: user.is_active
        }
      });

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

  ipcMain.handle('users:set-active', (_, userId: number, isActive: number, actorId?: number) => {
      try {
        const user = setUserActive(userId, isActive);

        logAction({
          actor_id: actorId ?? null,
          action: isActive ? 'user_activated' : 'user_deactivated',
          entity: 'users',
          entity_id: userId,
          details: {
            username: user.username,
            is_active: user.is_active
          }
        });

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
    }
  );

  ipcMain.handle('users:reset-password', (_, userId: number, password: string, actorId?: number) => {
    try {
      const user = resetUserPassword(userId, password);

      logAction({
        actor_id: actorId ?? null,
        action: 'user_password_reset',
        entity: 'users',
        entity_id: userId,
        details: {
          username: user.username
        }
      });

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