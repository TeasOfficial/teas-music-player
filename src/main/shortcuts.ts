import { globalShortcut } from 'electron'
import type { PlayerCommand } from '@shared/types'
import { logger } from './logger'
import { sendToMain } from './windows'

/**
 * 注册的快捷键表。
 * 说明：媒体键（MediaPlayPause 等）在 Windows 上属于系统级按键，注册后
 * 即便应用在后台也能响应；自定义组合键作为备选。
 */
const ACCELERATORS: Array<{ accelerator: string; command: PlayerCommand }> = [
  { accelerator: 'MediaPlayPause', command: 'toggle' },
  { accelerator: 'MediaNextTrack', command: 'next' },
  { accelerator: 'MediaPreviousTrack', command: 'prev' },
  { accelerator: 'MediaStop', command: 'toggle' },
  { accelerator: 'CommandOrControl+Alt+Space', command: 'toggle' },
  { accelerator: 'CommandOrControl+Alt+Right', command: 'next' },
  { accelerator: 'CommandOrControl+Alt+Left', command: 'prev' },
  { accelerator: 'CommandOrControl+Alt+Up', command: 'volume-up' },
  { accelerator: 'CommandOrControl+Alt+Down', command: 'volume-down' },
  { accelerator: 'CommandOrControl+Alt+L', command: 'toggle-like' },
  { accelerator: 'CommandOrControl+Alt+D', command: 'toggle-desktop-lyric' },
]

let registered = false

export function registerGlobalShortcuts(): boolean {
  if (registered) return true
  let ok = 0
  for (const { accelerator, command } of ACCELERATORS) {
    try {
      // 已被其它程序占用的键会返回 false，静默跳过即可
      if (
        globalShortcut.register(accelerator, () =>
          sendToMain('evt:player-command', command),
        )
      ) {
        ok += 1
      } else {
        logger.warn('全局快捷键被占用，跳过:', accelerator)
      }
    } catch (error) {
      logger.warn('注册全局快捷键异常:', accelerator, error)
    }
  }
  registered = true
  logger.info(`全局快捷键注册完成：${ok}/${ACCELERATORS.length}`)
  return ok > 0
}

export function unregisterGlobalShortcuts(): void {
  if (!registered) return
  globalShortcut.unregisterAll()
  registered = false
  logger.info('全局快捷键已注销')
}

export function isShortcutRegistered(): boolean {
  return registered
}
