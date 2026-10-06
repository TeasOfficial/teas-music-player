import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import clsx from 'clsx'
import type { Album, Artist, Song } from '@shared/types'
import { Icon, type IconName } from '@/components/ui/Icon'
import {
  Cover,
  DetailSkeleton,
  Empty,
  Loading,
  Tabs,
  type TabItem,
} from '@/components/ui/Primitives'
import { openContextMenu } from '@/components/ui/ContextMenu'
import { AlbumCard, ArtistCard, GridContainer } from '@/components/cards'
import { SongTable } from '@/components/song/SongTable'
import { batchActions } from '@/components/song/songActions'
import { useAsync, usePaged } from '@/lib/hooks'
import { api, apiCached, apiSafe, invalidateCache } from '@/lib/api'
import { formatCount, imageUrl } from '@/lib/format'
import { usePlayerStore } from '@/store/player'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'
import './ArtistDetail.css'

/**
 * artist_detail 返回的头像是 cover/avatar，别名在 transNames，
 * 与项目里的 Artist 类型不完全一致，这里补齐后再参与渲染。
 */
type ArtistInfoArtist = Artist & {
  cover?: string
  avatar?: string
  transNames?: string[]
  identifyTag?: string
  mvSize?: number
}

interface ArtistInfo {
  artist: ArtistInfoArtist
  followed: boolean
  fansCount: number
}

type ArtistTab = 'songs' | 'albums' | 'similar' | 'desc'

const SONG_PAGE = 100
const ALBUM_PAGE = 30

const TABS: TabItem<ArtistTab>[] = [
  { value: 'songs', label: '热门歌曲' },
  { value: 'albums', label: '全部专辑' },
  { value: 'similar', label: '相似歌手' },
  { value: 'desc', label: '歌手简介' },
]

