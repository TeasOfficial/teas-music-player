import { create } from 'zustand'
import type { UserProfile } from '@shared/types'
import { invalidateCache } from '@/lib/api'
import { toast } from './toast'

interface AuthStoreState {
  loggedIn: boolean
  profile: UserProfile | null
  /** 首次校验是否已完成 */
  checked: boolean
  loading: boolean
  check: (verify?: boolean) => Promise<void>
  /** 扫码/导入 cookie 成功后调用 */
  applyProfile: (profile: UserProfile) => void
  logout: () => Promise<void>
  importCookie: (cookie: string) => Promise<void>
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  loggedIn: false,
  profile: null,
  checked: false,
  loading: false,

  check: async (verify = false) => {
    set({ loading: true })
    try {
      const state = await window.ncm.auth.state(verify)
      set({
        loggedIn: state.loggedIn,
        profile: state.profile ?? null,
        checked: true,
        loading: false,
      })
    } catch {
      set({ checked: true, loading: false })
    }
  },

  applyProfile: (profile) => {
    set({ loggedIn: true, profile, checked: true })
    invalidateCache()
  },

  logout: async () => {
    try {
      await window.ncm.auth.logout()
    } finally {
      invalidateCache()
      set({ loggedIn: false, profile: null, checked: true })
      toast.info('已退出登录')
    }
  },

  importCookie: async (cookie) => {
    const state = await window.ncm.auth.importCookie(cookie)
    get().applyProfile(state.profile as UserProfile)
    toast.success('登录成功')
  },
}))

/** 需要登录才能执行的操作：未登录时给出提示并返回 false */
export function requireLogin(): boolean {
  const { loggedIn } = useAuthStore.getState()
  if (!loggedIn) {
    toast.info('请先登录后再操作')
    return false
  }
  return true
}

/** 当前登录用户 id（未登录返回 0） */
export function currentUserId(): number {
  return useAuthStore.getState().profile?.userId ?? 0
}

/** 拉取用户歌单（含我喜欢的音乐） */
