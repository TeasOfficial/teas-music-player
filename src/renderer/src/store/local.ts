import { create } from 'zustand'
import { IPC_EVENT, type LocalScanProgress } from '@shared/ipc'
import type { LocalTrack } from '@shared/types'
import { toast } from './toast'

interface LocalState {
  tracks: LocalTrack[]
  folders: string[]
  scanning: boolean
  progress: LocalScanProgress | null
  loaded: boolean
  init: () => Promise<void>
  refresh: () => Promise<void>
  scan: () => Promise<void>
  pickFolder: () => Promise<void>
  removeFolder: (folder: string) => Promise<void>
  removeTrack: (id: number) => Promise<void>
  clear: () => Promise<void>
}

let bound = false

export const useLocalStore = create<LocalState>((set, get) => ({
  tracks: [],
  folders: [],
  scanning: false,
  progress: null,
  loaded: false,

  init: async () => {
    if (!bound) {
      bound = true
      window.ncm.on<LocalScanProgress>(
        IPC_EVENT.LocalScanProgress,
        (progress) => {
          set({ progress, scanning: !progress.done })
        },
      )
      window.ncm.on<LocalTrack[]>(IPC_EVENT.LocalScanDone, (tracks) => {
        set({ tracks, scanning: false, progress: null })
      })
    }
    try {
      const settings = await window.ncm.config.all()
      set({ folders: settings.localFolders })
    } catch {
      /* 忽略 */
    }
    await get().refresh()
  },

  refresh: async () => {
    try {
      const tracks = await window.ncm.local.list()
      set({ tracks, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  scan: async () => {
    const { folders, scanning } = get()
    if (scanning) return
    if (folders.length === 0) {
      toast.info('请先添加音乐文件夹')
      return
    }
    set({ scanning: true, progress: null })
    try {
      const tracks = await window.ncm.local.scan()
      set({ tracks, scanning: false, progress: null })
      toast.success(`扫描完成，共 ${tracks.length} 首`)
    } catch (error) {
      set({ scanning: false, progress: null })
      toast.fromError(error, '扫描失败')
    }
  },

  pickFolder: async () => {
    try {
      const folders = await window.ncm.local.pickFolder()
      set({ folders })
      if (folders.length > 0) await get().scan()
    } catch (error) {
      toast.fromError(error, '选择文件夹失败')
    }
  },

  removeFolder: async (folder) => {
    try {
      const folders = await window.ncm.local.removeFolder(folder)
      set({ folders })
      await get().refresh()
    } catch (error) {
      toast.fromError(error, '移除文件夹失败')
    }
  },

  removeTrack: async (id) => {
    await window.ncm.local.removeTrack(id)
    set((state) => ({
      tracks: state.tracks.filter((track) => track.id !== id),
    }))
  },

  clear: async () => {
    await window.ncm.local.clear()
    set({ tracks: [] })
    toast.success('已清空本地音乐库')
  },
}))
