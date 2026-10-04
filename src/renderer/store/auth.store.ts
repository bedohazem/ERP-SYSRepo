import { create } from 'zustand';
import type { PermissionKey } from '../../shared/permissions';

type User = {
  id: number;
  name: string;
  username: string;
  role: string;
  permissions?: PermissionKey[];
};

type AuthState = {
  user: User | null;

  isAuthenticated: boolean;

  login: (user: User) => void;

  logout: () => Promise<void>;

  lock: () => Promise<void>;

  clearLocalSession: () => void;
  setPermissions: (permissions: PermissionKey[]) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,

  isAuthenticated: false,

  login: (user) =>
    set({
      user,

      isAuthenticated: true,
    }),

  setPermissions: (permissions) =>
    set((state) => ({
      user: state.user
        ? {
            ...state.user,

            permissions: [...permissions],
          }
        : null,
    })),

  logout: async () => {
    const result = await window.api.logout();

    if (!result.success) {
      throw new Error(result.message || 'فشل تسجيل الخروج');
    }

    set({
      user: null,

      isAuthenticated: false,
    });
  },

  lock: async () => {
    try {
      await window.api.lockAuthSession();
    } finally {
      set({
        user: null,

        isAuthenticated: false,
      });
    }
  },

  clearLocalSession: () =>
    set({
      user: null,

      isAuthenticated: false,
    }),
}));
