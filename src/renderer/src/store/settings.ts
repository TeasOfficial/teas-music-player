import { create } from 'zustand'
import type { Settings } from '@shared/types'
import { toast } from './toast'

/** 与主进程 DEFAULT_SETTINGS 保持一致；主进程不可用时用它兜底渲染 */
const FALLBACK: Settings = {
  level: 'exhigh',
  volume: 0.7,
  muted: false,
  playMode: 'order',
  desktopLyric: false,
  lyricLocked: false,
  lyricFontSize: 28,
  lyricOpacity: 0.9,
  lyricOffset: 0,
  minimizeToTray: true,
  autoLaunch: false,
  globalShortcut: true,
  localFolders: [],
  downloadDir: '',
  downloadLevel: 'exhigh',
  downloadSaveExtra: true,
  resumeOnStart: true,
  theme: 'dark',
  showTranslation: true,
  showRoman: false,
  fadeInOut: true,
  onboarded: false,
}

export function applyTheme(theme: Settings['theme']): void {
  document.documentElement.dataset.theme = theme
}

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>
  reset: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: FALLBACK,
  loaded: false,

  load: async () => {
    try {
      const settings = await window.ncm.config.all()
      applyTheme(settings.theme)
      set({ settings, loaded: true })
    } catch {
      applyTheme(FALLBACK.theme)
      set({ settings: FALLBACK, loaded: true })
    }
  },

  update: async (key, value) => {
    const previous = get().settings
    const optimistic = { ...previous, [key]: value }
    if (key === 'theme') applyTheme(value as Settings['theme'])
    set({ settings: optimistic })
    try {
      const settings = await window.ncm.config.set(key, value)
      set({ settings })
    } catch (error) {
      set({ settings: previous })
      if (key === 'theme') applyTheme(previous.theme)
      toast.fromError(error, '设置保存失败')
    }
  },

  reset: async () => {
    try {
      const settings = await window.ncm.config.reset()
      applyTheme(settings.theme)
      set({ settings })
      toast.success('已恢复默认设置')
    } catch (error) {
      toast.fromError(error, '恢复默认设置失败')
    }
  },
}))

/** 非组件场景读取设置 */
export function currentSettings(): Settings {
  return useSettingsStore.getState().settings
}
