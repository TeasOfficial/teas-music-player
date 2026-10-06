import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENT } from '@shared/ipc'
import type {
  NcmBridge,
  DownloadStartParams,
  QrCheckResult,
  WindowState,
  CacheSize,
} from '@shared/ipc'
import type {
  ApiStatus,
  ApiProgress,
  AppInfo,
  AuthState,
  DownloadTask,
  LocalTrack,
  NcmApiResponse,
  PlayerSyncPayload,
  Settings,
} from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const bridge: NcmBridge = {
  api: {
    call: <T = unknown>(name: string, params: Record<string, unknown> = {}) =>
      invoke<NcmApiResponse<T>>(IPC.ApiCall, name, params),
    modules: () => invoke<string[]>(IPC.ApiModules),
    status: () => invoke<ApiStatus>(IPC.ApiStatus),
    bootstrap: () => invoke<ApiStatus>(IPC.ApiBootstrap),
    setupProgress: () => invoke<ApiProgress>(IPC.ApiSetupProgress),
    retrySetup: () => invoke<ApiStatus>(IPC.ApiRetrySetup),
  },
  auth: {
    qrCreate: () => invoke(IPC.AuthQrCreate),
    qrCheck: (key: string) => invoke<QrCheckResult>(IPC.AuthQrCheck, key),
    state: (verify = false) => invoke<AuthState>(IPC.AuthState, verify),
    logout: () => invoke<void>(IPC.AuthLogout),
    importCookie: (cookie: string) =>
      invoke<AuthState>(IPC.AuthImportCookie, cookie),
    refresh: () => invoke<AuthState>(IPC.AuthRefresh),
  },
  config: {
    all: () => invoke<Settings>(IPC.ConfigAll),
    get: (key) => invoke(IPC.ConfigGet, key),
    set: (key, value) => invoke<Settings>(IPC.ConfigSet, key, value),
    reset: () => invoke<Settings>(IPC.ConfigReset),
  },
  win: {
    minimize: () => invoke<void>(IPC.WinMinimize),
    maximize: () => invoke<void>(IPC.WinMaximize),
    close: () => invoke<void>(IPC.WinClose),
    hide: () => invoke<void>(IPC.WinHide),
    show: () => invoke<void>(IPC.WinShow),
    state: () => invoke<WindowState>(IPC.WinState),
    setLyric: (open: boolean) => invoke<WindowState>(IPC.WinSetLyric, open),
    setLyricLock: (locked: boolean) =>
      invoke<WindowState>(IPC.WinSetLyricLock, locked),
    showLyricMenu: () => invoke<void>(IPC.WinShowLyricMenu),
  },
  download: {
    start: (params: DownloadStartParams) =>
      invoke<DownloadTask>(IPC.DownloadStart, params),
    cancel: (id: string) => invoke<void>(IPC.DownloadCancel, id),
    list: () => invoke<DownloadTask[]>(IPC.DownloadList),
    remove: (id: string, deleteFile = false) =>
      invoke<void>(IPC.DownloadRemove, id, deleteFile),
    clear: (deleteFiles = false) =>
      invoke<void>(IPC.DownloadClear, deleteFiles),
    reveal: (id: string) => invoke<void>(IPC.DownloadReveal, id),
    open: (id: string) => invoke<void>(IPC.DownloadOpen, id),
  },
  local: {
    scan: () => invoke<LocalTrack[]>(IPC.LocalScan),
    list: () => invoke<LocalTrack[]>(IPC.LocalList),
    pickFolder: () => invoke<string[]>(IPC.LocalPickFolder),
    removeFolder: (folder: string) =>
      invoke<string[]>(IPC.LocalRemoveFolder, folder),
    removeTrack: (id: number) => invoke<void>(IPC.LocalRemoveTrack, id),
    clear: () => invoke<void>(IPC.LocalClear),
    saveLyric: (trackId: number, lyric: string) =>
      invoke<string | null>(IPC.LocalSaveLyric, trackId, lyric),
  },
  app: {
    info: () => invoke<AppInfo>(IPC.AppInfo),
    openExternal: (url: string) => invoke<void>(IPC.AppOpenExternal, url),
    openPath: (path: string) => invoke<void>(IPC.AppOpenPath, path),
    selectFolder: () => invoke<string | null>(IPC.AppSelectFolder),
    cacheSize: () => invoke<CacheSize>(IPC.AppCacheSize),
    clearCache: () => invoke<void>(IPC.AppClearCache),
    setAutoLaunch: (enabled: boolean) =>
      invoke<boolean>(IPC.AppSetAutoLaunch, enabled),
    setShortcuts: (enabled: boolean) =>
      invoke<boolean>(IPC.AppSetShortcuts, enabled),
    localUrl: (path: string) => invoke<string>(IPC.AppLocalUrl, path),
  },
  player: {
    sync: (payload: PlayerSyncPayload) => {
      ipcRenderer.send(IPC.PlayerSync, payload)
    },
  },
  debug: {
    // preload 运行在有 Node 能力的上下文里，是渲染进程唯一能拿到 env 的通道
    lyric: process.env.NCM_LYRIC_DEBUG === '1',
  },
  on: <T = unknown>(channel: string, listener: (payload: T) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void =>
      listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('ncm', bridge)
contextBridge.exposeInMainWorld('ncmEvents', IPC_EVENT)
