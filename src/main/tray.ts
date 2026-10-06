import fs from 'node:fs'
import path from 'node:path'
import { Tray, Menu, app, nativeImage } from 'electron'
import type { PlayerCommand } from '@shared/types'
import { logger } from './logger'
import { settings } from './store'
import { pushWindowState, sendToMain, windows } from './windows'

let tray: Tray | null = null
/** 由渲染层同步过来的播放状态，用于托盘提示与菜单文案 */
let nowPlaying = { playing: false, songName: '', artistName: '' }

function resourceFile(name: string): string {
  const packaged = path.join(process.resourcesPath, 'resources', name)
  if (fs.existsSync(packaged)) return packaged
  return path.join(__dirname, '..', '..', 'resources', name)
}

function send(command: PlayerCommand): void {
  sendToMain('evt:player-command', command)
}

function showMainWindow(): void {
  const win = windows.main
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  pushWindowState()
}

function buildMenu(): Menu {
  const label = nowPlaying.songName
    ? `${nowPlaying.songName}${nowPlaying.artistName ? ' - ' + nowPlaying.artistName : ''}`
    : '未在播放'

  return Menu.buildFromTemplate([
    { label: truncate(label, 48), enabled: false },
    { type: 'separator' },
    {
      label: nowPlaying.playing ? '暂停' : '播放',
      click: () => send('toggle'),
    },
    { label: '上一首', click: () => send('prev') },
    { label: '下一首', click: () => send('next') },
    { type: 'separator' },
    { label: '显示主窗口', click: showMainWindow },
    {
      label: '桌面歌词',
      type: 'checkbox',
      checked: settings.get('desktopLyric'),
      click: () => send('toggle-desktop-lyric'),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        ;(globalThis as { appQuitting?: boolean }).appQuitting = true
        app.quit()
      },
    },
  ])
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function refresh(): void {
  if (!tray) return
  tray.setToolTip(
    nowPlaying.songName
      ? `Teas Music Player · ${nowPlaying.songName}${nowPlaying.artistName ? ' - ' + nowPlaying.artistName : ''}`
      : 'Teas Music Player',
  )
  tray.setContextMenu(buildMenu())
}

export function createTray(): void {
  if (tray) return
  const iconPath = resourceFile('tray.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    logger.warn('托盘图标缺失:', iconPath)
    image = nativeImage.createEmpty()
  }
  tray = new Tray(image)
  tray.on('click', () => {
    const win = windows.main
    if (win && win.isVisible() && !win.isMinimized()) win.hide()
    else showMainWindow()
  })
  tray.on('double-click', showMainWindow)
  refresh()
}

export function updateTrayPlayback(state: {
  playing: boolean
  songName: string
  artistName: string
}): void {
  nowPlaying = state
  refresh()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
