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
import type { PlayerCommand, Settings } from '@shared/types'
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

function useBootstrap(): { ready: boolean; error: string } {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      // 1) 设置（决定主题、音量、音质）
      await useSettingsStore.getState().load()
      // 2) 主进程 API 引导（加载 4xx 个接口，首次约 2 秒）
      const status = await window.ncm.api.bootstrap()
      if (cancelled) return
      if (!status.ready) {
        setError(status.bootstrapError ?? 'API 初始化失败')
        return
      }
      // 3) 并行加载各类本地数据
      // 关窗前把播放状态刷盘，避免刚好落在防抖窗口里丢掉最后一段进度
      bindQuitFlush()
      await Promise.all([
        usePlayerStore.getState().init(),
        useDownloadStore.getState().init(),
        useLocalStore.getState().init(),
        useAuthStore.getState().check(true),
      ])
      if (cancelled) return

      // 4) 登录后拉取收藏列表
      if (useAuthStore.getState().loggedIn)
        void usePlayerStore.getState().loadLiked()
      setReady(true)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return { ready, error }
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

function ApiErrorScreen({ message }: { message: string }): ReactNode {
  return (
    <div className="boot-screen">
      <Icon name="info" size={40} />
      <h2 className="f-20">{message}</h2>
      <p className="muted f-12 boot-hint">
        请确认本机已安装 API 依赖（在仓库根目录执行 <code>pnpm install</code>
        ），
        <br />
        或设置环境变量 <code>NCM_API_ROOT</code> 指向
        NeteaseCloudMusicApiEnhanced 源码目录后重启应用。
      </p>
    </div>
  )
}

function BootScreen(): ReactNode {
  return (
    <div className="boot-screen">
      <Icon name="loading" size={30} className="spin" />
      <span className="f-14 text-2">正在初始化音乐接口…</span>
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
  const { ready, error } = useBootstrap()
  const mainRef = useRef<HTMLElement | null>(null)
  useMainProcessEvents()
  useKeyboardShortcuts()

  if (error) return <ApiErrorScreen message={error} />
  if (!ready) return <BootScreen />

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
