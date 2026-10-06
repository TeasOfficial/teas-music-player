import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain, shell } from 'electron'
import { IPC, IPC_EVENT } from '@shared/ipc'
import type { CacheSize, DownloadStartParams, WindowState } from '@shared/ipc'
import type {
  AppInfo,
  AuthState,
  DownloadTask,
  LocalTrack,
  NcmApiResponse,
  PlayerSyncPayload,
  Settings,
} from '@shared/types'
import { logger } from './logger'
import { appPaths, invalidatePaths } from './paths'
import { toLocalUrl } from './protocol'
import { settings, session } from './store'
import { bootstrapApi, getModuleNames, getStatus } from './api/loader'
import {
  ensureApiReady,
  getSetupProgress,
  onSetupProgress,
} from './api/loader'
import { callApi } from './api/invoke'
import {
  getAuthState,
  importCookie,
  logout,
  qrCheck,
  qrCreate,
  refreshLogin,
} from './api/auth'
import {
  applyLyricLock,
  broadcast,
  closeLyricWindow,
  createLyricWindow,
  getWindowState,
  pushWindowState,
  relayPlayerSync,
  windows,
} from './windows'
import { updateTrayPlayback } from './tray'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import {
  cancelDownload,
  clearDownloads,
  listDownloads,
  openDownload,
  removeDownload,
  revealDownload,
  startDownload,
} from './download'
import {
  clearLocalTracks,
  listLocalTracks,
  pickLocalFolder,
  removeLocalFolder,
  removeLocalTrack,
  saveLocalLyric,
  scanLocalMusic,
} from './localMusic'

function requireMainWindow(): Electron.BrowserWindow {
  const win = windows.main
  if (!win || win.isDestroyed()) throw new Error('主窗口不可用')
  return win
}

/** 安装进度广播只订阅一次（registerIpcHandlers 可能被重复调用） */
let setupProgressBound = false

async function dirSize(dir: string): Promise<CacheSize> {
  let bytes = 0
  let files = 0
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(full)
          bytes += stat.size
          files += 1
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  if (fs.existsSync(dir)) await walk(dir, 0)
  return { bytes, files }
}

