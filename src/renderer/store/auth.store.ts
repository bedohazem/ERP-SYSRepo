import { create } from 'zustand'

type User = {
  id: number
  name: string
  username: string
  role: string
}

type AuthState = {
  user: User | null
  isAuthenticated: boolean
  login: (user: User) => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  login: (user) => set({ user, isAuthenticated: true }),
  logout: async () => {
    const result = await window.api.logout()

    if (!result.success) {
      throw new Error(result.message || 'فشل تسجيل الخروج')
    }

    set({ user: null, isAuthenticated: false })
  },
}))
