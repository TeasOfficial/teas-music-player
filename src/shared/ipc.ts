import type {
  AppInfo,
  AuthState,
  DownloadTask,
  LocalTrack,
  NcmApiResponse,
  PlayerCommand,
  PlayerSyncPayload,
  Settings,
  Song,
  SoundLevel,
  ApiStatus,
  UserProfile,
} from './types'

/** 渲染层 → 主进程的 invoke 通道名 */
export const IPC = {
  /* ---- API 代理 ---- */
  ApiCall: 'api:call',
  ApiModules: 'api:modules',
  ApiStatus: 'api:status',
  ApiBootstrap: 'api:bootstrap',

  /* ---- 认证 ---- */
  AuthQrCreate: 'auth:qr-create',
  AuthQrCheck: 'auth:qr-check',
  AuthState: 'auth:state',
  AuthLogout: 'auth:logout',
  AuthImportCookie: 'auth:import-cookie',
  AuthRefresh: 'auth:refresh',

  /* ---- 配置 ---- */
  ConfigAll: 'config:all',
  ConfigGet: 'config:get',
  ConfigSet: 'config:set',
  ConfigReset: 'config:reset',

  /* ---- 窗口 ---- */
  WinMinimize: 'win:minimize',
  WinMaximize: 'win:maximize',
  WinClose: 'win:close',
  WinHide: 'win:hide',
  WinShow: 'win:show',
  WinState: 'win:state',
  WinSetLyric: 'win:set-lyric',
  WinSetLyricLock: 'win:set-lyric-lock',
  WinShowLyricMenu: 'win:show-lyric-menu',

  /* ---- 下载 ---- */
  DownloadStart: 'download:start',
  DownloadCancel: 'download:cancel',
  DownloadList: 'download:list',
  DownloadRemove: 'download:remove',
  DownloadClear: 'download:clear',
  DownloadReveal: 'download:reveal',
  DownloadOpen: 'download:open',

  /* ---- 本地音乐 ---- */
  LocalScan: 'local:scan',
  LocalList: 'local:list',
  LocalPickFolder: 'local:pick-folder',
  LocalRemoveFolder: 'local:remove-folder',
  LocalRemoveTrack: 'local:remove-track',
  LocalClear: 'local:clear',
  LocalSaveLyric: 'local:save-lyric',

  /* ---- 应用 ---- */
  AppInfo: 'app:info',
  AppOpenExternal: 'app:open-external',
  AppOpenPath: 'app:open-path',
  AppSelectFolder: 'app:select-folder',
  AppCacheSize: 'app:cache-size',
  AppClearCache: 'app:clear-cache',
  AppSetAutoLaunch: 'app:set-auto-launch',
  AppSetShortcuts: 'app:set-shortcuts',
  /** 把本地绝对路径转成 ncmfile:// 播放地址（渲染层无法自己拼） */
  AppLocalUrl: 'app:local-url',

  /* ---- 播放器同步（主窗口 → 主进程 → 歌词窗口/托盘） ---- */
  PlayerSync: 'player:sync',
} as const

/** 主进程 → 渲染层的事件通道名 */
export const IPC_EVENT = {
  WinState: 'evt:win-state',
  PlayerCommand: 'evt:player-command',
  DownloadProgress: 'evt:download-progress',
  DownloadDone: 'evt:download-done',
  LocalScanProgress: 'evt:local-scan-progress',
  LocalScanDone: 'evt:local-scan-done',
  PlayerSync: 'evt:player-sync',
  ConfigChanged: 'evt:config-changed',
  AuthChanged: 'evt:auth-changed',
  Toast: 'evt:toast',
  Navigate: 'evt:navigate',
  ThemeChanged: 'evt:theme-changed',
} as const

export interface WindowState {
  maximized: boolean
  minimized: boolean
  focused: boolean
  lyricOpen: boolean
  lyricLocked: boolean
  fullScreen: boolean
}

export interface QrCreateResult {
  key: string
  /** data:image/png;base64,... */
  qrimg: string
  url: string
}

export type QrCheckCode = 800 | 801 | 802 | 803

export interface QrCheckResult {
  code: QrCheckCode
  message: string
  cookie?: string
  profile?: UserProfile
}

export interface DownloadStartParams {
  song: Song
  level?: SoundLevel
}

export interface LocalScanProgress {
  scanned: number
  total: number
  current: string
  added: number
  done: boolean
}

export interface ToastPayload {
  type: 'info' | 'success' | 'error'
  message: string
}

export interface CacheSize {
  bytes: number
  files: number
}

/** 渲染层可用的完整桥接 API（由 preload 通过 contextBridge 暴露） */
export interface NcmBridge {
  api: {
    call<T = unknown>(
      name: string,
      params?: Record<string, unknown>,
    ): Promise<NcmApiResponse<T>>
    modules(): Promise<string[]>
    status(): Promise<ApiStatus>
    bootstrap(): Promise<ApiStatus>
  }
  auth: {
    qrCreate(): Promise<QrCreateResult>
    qrCheck(key: string): Promise<QrCheckResult>
    /** verify=true 时向服务端确认一次登录态 */
    state(verify?: boolean): Promise<AuthState>
    logout(): Promise<void>
    importCookie(cookie: string): Promise<AuthState>
    refresh(): Promise<AuthState>
  }
  config: {
    all(): Promise<Settings>
    get<K extends keyof Settings>(key: K): Promise<Settings[K]>
    set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<Settings>
    reset(): Promise<Settings>
  }
  win: {
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    hide(): Promise<void>
    show(): Promise<void>
    state(): Promise<WindowState>
    setLyric(open: boolean): Promise<WindowState>
    setLyricLock(locked: boolean): Promise<WindowState>
    showLyricMenu(): Promise<void>
  }
  download: {
    start(params: DownloadStartParams): Promise<DownloadTask>
    cancel(id: string): Promise<void>
    list(): Promise<DownloadTask[]>
    remove(id: string, deleteFile?: boolean): Promise<void>
    clear(deleteFiles?: boolean): Promise<void>
    reveal(id: string): Promise<void>
    open(id: string): Promise<void>
  }
  local: {
    scan(): Promise<LocalTrack[]>
    list(): Promise<LocalTrack[]>
    pickFolder(): Promise<string[]>
    removeFolder(folder: string): Promise<string[]>
    removeTrack(id: number): Promise<void>
    clear(): Promise<void>
    saveLyric(trackId: number, lyric: string): Promise<string | null>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    selectFolder(): Promise<string | null>
    cacheSize(): Promise<CacheSize>
    clearCache(): Promise<void>
    setAutoLaunch(enabled: boolean): Promise<boolean>
    setShortcuts(enabled: boolean): Promise<boolean>
    /** 本地文件的播放地址；每次调用都按当前协议规则生成，避免用到历史遗留的旧地址 */
    localUrl(path: string): Promise<string>
  }
  player: {
    sync(payload: PlayerSyncPayload): void
  }
  /** 主进程环境变量带过来的调试开关（渲染进程没有 process，只能从这里读） */
  debug: {
    /** NCM_LYRIC_DEBUG=1 时打开歌词/读词器诊断输出 */
    lyric: boolean
  }
  on<T = unknown>(channel: string, listener: (payload: T) => void): () => void
}
