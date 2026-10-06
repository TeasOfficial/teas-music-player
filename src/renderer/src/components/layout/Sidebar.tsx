import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useAppNavigate } from '@/lib/navigation'
import type { Playlist } from '@shared/types'
import { AppLink } from '@/components/ui/AppLink'
import { Icon } from '@/components/ui/Icon'
import { Cover } from '@/components/ui/Primitives'
import { openContextMenu } from '@/components/ui/ContextMenu'
import { LIBRARY_NAV, PRIMARY_NAV } from '@/lib/constants'
import { api, invalidateCache } from '@/lib/api'
import { imageUrl } from '@/lib/format'
import { useAuthStore } from '@/store/auth'
import { useDownloadStore } from '@/store/download'
import { useLocalStore } from '@/store/local'
import { toast } from '@/store/toast'

const COLLAPSED_KEY = 'ncm.sidebarCollapsed'

export function Sidebar(): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const profile = useAuthStore((state) => state.profile)
  const downloadCount = useDownloadStore(
    (state) =>
      state.tasks.filter((task) => task.status === 'downloading').length,
  )
  const localCount = useLocalStore((state) => state.tracks.length)

  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(COLLAPSED_KEY) === '1',
  )
  const [playlists, setPlaylists] = useState<Playlist[]>([])

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    if (!loggedIn || !profile) {
      setPlaylists([])
      return
    }
    let cancelled = false
    api<{ playlist?: Playlist[] }>('user_playlist', {
      uid: profile.userId,
      limit: 1000,
      offset: 0,
    })
      .then((body) => {
        if (!cancelled) setPlaylists(body.playlist ?? [])
      })
      .catch(() => {
        if (!cancelled) setPlaylists([])
      })
    return () => {
      cancelled = true
    }
  }, [loggedIn, profile?.userId])

  const created = playlists.filter(
    (item) => item.userId === profile?.userId && item.specialType !== 5,
  )
  const subscribed = playlists.filter((item) => item.userId !== profile?.userId)

  const createPlaylist = async (): Promise<void> => {
    try {
      await api('playlist_create', {
        name: `我创建的歌单 ${new Date().toLocaleDateString()}`,
      })
      invalidateCache('user_playlist')
      if (profile) {
        const body = await api<{ playlist?: Playlist[] }>('user_playlist', {
          uid: profile.userId,
          limit: 1000,
          offset: 0,
        })
        setPlaylists(body.playlist ?? [])
      }
      toast.success('歌单已创建')
    } catch (error) {
      toast.fromError(error, '创建歌单失败')
    }
  }

  return (
    <aside className={clsx('sidebar', collapsed && 'sidebar-collapsed')}>
      {/* 应用标识：窗口左上角、标题栏正下方；侧边栏收起时只留徽标 */}
      <div className="sidebar-brand" title="Teas Music Player">
        <span className="sidebar-brand-mark">
          <Icon name="music" size={15} />
        </span>
        <span className="sidebar-brand-text">Teas Music Player</span>
      </div>

      <nav className="sidebar-nav scroll-y">
        <div className="sidebar-group">
          {PRIMARY_NAV.map((item) => (
            <AppLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx('sidebar-link', isActive && 'sidebar-link-active')
              }
            >
              <Icon name={item.icon} size={17} />
              <span className="sidebar-link-label">{item.label}</span>
            </AppLink>
          ))}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-title">我的音乐</div>
          {LIBRARY_NAV.filter((item) => !item.auth || loggedIn).map((item) => (
            <AppLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx('sidebar-link', isActive && 'sidebar-link-active')
              }
            >
              <Icon name={item.icon} size={17} />
              <span className="sidebar-link-label">{item.label}</span>
              {item.to === '/local' && localCount > 0 && (
                <span className="sidebar-count">{localCount}</span>
              )}
              {item.to === '/downloads' && downloadCount > 0 && (
                <span className="sidebar-count sidebar-count-active">
                  {downloadCount}
                </span>
              )}
            </AppLink>
          ))}
        </div>

        {loggedIn && (
          <>
            <div className="sidebar-group">
              <div className="sidebar-group-title">
                <span>创建的歌单</span>
                <button
                  type="button"
                  className="icon-btn"
                  title="新建歌单"
                  onClick={() => void createPlaylist()}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {created.length === 0 && (
                <div className="sidebar-hint">还没有创建的歌单</div>
              )}
              {created.map((playlist) => (
                <PlaylistLink
                  key={playlist.id}
                  playlist={playlist}
                  onContext={(event) =>
                    openContextMenu(event, [
                      {
                        key: 'open',
                        label: '打开歌单',
                        icon: 'chevron-right',
                        onClick: () => navigate(`/playlist/${playlist.id}`),
                      },
                      {
                        key: 'copy',
                        label: '复制歌单链接',
                        icon: 'share',
                        onClick: () => {
                          void navigator.clipboard.writeText(
                            `https://music.163.com/#/playlist?id=${playlist.id}`,
                          )
                          toast.success('链接已复制')
                        },
                      },
                    ])
                  }
                />
              ))}
            </div>

            {subscribed.length > 0 && (
              <div className="sidebar-group">
                <div className="sidebar-group-title">收藏的歌单</div>
                {subscribed.map((playlist) => (
                  <PlaylistLink key={playlist.id} playlist={playlist} />
                ))}
              </div>
            )}
          </>
        )}
      </nav>

      <button
        type="button"
        className="sidebar-toggle"
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        onClick={() => setCollapsed((value) => !value)}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={15} />
      </button>
    </aside>
  )
}

function PlaylistLink({
  playlist,
  onContext,
}: {
  playlist: Playlist
  onContext?: (event: React.MouseEvent) => void
}): ReactNode {
  return (
    <AppLink
      to={`/playlist/${playlist.id}`}
      className={({ isActive }) =>
        clsx(
          'sidebar-link sidebar-link-playlist',
          isActive && 'sidebar-link-active',
        )
      }
      onContextMenu={onContext}
      title={playlist.name}
    >
      {playlist.id === 0 ? (
        <span className="sidebar-playlist-icon">
          <Icon name="heart-filled" size={15} />
        </span>
      ) : (
        <Cover src={imageUrl(playlist.coverImgUrl, 60)} size={20} radius={4} />
      )}
      <span className="sidebar-link-label ellipsis">{playlist.name}</span>
    </AppLink>
  )
}
