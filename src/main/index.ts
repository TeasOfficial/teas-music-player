// 必须在最前面：它负责设置应用名并把旧的 userData 迁移到新目录，
// 且要早于 store / paths 等任何会解析 userData 的模块（详见 branding.ts）
import './branding'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IPC_EVENT } from '@shared/ipc'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { bootstrapApi } from './api/loader'
import { callApi } from './api/invoke'
import { getAuthState } from './api/auth'
import { loadDownloads } from './download'
import { registerIpcHandlers } from './ipc'
import { loadLocalTracks } from './localMusic'
import { logger } from './logger'
import { appPaths } from './paths'
import { handleLocalScheme, registerLocalScheme, toLocalUrl } from './protocol'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import { settings } from './store'
import { createTray, destroyTray } from './tray'
import {
  broadcast,
  createLyricWindow,
  createMainWindow,
  windows,
} from './windows'

/** 标记「用户真的要退出」，用于区分关闭窗口时的最小化到托盘 */
const flags = globalThis as { appQuitting?: boolean }

/**
 * 无人值守自检（NCM_SMOKE=1）：
 * 在真实 Electron 环境里验证「加载 API 源码 → 调用接口 → 落盘」整条链路，
 * 结果写入日志后自动退出，供 CI / 开发者手工验证使用。
 */
async function runSmokeTest(ready: boolean): Promise<void> {
  try {
    logger.info(`[SMOKE] API ready=${ready}`)
    if (!ready) throw new Error('API 未就绪')

    const search = await callApi<{
      result?: { songs?: Array<{ id: number; name: string }> }
    }>('cloudsearch', { keywords: '海阔天空', type: 1, limit: 3 })
    const song = search.body?.result?.songs?.[0]
    logger.info(
      `[SMOKE] cloudsearch ok=${search.ok} 命中=${search.body?.result?.songs?.length ?? 0}`,
    )
    if (!song) throw new Error('搜索无结果')

    const url = await callApi<{ data?: Array<{ url?: string }> }>(
      'song_url_v1',
      {
        id: song.id,
        level: 'exhigh',
      },
    )
    logger.info(
      `[SMOKE] song_url_v1 ok=${url.ok} 有播放地址=${!!url.body?.data?.[0]?.url}`,
    )

    const lyric = await callApi<{
      lrc?: { lyric?: string }
      yrc?: { lyric?: string }
    }>('lyric_new', {
      id: song.id,
    })
    logger.info(
      `[SMOKE] lyric_new ok=${lyric.ok} lrc=${!!lyric.body?.lrc?.lyric} yrc=${!!lyric.body?.yrc?.lyric}`,
    )

    const localUrl = toLocalUrl(path.join(appPaths().userData, 'settings.json'))
    logger.info(`[SMOKE] 自定义协议 url=${localUrl}`)

    logger.info('[SMOKE] 全部通过')
  } catch (error) {
    logger.error('[SMOKE] 失败:', error)
    process.exitCode = 1
  } finally {
    flags.appQuitting = true
    app.quit()
  }
}

// 单实例：第二次启动时激活已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = windows.main
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // 开机自启时以隐藏方式启动，只留托盘
  const launchedHidden = process.argv.includes('--hidden')

  // 允许无用户手势直接播放（恢复上次播放状态需要）
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  // 关闭默认的渲染进程节流，避免后台时播放进度/歌词同步被降频
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')

  registerLocalScheme()

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.teas.musicplayer')

    // 渲染进程注册好后立刻挂上协议处理函数
    handleLocalScheme()

    logger.info('='.repeat(60))
    logger.info(
      `应用启动 v${app.getVersion()}，Electron ${process.versions.electron}`,
    )
    logger.info('数据目录:', appPaths().userData)

    // 本地缓存数据先恢复，UI 首屏即可展示历史记录
    loadDownloads()
    loadLocalTracks()

    registerIpcHandlers()

    // 设置变更（无论来自渲染层、托盘还是歌词窗口）统一广播，保证单一数据源
    settings.onChange((next) => broadcast(IPC_EVENT.ConfigChanged, next))

    // 自检模式不创建任何窗口/托盘，避免在用户桌面上闪一下
    if (process.env.NCM_SMOKE) {
      logger.info('自检模式：跳过窗口与托盘创建')
    } else {
      createMainWindow()
      createTray()

      if (!settings.get('globalShortcut')) unregisterGlobalShortcuts()
      else registerGlobalShortcuts()

      if (settings.get('desktopLyric')) createLyricWindow()

      // 开机自启的隐藏启动：创建完窗口后立刻藏起来
      if (launchedHidden && settings.get('minimizeToTray')) {
        windows.main?.hide()
      }
    }

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window, { escToCloseWindow: false })
    })

    // 这两个都比较慢，放后台跑，不阻塞窗口展示
    void (async () => {
      const status = await bootstrapApi()
      logger.info('API 引导结束:', status)
      if (process.env.NCM_SMOKE) {
        await runSmokeTest(status.ready)
        return
      }
      await getAuthState(true)
    })()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else windows.main?.show()
  })

  app.on('window-all-closed', () => {
    // 有托盘时不随窗口关闭退出（除非用户明确退出）
    if (flags.appQuitting || !settings.get('minimizeToTray')) {
      app.quit()
      return
    }
    if (process.platform !== 'darwin') {
      // 主窗口被关闭但托盘仍在，保持后台常驻
      logger.info('主窗口已关闭，应用继续驻留托盘')
    }
  })

  app.on('before-quit', () => {
    flags.appQuitting = true
    unregisterGlobalShortcuts()
  })

  app.on('will-quit', () => {
    destroyTray()
  })

  // 主进程未捕获异常不应静默吞掉
  process.on('uncaughtException', (error) => {
    logger.error('主进程未捕获异常:', error)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('主进程未处理的 Promise 拒绝:', reason)
  })

  if (is.dev) {
    logger.info('开发模式启动')
  }
}