/** 部分老接口仍返回 http 图片，而 CSP 的 img-src 只放行 https，这里统一升级协议 */
function httpsUrl(url?: string): string | undefined {
  return url?.replace(/^http:\/\//, 'https://')
}

function secureAlbum(album: Album): Album {
  return {
    ...album,
    picUrl: httpsUrl(album.picUrl),
    coverImgUrl: httpsUrl(album.coverImgUrl),
  }
}

function secureArtist(artist: Artist): Artist {
  return {
    ...artist,
    picUrl: httpsUrl(artist.picUrl),
    img1v1Url: httpsUrl(artist.img1v1Url),
  }
}

/** 列表三态：加载中 / 失败 / 空，避免每个面板重复写一遍 */
function ListState({
  loading,
  error,
  empty,
  emptyText,
  icon = 'music',
  children,
}: {
  loading: boolean
  error: Error | null
  empty: boolean
  emptyText: string
  icon?: IconName
  children: ReactNode
}): ReactNode {
  if (loading) return <Loading minHeight={240} />
  if (error) return <Empty icon="info" title={error.message} minHeight={240} />
  if (empty) return <Empty icon={icon} title={emptyText} minHeight={240} />
  return <>{children}</>
}

export default function ArtistDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const navigate = useAppNavigate()
  const artistId = Number(id)

  const loggedIn = useAuthStore((state) => state.loggedIn)
  const playSongs = usePlayerStore((state) => state.playSongs)
  const addToQueue = usePlayerStore((state) => state.addToQueue)

  const [tab, setTab] = useState<ArtistTab>('songs')
  const [order, setOrder] = useState<'hot' | 'time'>('hot')

  /* 歌手资料：粉丝数与关注态来自 artist_follow_count（artist_detail 不含这两项） */
  const {
    data: info,
    loading,
    error,
    setData,
  } = useAsync<ArtistInfo>(async () => {
    if (!Number.isFinite(artistId)) throw new Error('歌手 id 无效')
    const [detail, count] = await Promise.all([
      apiCached<{ data?: { artist?: ArtistInfoArtist } }>(
        'artist_detail',
        { id: artistId },
        60_000,
      ),
      apiSafe<{ data?: { isFollow?: boolean; fansCnt?: number } }>(
        'artist_follow_count',
        { id: artistId },
        {},
      ),
    ])
    const artist = detail.data?.artist
    if (!artist) throw new Error('歌手不存在或已删除')
    return {
      artist,
      followed: !!count.data?.isFollow,
      fansCount: count.data?.fansCnt ?? 0,
    }
  }, [artistId])

  // 歌曲分页：热门 / 时间切换
  const songsPaged = usePaged<Song>(
    async (offset) => {
      if (!Number.isFinite(artistId)) return { items: [], total: 0 }
      const body = await apiCached<{ songs?: Song[]; more?: boolean }>(
        'artist_songs',
        { id: artistId, order, limit: SONG_PAGE, offset },
        30_000,
      )
      const items = body.songs ?? []
      // 接口只给 more 不给总数，用「已加载 + 一页」近似出 hasMore
      return {
        items,
        total: body.more
          ? offset + items.length + SONG_PAGE
          : offset + items.length,
      }
    },
    [artistId, order],
    SONG_PAGE,
  )

  const albumsPaged = usePaged<Album>(
    async (offset) => {
      if (!Number.isFinite(artistId)) return { items: [], total: 0 }
      const body = await apiCached<{ hotAlbums?: Album[]; more?: boolean }>(
        'artist_album',
        { id: artistId, limit: ALBUM_PAGE, offset },
        30_000,
      )
      const items = body.hotAlbums ?? []
      return {
        items,
        total: body.more
          ? offset + items.length + ALBUM_PAGE
          : offset + items.length,
      }
    },
    [artistId],
    ALBUM_PAGE,
  )

  // 三个标签页的数据都在进入页面时并行取好，切换时直接命中 apiCached
  const {
    data: similar,
    loading: similarLoading,
    error: similarError,
  } = useAsync<Artist[]>(async () => {
    if (!Number.isFinite(artistId)) return []
    const body = await apiCached<{ artists?: Artist[] }>(
      'simi_artist',
      { id: artistId },
      60_000,
    )
    return body.artists ?? []
  }, [artistId])

  useEffect(() => {
    if (error) toast.fromError(error, '歌手信息加载失败')
  }, [error])

  const artist = info?.artist
  const context = { type: 'artist' as const, id: artistId, name: artist?.name }

  /** 播放热门歌曲：当前就是热门列表时直接播，否则按需拉一页热门 */
  const playHot = async (): Promise<void> => {
    if (!artist) return
    if (order === 'hot' && songsPaged.items.length > 0) {
      void playSongs(songsPaged.items, 0, context)
      return
    }
    try {
      const body = await apiCached<{ songs?: Song[] }>(
        'artist_songs',
        { id: artistId, order: 'hot', limit: SONG_PAGE, offset: 0 },
        30_000,
      )
      void playSongs(body.songs ?? [], 0, context)
    } catch (err) {
      toast.fromError(err, '获取热门歌曲失败')
    }
  }

  const toggleFollow = async (): Promise<void> => {
    if (!info) return
    if (!loggedIn) {
      toast.info('请先登录后再关注歌手')
      return
    }
    const next = !info.followed
    setData({ ...info, followed: next })
    try {
      // artist_sub：t=1 关注，其余取消关注
      await api('artist_sub', { id: artistId, t: next ? 1 : 2 })
      invalidateCache('artist_follow_count')
      invalidateCache('artist_sublist')
      toast.success(next ? '已关注歌手' : '已取消关注')
    } catch (err) {
      setData({ ...info, followed: !next })
      toast.fromError(err, '操作失败')
    }
  }

  if (loading) return <DetailSkeleton rows={6} />

  if (!info || !artist) {
    return (
      <div className="page">
        <Empty
          icon="user"
          title={error?.message || '歌手不存在'}
          description="请检查链接是否正确，或返回发现页浏览其它歌手"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/discover')}
            >
              返回发现页
            </button>
          }
        />
      </div>
    )
  }

  const avatar = imageUrl(
    httpsUrl(
      artist.cover ?? artist.avatar ?? artist.picUrl ?? artist.img1v1Url,
    ),
    400,
  )
  const aliases = [
    ...new Set([...(artist.alias ?? []), ...(artist.transNames ?? [])]),
  ].filter(Boolean)

  return (
    <div className="page">
      <div className="artist-hero">
        <Cover src={avatar} size={180} round alt={artist.name} />
        <div className="detail-info">
          <div className="detail-meta">
            <span className="detail-tag">歌手</span>
            {artist.identifyTag && (
              <span className="badge">{artist.identifyTag}</span>
            )}
          </div>

          <h1 className="artist-name">{artist.name}</h1>

          {aliases.length > 0 && (
            <div className="artist-alias">{aliases.join(' / ')}</div>
          )}

          <div className="detail-stats">
            <span>
              粉丝
              <span className="detail-stat-value">
                {formatCount(info.fansCount)}
              </span>
            </span>
            <span>
              专辑
              <span className="detail-stat-value">{artist.albumSize ?? 0}</span>
            </span>
            <span>
              歌曲
              <span className="detail-stat-value">{artist.musicSize ?? 0}</span>
            </span>
            <span>
              MV<span className="detail-stat-value">{artist.mvSize ?? 0}</span>
            </span>
          </div>

          <div className="page-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void playHot()}
            >
              <Icon name="play" size={15} /> 播放热门歌曲
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void toggleFollow()}
            >
              <Icon name={info.followed ? 'check' : 'plus'} size={15} />
              {info.followed ? '已关注' : '关注'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={songsPaged.items.length === 0}
              onClick={() => addToQueue(songsPaged.items)}
            >
              <Icon name="add-list" size={15} /> 加入到播放列表
            </button>
          </div>
        </div>
      </div>

      <div className="artist-tabs">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'songs' && (
        <>
          <div className="filter-row" style={{ marginTop: 14 }}>
            <span
              className={clsx('chip', order === 'hot' && 'chip-active')}
              onClick={() => setOrder('hot')}
            >
              热门
            </span>
            <span
              className={clsx('chip', order === 'time' && 'chip-active')}
              onClick={() => setOrder('time')}
            >
              时间
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={songsPaged.items.length === 0}
              onClick={() => void playSongs(songsPaged.items, 0, context)}
            >
              <Icon name="play" size={14} /> 播放全部
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={songsPaged.items.length === 0}
              onClick={(event) =>
                openContextMenu(event, batchActions(songsPaged.items))
              }
            >
              <Icon name="more" size={14} /> 批量操作
            </button>
          </div>

          <ListState
            loading={songsPaged.loading}
            error={songsPaged.error}
            empty={songsPaged.items.length === 0}
            emptyText="这位歌手还没有歌曲"
          >
            <SongTable songs={songsPaged.items} context={context} />
            {songsPaged.hasMore && (
              <div
                className="row"
                style={{ justifyContent: 'center', padding: '16px 0' }}
              >
                <button
                  type="button"
                  className="btn"
                  disabled={songsPaged.loadingMore}
                  onClick={songsPaged.loadMore}
                >
                  {songsPaged.loadingMore
                    ? '加载中…'
                    : `加载更多（已显示 ${songsPaged.items.length} 首）`}
                </button>
              </div>
            )}
          </ListState>
        </>
      )}

      {tab === 'albums' && (
        <ListState
          loading={albumsPaged.loading}
          error={albumsPaged.error}
          empty={albumsPaged.items.length === 0}
          emptyText="暂无专辑"
          icon="disc"
        >
          <div style={{ marginTop: 14 }}>
            <GridContainer>
              {albumsPaged.items.map((album) => (
                <AlbumCard key={album.id} album={secureAlbum(album)} />
              ))}
            </GridContainer>
          </div>
          {albumsPaged.hasMore && (
            <div
              className="row"
              style={{ justifyContent: 'center', padding: '16px 0' }}
            >
              <button
                type="button"
                className="btn"
                disabled={albumsPaged.loadingMore}
                onClick={albumsPaged.loadMore}
              >
                {albumsPaged.loadingMore
                  ? '加载中…'
                  : `加载更多（已显示 ${albumsPaged.items.length} 张）`}
              </button>
            </div>
          )}
        </ListState>
      )}

      {tab === 'similar' && (
        <ListState
          loading={similarLoading}
          error={similarError}
          empty={(similar ?? []).length === 0}
          emptyText="暂无相似歌手"
          icon="user"
        >
          <div style={{ marginTop: 14 }}>
            <GridContainer>
              {(similar ?? []).map((item) => (
                <ArtistCard key={item.id} artist={secureArtist(item)} />
              ))}
            </GridContainer>
          </div>
        </ListState>
      )}

      {tab === 'desc' &&
        (artist.briefDesc ? (
          <div className="text-page artist-bio">{artist.briefDesc}</div>
        ) : (
          <Empty icon="info" title="暂无歌手简介" />
        ))}
    </div>
  )
}
