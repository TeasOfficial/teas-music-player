import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { IPC_EVENT } from '@shared/ipc'
import type { ApiProgress, PlayerCommand, Settings } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { ToastHost } from '@/components/ui/ToastHost'
import { ContextMenuHost } from '@/components/ui/ContextMenu'
import { TitleBar } from '@/components/layout/TitleBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { PlayerBar } from '@/components/player/PlayerBar'
import { QueuePanel } from '@/components/player/QueuePanel'
import { CommentDrawer } from '@/components/comment/CommentDrawer'
import { NowPlayingView } from '@/components/player/NowPlayingView'
import {
  selectCurrentSong,
  bindQuitFlush,
  usePlayerStore,
  syncPlayerSettings,
} from '@/store/player'
import { applyTheme, useSettingsStore } from '@/store/settings'
import { useDownloadStore } from '@/store/download'
import { useLocalStore } from '@/store/local'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'
import { imageUrl } from '@/lib/format'

import Discover from '@/pages/Discover'
import DailySongs from '@/pages/DailySongs'
import PlaylistDetail from '@/pages/PlaylistDetail'
import Likes from '@/pages/Likes'
import Recent from '@/pages/Recent'
import Cloud from '@/pages/Cloud'
import LocalMusic from '@/pages/LocalMusic'
import Downloads from '@/pages/Downloads'
import Search from '@/pages/Search'
import ArtistDetail from '@/pages/ArtistDetail'
import AlbumDetail from '@/pages/AlbumDetail'
import MvList from '@/pages/MvList'
import MvDetail from '@/pages/MvDetail'
import Podcast from '@/pages/Podcast'
import PodcastDetail from '@/pages/PodcastDetail'
import UserDetail from '@/pages/UserDetail'
import SettingsPage from '@/pages/Settings'
import Login from '@/pages/Login'

/* ------------------------------------------------------------------ */
/* 全局数据引导                                                        */
/* ------------------------------------------------------------------ */