async function clearDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) return
  for (const entry of await fs.promises.readdir(dir)) {
    const full = path.join(dir, entry)
    try {
      await fs.promises.rm(full, { recursive: true, force: true })
    } catch (error) {
      logger.warn('清理缓存失败:', full, error)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 注册                                                                */
/* ------------------------------------------------------------------ */

export function registerIpcHandlers(): void {
  const handle = <T>(
    channel: string,
    fn: (...args: never[]) => T | Promise<T>,
  ): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await (fn as (...a: unknown[]) => T | Promise<T>)(...args)
      } catch (error) {
        logger.error(`IPC ${channel} 处理失败:`, error)
        throw error instanceof Error ? error : new Error(String(error))
      }
    })
  }

  /* ---------------- API ---------------- */
  handle(IPC.ApiCall, (name: string, params: Record<string, unknown>) =>
    callApi(name, params ?? {}),
  )
  handle(IPC.ApiModules, () => getModuleNames())
  handle(IPC.ApiStatus, () => getStatus())
  handle(IPC.ApiBootstrap, () => bootstrapApi())
  // 界面挂载后先补一次当前进度，再靠事件跟增量（避免错过早期事件）
  handle(IPC.ApiSetupProgress, () => getSetupProgress())
  handle(IPC.ApiRetrySetup, async () => {
    const result = await ensureApiReady()
    if (!result.ok) {
      const status = getStatus()
      return {
        ...status,
        ready: false,
        bootstrapError: result.error ?? status.bootstrapError,
      }
    }
    return bootstrapApi(true)
  })

  // 安装进度实时广播（只订阅一次，避免重复注册）
  if (!setupProgressBound) {
    setupProgressBound = true
    onSetupProgress((progress) =>
      broadcast(IPC_EVENT.ApiSetupProgress, progress),
    )
  }

  /* ---------------- 认证 ---------------- */
  handle(IPC.AuthQrCreate, () => qrCreate())
  handle(IPC.AuthQrCheck, (key: string) => qrCheck(key))
  handle(IPC.AuthState, (verify?: boolean) => getAuthState(!!verify))
  handle(IPC.AuthLogout, async (): Promise<void> => {
    await logout()
    pushWindowState()
  })
  handle(IPC.AuthImportCookie, (cookie: string) => importCookie(cookie))
  handle(IPC.AuthRefresh, () => refreshLogin())

  /* ---------------- 配置 ---------------- */
  handle(IPC.ConfigAll, () => settings.all())
  handle(IPC.ConfigGet, (key: keyof Settings) => settings.get(key))
  handle(IPC.ConfigSet, (key: keyof Settings, value: unknown): Settings => {
    const next = settings.set(key, value as never)
    if (key === 'downloadDir') invalidatePaths()
    if (key === 'lyricLocked') applyLyricLock(!!value)
    if (key === 'globalShortcut') {
      if (value) registerGlobalShortcuts()
      else unregisterGlobalShortcuts()
    }
    if (key === 'autoLaunch') {
      app.setLoginItemSettings({ openAtLogin: !!value, args: ['--hidden'] })
    }
    return next
  })
  handle(IPC.ConfigReset, (): Settings => {
    const next = settings.reset()
    invalidatePaths()
    return next
  })

  /* ---------------- 窗口 ---------------- */
  handle(IPC.WinMinimize, (): void => {
    requireMainWindow().minimize()
  })
  handle(IPC.WinMaximize, (): void => {
    const win = requireMainWindow()
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle(IPC.WinClose, (): void => {
    requireMainWindow().close()
  })
  handle(IPC.WinHide, (): void => {
    requireMainWindow().hide()
  })
  handle(IPC.WinShow, (): void => {
    const win = requireMainWindow()
    win.show()
    win.focus()
  })
  handle(IPC.WinState, (): WindowState => getWindowState())
  handle(IPC.WinSetLyric, (open: boolean): WindowState => {
    if (open) createLyricWindow()
    else closeLyricWindow()
    return getWindowState()
  })
  handle(IPC.WinSetLyricLock, (locked: boolean): WindowState => {
    settings.set('lyricLocked', !!locked)
    applyLyricLock(!!locked)
    return getWindowState()
  })
  handle(IPC.WinShowLyricMenu, (): void => {
    pushWindowState()
  })

  /* ---------------- 下载 ---------------- */
  handle(IPC.DownloadStart, (params: DownloadStartParams): DownloadTask =>
    startDownload(params.song, params.level),
  )
  handle(IPC.DownloadCancel, (id: string): void => cancelDownload(id))
  handle(IPC.DownloadList, (): DownloadTask[] => listDownloads())
  handle(IPC.DownloadRemove, (id: string, deleteFile?: boolean): void =>
    removeDownload(id, !!deleteFile),
  )
  handle(IPC.DownloadClear, (deleteFiles?: boolean): void =>
    clearDownloads(!!deleteFiles),
  )
  handle(IPC.DownloadReveal, (id: string): void => revealDownload(id))
  handle(IPC.DownloadOpen, (id: string) => openDownload(id))

  /* ---------------- 本地音乐 ---------------- */
  handle(IPC.LocalScan, (): Promise<LocalTrack[]> => scanLocalMusic())
  handle(IPC.LocalList, (): LocalTrack[] => listLocalTracks())
  handle(IPC.LocalPickFolder, (): Promise<string[]> => pickLocalFolder())
  handle(IPC.LocalRemoveFolder, (folder: string): string[] =>
    removeLocalFolder(folder),
  )
  handle(IPC.LocalRemoveTrack, (id: number): void => removeLocalTrack(id))
  handle(IPC.LocalClear, (): void => clearLocalTracks())
  handle(IPC.LocalSaveLyric, (trackId: number, lyric: string): string | null =>
    saveLocalLyric(trackId, lyric),
  )

  /* ---------------- 应用 ---------------- */
  handle(IPC.AppInfo, (): AppInfo => {
    const paths = appPaths()
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
      apiRoot: getStatus().apiRoot,
      paths,
      dev: !!process.env.ELECTRON_RENDERER_URL,
    }
  })
  handle(IPC.AppOpenExternal, async (url: string): Promise<void> => {
    if (!/^https?:/i.test(url)) throw new Error('仅允许打开 http/https 链接')
    await shell.openExternal(url)
  })
  handle(IPC.AppOpenPath, async (target: string): Promise<void> => {
    await shell.openPath(target)
  })
  handle(IPC.AppSelectFolder, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(requireMainWindow(), {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled || result.filePaths.length === 0
      ? null
      : result.filePaths[0]
  })
  handle(IPC.AppCacheSize, async (): Promise<CacheSize> => {
    const paths = appPaths()
    const a = await dirSize(paths.localCoverCache)
    const b = await dirSize(path.join(paths.cache, 'audio'))
    return { bytes: a.bytes + b.bytes, files: a.files + b.files }
  })
  handle(IPC.AppClearCache, async (): Promise<void> => {
    const paths = appPaths()
    await clearDir(paths.localCoverCache)
    await clearDir(path.join(paths.cache, 'audio'))
  })
  handle(IPC.AppSetAutoLaunch, (enabled: boolean): boolean => {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
    settings.set('autoLaunch', enabled)
    return app.getLoginItemSettings().openAtLogin
  })
  handle(IPC.AppLocalUrl, (target: string): string => toLocalUrl(target))
  handle(IPC.AppSetShortcuts, (enabled: boolean): boolean => {
    settings.set('globalShortcut', enabled)
    if (enabled) return registerGlobalShortcuts()
    unregisterGlobalShortcuts()
    return false
  })

  /* ---------------- 播放器同步（fire-and-forget） ---------------- */
  // 播放状态每秒回传 4 次，只在「播放/暂停」或「换歌」时落一条日志，
  // 既方便排查，也不会把日志刷爆。
  let lastPlaybackKey = ''
  ipcMain.on(IPC.PlayerSync, (_event, payload: PlayerSyncPayload) => {
    relayPlayerSync(payload)
    updateTrayPlayback({
      playing: payload.playing,
      songName: payload.songName,
      artistName: payload.artistName,
    })

    const key = `${payload.playing}|${payload.songName}|${payload.duration}`
    if (key !== lastPlaybackKey) {
      lastPlaybackKey = key
      logger.info(
        payload.songName
          ? `播放状态：${payload.playing ? '播放中' : '已暂停'} · ${payload.songName}${
              payload.artistName ? ' - ' + payload.artistName : ''
            }${payload.duration ? ` · ${Math.round(payload.duration / 1000)}s` : ''}`
          : '播放状态：空闲',
      )
    }
  })

  logger.info('IPC 通道注册完成')
}
