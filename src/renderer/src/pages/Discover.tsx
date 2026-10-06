import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import type { Mv, Playlist, Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Cover, Loading, SectionHeader } from '@/components/ui/Primitives'
import { GridContainer, MvCard, PlaylistCard } from '@/components/cards'
import { SongTable } from '@/components/song/SongTable'
import { useAsync } from '@/lib/hooks'
import { api } from '@/lib/api'
import { normalizeSongs } from '@/lib/normalize'
import { imageUrl } from '@/lib/format'
import { usePlayerStore } from '@/store/player'
import { useAuthStore } from '@/store/auth'

interface BannerItem {
  imageUrl: string
  targetId: number
  targetType: number
  typeTitle?: string
  url?: string
  titleColor?: string
}

interface TopListEntry {
  id: number
  name: string
  coverImgUrl: string
  updateFrequency?: string
  trackCount?: number
  tracks?: Song[]
}

export default function Discover(): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const playSongs = usePlayerStore((state) => state.playSongs)

  const { data: banners } = useAsync(async () => {
    const body = await api<{ banners?: BannerItem[] }>('banner', { type: 0 })
    return (body.banners ?? []).filter((item) => item.imageUrl)
  }, [])

  const { data: recommendPlaylists, loading: loadingPlaylists } =
    useAsync(async () => {
      const body = await api<{ result?: Playlist[] }>('personalized', {
        limit: 12,
      })
      return body.result ?? []
    }, [])

  const { data: newSongs, loading: loadingSongs } = useAsync(async () => {
    // personalized_newsong 返回的是 [{ song: {...} }]，内层还是 artists/album/duration 老字段
    const body = await api<{ result?: unknown[] }>('personalized_newsong', {
      limit: 12,
    })
    return normalizeSongs(body.result)
  }, [])

  const { data: recommendMvs } = useAsync(async () => {
    const body = await api<{ result?: Mv[] }>('personalized_mv', { limit: 6 })
    return body.result ?? []
  }, [])

  const { data: toplists } = useAsync(async () => {
    const body = await api<{ list?: TopListEntry[] }>('toplist', {})
    const lists = (body.list ?? []).slice(0, 5)
    // toplist 返回的 tracks 恒为 null，前三首必须单独取，否则榜单区块只有封面没歌
    return Promise.all(
      lists.map(async (list) => {
        if (list.tracks && list.tracks.length > 0) return list
        try {
          const detail = await api<{ songs?: unknown[] }>(
            'playlist_track_all',
            {
              id: list.id,
              limit: 3,
              offset: 0,
            },
          )
          return { ...list, tracks: normalizeSongs(detail.songs) }
        } catch {
          return { ...list, tracks: [] }
        }
      }),
    )
  }, [])

  return (
    <div className="page">
      {/* 顶部横幅 */}
      {banners && banners.length > 0 && (
        <BannerCarousel
          items={banners}
          onOpen={(item) => {
            if (item.targetType === 3000) navigate(`/playlist/${item.targetId}`)
            else if (item.url) void window.ncm.app.openExternal(item.url)
            else navigate(`/playlist/${item.targetId}`)
          }}
        />
      )}

      {/* 快捷入口 */}
      <div className="quick-row">
        <QuickEntry
          icon="calendar"
          title="每日推荐"
          desc={loggedIn ? '根据口味每日更新' : '登录后可用'}
          onClick={() => navigate(loggedIn ? '/daily' : '/login')}
        />
        <QuickEntry
          icon="folder"
          title="本地音乐"
          desc="扫描本机歌曲"
          onClick={() => navigate('/local')}
        />
        <QuickEntry
          icon="heart"
          title="我喜欢的音乐"
          desc={loggedIn ? '收藏的全部歌曲' : '登录后可用'}
          onClick={() => navigate(loggedIn ? '/likes' : '/login')}
        />
        <QuickEntry
          icon="cloud"
          title="我的云盘"
          desc={loggedIn ? '上传的音乐' : '登录后可用'}
          onClick={() => navigate(loggedIn ? '/cloud' : '/login')}
        />
      </div>

      {/* 推荐歌单 */}
      <SectionHeader
        title="推荐歌单"
        icon="disc"
        extra={<span className="f-12 muted">根据你的口味生成</span>}
      />
      {loadingPlaylists ? (
        <Loading minHeight={200} />
      ) : (
        <GridContainer>
          {(recommendPlaylists ?? []).map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              subtitle={playlist.copywriter || undefined}
              onPlay={() => navigate(`/playlist/${playlist.id}`)}
            />
          ))}
        </GridContainer>
      )}

      {/* 推荐新音乐 */}
      <SectionHeader title="推荐新音乐" icon="music" />
      {loadingSongs ? (
        <Loading minHeight={200} />
      ) : (
        <SongTable
          songs={(newSongs ?? []).slice(0, 10)}
          context={{ type: 'top', name: '推荐新音乐' }}
          showAlbum={false}
        />
      )}

      {/* 排行榜 */}
      {toplists && toplists.length > 0 && (
        <>
          <SectionHeader title="排行榜" icon="wave" />
          <div className="toplist-row">
            {toplists.map((list) => (
              <div
                key={list.id}
                className="toplist-card hoverable"
                onClick={() => navigate(`/playlist/${list.id}`)}
              >
                <Cover
                  src={imageUrl(list.coverImgUrl, 200)}
                  size={92}
                  radius={10}
                />
                <div className="toplist-info">
                  <div className="toplist-name ellipsis">{list.name}</div>
                  <div className="toplist-freq muted f-11">
                    {list.updateFrequency}
                  </div>
                  <div className="toplist-tracks">
                    {(list.tracks ?? []).slice(0, 3).map((song, index) => (
                      <div
                        key={song.id}
                        className="toplist-track ellipsis"
                        onClick={(event) => {
                          event.stopPropagation()
                          void playSongs(list.tracks ?? [], index, {
                            type: 'top',
                            id: list.id,
                            name: list.name,
                          })
                        }}
                      >
                        <span className="toplist-track-index">{index + 1}</span>
                        {song.name}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 推荐 MV */}
      {recommendMvs && recommendMvs.length > 0 && (
        <>
          <SectionHeader
            title="推荐视频"
            icon="video"
            onMore={() => navigate('/mv')}
          />
          <GridContainer>
            {recommendMvs.map((mv) => (
              <MvCard
                key={mv.id}
                mv={mv}
                onPlay={() => navigate(`/mv/${mv.id}`)}
              />
            ))}
          </GridContainer>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function QuickEntry({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string
  title: string
  desc: string
  onClick: () => void
}): ReactNode {
  return (
    <button type="button" className="quick-entry" onClick={onClick}>
      <span className="quick-entry-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="col">
        <span className="quick-entry-title">{title}</span>
        <span className="f-11 muted">{desc}</span>
      </span>
    </button>
  )
}

function BannerCarousel({
  items,
  onOpen,
}: {
  items: BannerItem[]
  onOpen: (item: BannerItem) => void
}): ReactNode {
  const [index, setIndex] = useState(0)
  const count = items.length

  useEffect(() => {
    if (count <= 1) return
    const timer = window.setInterval(
      () => setIndex((value) => (value + 1) % count),
      5200,
    )
    return () => window.clearInterval(timer)
  }, [count])

  const current = useMemo(() => items[index % count], [items, index, count])

  return (
    <div className="banner">
      <div className="banner-image" onClick={() => current && onOpen(current)}>
        <img
          src={imageUrl(current?.imageUrl, 1200)}
          alt={current?.typeTitle ?? ''}
        />
        {current?.typeTitle && (
          <span className="banner-tag">{current.typeTitle}</span>
        )}
      </div>
      <div className="banner-dots">
        {items.map((item, dotIndex) => (
          <button
            type="button"
            key={`${item.targetId}-${dotIndex}`}
            className={
              dotIndex === index % count
                ? 'banner-dot banner-dot-active'
                : 'banner-dot'
            }
            onClick={() => setIndex(dotIndex)}
            title={`第 ${dotIndex + 1} 张`}
          />
        ))}
      </div>
      {count > 1 && (
        <div className="banner-arrows">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIndex((value) => (value - 1 + count) % count)}
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIndex((value) => (value + 1) % count)}
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      )}
      <span className="banner-count f-11">
        {index + 1} / {count}
      </span>
    </div>
  )
}
