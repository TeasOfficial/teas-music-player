import path from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { PlayerSyncPayload, Settings } from '@shared/types'
import type { WindowState } from '@shared/ipc'
import { IPC_EVENT } from '@shared/ipc'
import { logger } from './logger'
import { settings } from './store'

export const windows: {
  main: BrowserWindow | null
  lyric: BrowserWindow | null
} = { main: null, lyric: null }

function rendererTarget(page: 'index' | 'lyric'): {
  type: 'url' | 'file'
  target: string
} {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) return { type: 'url', target: `${devUrl}/${page}.html` }
  return {
    type: 'file',
    target: path.join(__dirname, '../renderer/' + page + '.html'),
  }
}

function load(win: BrowserWindow, page: 'index' | 'lyric'): void {
  const { type, target } = rendererTarget(page)
  if (type === 'url') void win.loadURL(target)
  else void win.loadFile(target)
}

/** 统一收集窗口状态，供渲染层同步 UI */
export function getWindowState(): WindowState {
  const win = windows.main
  return {
    maximized: win?.isMaximized() ?? false,
    minimized: win?.isMinimized() ?? false,
    focused: win?.isFocused() ?? false,
    lyricOpen: !!windows.lyric && !windows.lyric.isDestroyed(),
    lyricLocked: settings.get('lyricLocked'),
    fullScreen: win?.isFullScreen() ?? false,
  }
}

export function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function sendToMain(channel: string, payload?: unknown): void {
  const win = windows.main
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function sendToLyric(channel: string, payload?: unknown): void {
  const win = windows.lyric
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function pushWindowState(): void {
  broadcast(IPC_EVENT.WinState, getWindowState())
}

/* ------------------------------------------------------------------ */
/* 主窗口                                                              */
/* ------------------------------------------------------------------ */

export function createMainWindow(): BrowserWindow {
  const saved = settings.get('windowBounds')
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize

  const win = new BrowserWindow({
    width: Math.min(saved?.width ?? 1280, screenWidth),
    height: Math.min(saved?.height ?? 820, screenHeight),
    x: saved?.x,
    y: saved?.y,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0f1014',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition:
      process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // 播放本地音乐时需要读取 file:// 资源
      webviewTag: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('resize', () => saveBounds(win))
  win.on('move', () => saveBounds(win))

  win.on('maximize', pushWindowState)
  win.on('unmaximize', pushWindowState)
  win.on('minimize', pushWindowState)
  win.on('restore', pushWindowState)
  win.on('enter-full-screen', pushWindowState)
  win.on('leave-full-screen', pushWindowState)
  win.on('focus', pushWindowState)
  win.on('blur', pushWindowState)

  win.on('close', (event) => {
    if (
      !(globalThis as { appQuitting?: boolean }).appQuitting &&
      settings.get('minimizeToTray')
    ) {
      event.preventDefault()
      win.hide()
      pushWindowState()
    }
  })

  win.on('closed', () => {
    windows.main = null
  })

  // 外部链接一律交给系统浏览器，避免在应用内打开任意网页
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  attachDiagnostics(win)

  load(win, 'index')
  windows.main = win
  return win
}

function saveBounds(win: BrowserWindow): void {
  if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) return
  const b = win.getBounds()
  settings.set('windowBounds', {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
  })
}

/* ------------------------------------------------------------------ */
/* 桌面歌词窗口                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_LYRIC_SIZE = { width: 880, height: 170 }

export function createLyricWindow(): BrowserWindow {
  if (windows.lyric && !windows.lyric.isDestroyed()) {
    windows.lyric.show()
    return windows.lyric
  }

  const saved = settings.get('lyricPosition')
  const workArea = screen.getPrimaryDisplay().workArea

  const win = new BrowserWindow({
    width: saved?.width ?? DEFAULT_LYRIC_SIZE.width,
    height: saved?.height ?? DEFAULT_LYRIC_SIZE.height,
    x:
      saved?.x ??
      Math.round(workArea.x + (workArea.width - DEFAULT_LYRIC_SIZE.width) / 2),
    y:
      saved?.y ??
      Math.round(workArea.y + workArea.height - DEFAULT_LYRIC_SIZE.height - 80),
    minWidth: 360,
    minHeight: 110,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    show: false,
    fullscreenable: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.on('ready-to-show', () => {
    win.show()
    applyLyricLock(settings.get('lyricLocked'))
  })

  win.on('moved', () => {
    const b = win.getBounds()
    settings.set('lyricPosition', {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    })
  })
  win.on('resized', () => {
    const b = win.getBounds()
    settings.set('lyricPosition', {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    })
  })

  win.on('closed', () => {
    windows.lyric = null
    settings.set('desktopLyric', false)
    pushWindowState()
  })

  attachDiagnostics(win)
  load(win, 'lyric')
  windows.lyric = win
  settings.set('desktopLyric', true)
  pushWindowState()
  return win
}

export function closeLyricWindow(): void {
  if (windows.lyric && !windows.lyric.isDestroyed()) windows.lyric.close()
  windows.lyric = null
  settings.set('desktopLyric', false)
  pushWindowState()
}

/** 锁定后鼠标事件穿透到桌面，避免挡住其它应用 */
export function applyLyricLock(locked: boolean): void {
  const win = windows.lyric
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(locked, { forward: true })
  pushWindowState()
}

/** 把主窗口的播放状态转发给歌词窗口 */
export function relayPlayerSync(payload: PlayerSyncPayload): void {
  sendToLyric(IPC_EVENT.PlayerSync, payload)
}

export function getSettingsSnapshot(): Settings {
  return settings.all()
}

function logWindowError(scope: string, error: unknown): void {
  logger.error(`[${scope}]`, error)
}

/**
 * 把渲染进程的错误转发到主进程日志。
 * 桌面应用没有终端可看，渲染层报错必须落盘，否则只能靠开发者工具。
 */
function attachDiagnostics(win: BrowserWindow): void {
  // Electron 44 起 console-message 改为单参数 details 对象，这里两种形态都兼容
  win.webContents.on('console-message', (...args: unknown[]) => {
    const first = args[0] as {
      level?: number | string
      message?: string
      lineNumber?: number
      sourceId?: string
    }
    if (args.length === 1 && first && typeof first === 'object') {
      const level = String(first.level ?? '')
      const isError = level === 'error' || level === '3'
      const isWarning = level === 'warning' || level === '2'
      // 默认只记 warning/error；NCM_DEBUG=1 时把 info 级也落盘，便于排查
      if (!isError && !isWarning && !process.env.NCM_DEBUG) return
      const text = `[renderer] ${first.message ?? ''} (${first.sourceId ?? '?'}:${first.lineNumber ?? 0})`
      if (isError) logger.error(text)
      else if (isWarning) logger.warn(text)
      else logger.info(text)
      return
    }
    const [, level, message, line, sourceId] = args as [
      unknown,
      number,
      string,
      number,
      string,
    ]
    // 旧签名：0=verbose 1=info 2=warning 3=error
    const minLevel = process.env.NCM_DEBUG ? 1 : 2
    if (typeof level !== 'number' || level < minLevel) return
    const legacy = `[renderer] ${message} (${sourceId}:${line})`
    if (level >= 3) logger.error(legacy)
    else logger.info(legacy)
  })

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    logger.error(`页面加载失败 ${code} ${description} ${url}`)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('渲染进程退出:', details)
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error(`preload 执行失败 ${preloadPath}:`, error)
  })
}