function useBootstrap(): {
  ready: boolean
  error: string
  progress: ApiProgress
  retrying: boolean
  retry: () => void
} {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [progress, setProgress] = useState<ApiProgress>({
    phase: 'idle',
    message: '',
    ratio: 0,
    log: [],
  })

  // 安装进度：先补一次当前值，再跟增量事件。
  // （界面可能比安装流程晚挂载，只订阅事件会漏掉早期进度）
  useEffect(() => {
    let cancelled = false
    const off = window.ncm.on<ApiProgress>(
      IPC_EVENT.ApiSetupProgress,
      (next) => {
        if (!cancelled) setProgress(next)
      },
    )
    void window.ncm.api.setupProgress().then((current) => {
      if (!cancelled && current.phase !== 'idle') setProgress(current)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  /** 引导第二步之后的本地数据加载 */
  const loadLocalData = async (): Promise<void> => {
    bindQuitFlush()
    await Promise.all([
      usePlayerStore.getState().init(),
      useDownloadStore.getState().init(),
      useLocalStore.getState().init(),
      useAuthStore.getState().check(true),
    ])
    if (useAuthStore.getState().loggedIn)
      void usePlayerStore.getState().loadLiked()
    setReady(true)
  }

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      // 1) 设置（决定主题、音量、音质）
      await useSettingsStore.getState().load()
      // 2) 主进程 API 引导（首次启动会下载源码 + 依赖，约 20MB）
      const status = await window.ncm.api.bootstrap()
      if (cancelled) return
      if (!status.ready) {
        setError(status.bootstrapError ?? 'API 初始化失败')
        return
      }
      // 3) 并行加载各类本地数据
      // 关窗前把播放状态刷盘，避免刚好落在防抖窗口里丢掉最后一段进度
      await loadLocalData()
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = (): void => {
    if (retrying) return
    setRetrying(true)
    setError('')
    void (async () => {
      try {
        const status = await window.ncm.api.retrySetup()
        if (!status.ready) {
          setError(status.bootstrapError ?? '重试仍然失败')
          return
        }
        await loadLocalData()
      } catch (retryError) {
        setError(
          retryError instanceof Error ? retryError.message : '重试失败',
        )
      } finally {
        setRetrying(false)
      }
    })()
  }

  return { ready, error, progress, retrying, retry }
}

/** 主进程 → 渲染层的事件订阅 */
function useMainProcessEvents(): void {
  useEffect(() => {
    const offConfig = window.ncm.on<Settings>(
      IPC_EVENT.ConfigChanged,
      (settings) => {
        useSettingsStore.setState({ settings })
        applyTheme(settings.theme)
        syncPlayerSettings(settings)
      },
    )

    const offCommand = window.ncm.on<PlayerCommand>(
      IPC_EVENT.PlayerCommand,
      (command) => {
        usePlayerStore.getState().handleCommand(command)
      },
    )

    const offToast = window.ncm.on<{
      type: 'info' | 'success' | 'error'
      message: string
    }>(IPC_EVENT.Toast, (payload) => toast[payload.type](payload.message))

    const offAuth = window.ncm.on(IPC_EVENT.AuthChanged, () => {
      void useAuthStore.getState().check(true)
    })

    return () => {
      offConfig()
      offCommand()
      offToast()
      offAuth()
    }
  }, [])
}

/** 全局键盘快捷键（输入框内不生效） */
function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing) return

      const player = usePlayerStore.getState()

      if (event.code === 'Space') {
        event.preventDefault()
        player.toggle()
        return
      }
      if (event.key === 'Escape') {
        if (player.showNowPlaying) player.setShowNowPlaying(false)
        else if (player.showQueue) player.setShowQueue(false)
        return
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          player.seek(Math.min(player.duration, player.position + 5000))
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          player.seek(Math.max(0, player.position - 5000))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          player.setVolume(Math.min(1, player.volume + 0.05))
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          player.setVolume(Math.max(0, player.volume - 0.05))
        }
        return
      }
      if (event.key === 'ArrowRight' && event.altKey) void player.next(false)
      if (event.key === 'ArrowLeft' && event.altKey) void player.prev()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

/* ------------------------------------------------------------------ */
/* 骨架                                                                */
/* ------------------------------------------------------------------ */

/** 阶段 → 用户可读的阶段名 */
const SETUP_PHASE_LABEL: Record<ApiProgress['phase'], string> = {
  idle: '准备中',
  fetch: '下载音乐接口',
  deps: '准备接口依赖',
  verify: '校验与自检',
  ready: '即将完成',
  error: '安装失败',
}

function ApiErrorScreen({
  message,
  retrying,
  onRetry,
}: {
  message: string
  retrying: boolean
  onRetry: () => void
}): ReactNode {
  return (
    <div className="boot-screen">
      <Icon name="info" size={40} />
      <h2 className="f-20">音乐接口安装失败</h2>
      <div className="boot-error-box">{message}</div>
      <div className="row gap-8" style={{ marginTop: 4 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? '重试中…' : '重试'}
        </button>
      </div>
      <p className="muted f-12 boot-hint">
        首次启动需要联网从 npm 获取后端接口（源码约 12.8MB + 依赖预置包 8.2MB）。
        <br />
        <br />
        若本机无法访问外网，可以用环境变量 <code>NCM_API_ROOT</code>{' '}
        指向一份自备的 API 源码目录后重启；
        <br />
        没有依赖预置包时会回退到本机 npm 安装，因此也可以先装好 Node.js 再重试。
      </p>
    </div>
  )
}

/**
 * 启动/首次安装界面。
 * 首次启动要下载约 20MB（接口源码 + 依赖），这里显示阶段、进度条与实时日志，
 * 让用户清楚「在做什么、还要多久」，而不是干等一个转圈。
 */
function BootScreen({ progress }: { progress: ApiProgress }): ReactNode {
  const percent = Math.max(2, Math.round(progress.ratio * 100))
  const busy = progress.phase !== 'idle' && progress.phase !== 'ready'
  const recentLog = progress.log.slice(-4)

  return (
    <div className="boot-screen">
      <div className="boot-panel">
        <div className="boot-head">
          <Icon
            name={busy ? 'loading' : 'download'}
            size={22}
            className={busy ? 'spin' : undefined}
          />
          <div className="boot-head-text">
            <div className="f-15 bold boot-title">
              {progress.message || '正在初始化音乐接口…'}
            </div>
            {busy && (
              <div className="muted f-12">
                {SETUP_PHASE_LABEL[progress.phase]}
                {' · '}
                首次启动需要下载约 20MB，仅在第一次进行
              </div>
            )}
          </div>
          <span className="boot-percent f-12 muted">{percent}%</span>
        </div>

        <div
          className="boot-progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="boot-progress-fill" style={{ width: `${percent}%` }} />
        </div>

        {recentLog.length > 0 && (
          <div className="boot-log">
            {recentLog.map((line, index) => (
              <div key={`${index}-${line}`} className="boot-log-line">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 滚动容器在路由切换时回到顶部 */
function ScrollReset({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLElement | null>
}): null {
  const location = useLocation()
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 })
  }, [location.pathname, containerRef])
  return null
}

/**
 * 极光背景层：底部是缓慢流动的彩色渐变，上面叠一层当前封面的重度虚化。
 * 换歌时整块背景会跟着专辑封面变色（--cover-url），这是「我们的」客户端
 * 与网易云原版最直观的差别——原版的底色永远是那块死板的深灰。
 */
function AuroraBackdrop(): ReactNode {
  const song = usePlayerStore(selectCurrentSong)
  const cover = imageUrl(song?.al?.picUrl, 800)

  return (
    <div
      className="aurora"
      style={
        { '--cover-url': cover ? `url("${cover}")` : 'none' } as CSSProperties
      }
      aria-hidden
    >
      <div className="aurora-base" />
      <div className="aurora-cover" />
      <div className="aurora-veil" />
    </div>
  )
}

function Shell(): ReactNode {
  const { ready, error, progress, retrying, retry } = useBootstrap()
  const mainRef = useRef<HTMLElement | null>(null)
  useMainProcessEvents()
  useKeyboardShortcuts()

  if (error) {
    return (
      <ApiErrorScreen message={error} retrying={retrying} onRetry={retry} />
    )
  }
  if (!ready) return <BootScreen progress={progress} />

  return (
    <div className="app-shell">
      <AuroraBackdrop />
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main scroll-y" ref={mainRef}>
          <ScrollReset containerRef={mainRef} />
          <Routes>
            <Route path="/" element={<Navigate to="/discover" replace />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/daily" element={<DailySongs />} />
            <Route path="/playlist/:id" element={<PlaylistDetail />} />
            <Route path="/likes" element={<Likes />} />
            <Route path="/recent" element={<Recent />} />
            <Route path="/cloud" element={<Cloud />} />
            <Route path="/local" element={<LocalMusic />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/search" element={<Search />} />
            <Route path="/artist/:id" element={<ArtistDetail />} />
            <Route path="/album/:id" element={<AlbumDetail />} />
            <Route path="/mv" element={<MvList />} />
            <Route path="/mv/:id" element={<MvDetail />} />
            <Route path="/podcast" element={<Podcast />} />
            <Route path="/podcast/:id" element={<PodcastDetail />} />
            <Route path="/user/:id" element={<UserDetail />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/discover" replace />} />
          </Routes>
        </main>
      </div>
      <PlayerBar />
      <QueuePanel />
      <CommentDrawer />
      <NowPlayingView />
    </div>
  )
}

export default function App(): ReactNode {
  return (
    <HashRouter>
      <Shell />
      <ToastHost />
      <ContextMenuHost />
    </HashRouter>
  )
}
