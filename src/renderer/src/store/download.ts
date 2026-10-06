import { create } from 'zustand'
import { IPC_EVENT } from '@shared/ipc'
import type { DownloadTask, Song, SoundLevel } from '@shared/types'
import { toast } from './toast'

interface DownloadState {
  tasks: DownloadTask[]
  loaded: boolean
  init: () => Promise<void>
  refresh: () => Promise<void>
  start: (song: Song, level?: SoundLevel) => Promise<void>
  startBatch: (songs: Song[], level?: SoundLevel) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string, deleteFile?: boolean) => Promise<void>
  clear: (deleteFiles?: boolean) => Promise<void>
  reveal: (id: string) => Promise<void>
  open: (id: string) => Promise<void>
}

let bound = false

export const useDownloadStore = create<DownloadState>((set, get) => ({
  tasks: [],
  loaded: false,

  init: async () => {
    if (!bound) {
      bound = true
      window.ncm.on<DownloadTask>(IPC_EVENT.DownloadProgress, (task) => {
        set((state) => {
          const index = state.tasks.findIndex((item) => item.id === task.id)
          if (index === -1) return { tasks: [task, ...state.tasks] }
          const tasks = [...state.tasks]
          tasks[index] = task
          return { tasks }
        })
      })
      window.ncm.on<DownloadTask>(IPC_EVENT.DownloadDone, (task) => {
        set((state) => {
          const index = state.tasks.findIndex((item) => item.id === task.id)
          if (index === -1) return { tasks: [task, ...state.tasks] }
          const tasks = [...state.tasks]
          tasks[index] = task
          return { tasks }
        })
        if (task.status === 'done') toast.success(`《${task.name}》下载完成`)
      })
    }
    await get().refresh()
  },

  refresh: async () => {
    try {
      const tasks = await window.ncm.download.list()
      set({ tasks, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  start: async (song, level) => {
    try {
      const task = await window.ncm.download.start({ song, level })
      set((state) => ({
        tasks: [task, ...state.tasks.filter((t) => t.id !== task.id)],
      }))
      toast.info(`开始下载《${song.name}》`)
    } catch (error) {
      toast.fromError(error, '下载失败')
    }
  },

  startBatch: async (songs, level) => {
    if (songs.length === 0) return
    let queued = 0
    for (const song of songs) {
      try {
        const task = await window.ncm.download.start({ song, level })
        set((state) => ({
          tasks: [task, ...state.tasks.filter((t) => t.id !== task.id)],
        }))
        queued += 1
      } catch {
        /* 单首失败继续后面的 */
      }
    }
    if (queued > 0) toast.success(`已加入下载队列：${queued} 首`)
  },

  cancel: async (id) => {
    await window.ncm.download.cancel(id)
    await get().refresh()
  },

  remove: async (id, deleteFile = false) => {
    await window.ncm.download.remove(id, deleteFile)
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }))
  },

  clear: async (deleteFiles = false) => {
    await window.ncm.download.clear(deleteFiles)
    set({ tasks: [] })
  },

  reveal: async (id) => {
    await window.ncm.download.reveal(id)
  },

  open: async (id) => {
    await window.ncm.download.open(id)
  },
}))
