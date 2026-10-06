import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useParams } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import clsx from 'clsx'
import type { Playlist, Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  Cover,
  DetailSkeleton,
  Empty,
  Highlight,
  Loading,
} from '@/components/ui/Primitives'
import { openContextMenu } from '@/components/ui/ContextMenu'
import { SongTable } from '@/components/song/SongTable'
import { batchActions } from '@/components/song/songActions'
import { CommentSection } from '@/components/comment/CommentSection'
import { api, apiCached, invalidateCache } from '@/lib/api'
import { formatCount, formatDate, imageUrl } from '@/lib/format'
import { useDebouncedValue } from '@/lib/hooks'
import { usePlayerStore } from '@/store/player'
import { useDownloadStore } from '@/store/download'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'

const PAGE_SIZE = 300

export default function PlaylistDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const navigate = useAppNavigate()
  const playlistId = Number(id)

  const loggedIn = useAuthStore((state) => state.loggedIn)
  const profile = useAuthStore((state) => state.profile)
  const playSongs = usePlayerStore((state) => state.playSongs)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const startBatch = useDownloadStore((state) => state.startBatch)

  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [descExpanded, setDescExpanded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** 歌单内本地搜索关键词（只过滤已加载的曲目，不发新请求） */
  const [keyword, setKeyword] = useState('')

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  /* ---------------- 数据加载 ---------------- */

  useEffect(() => {
    if (!Number.isFinite(playlistId)) return
    let cancelled = false
    setLoading(true)
    setError('')
    setSongs([])
    setSelected(new Set())

    apiCached<{ playlist?: Playlist }>(
      'playlist_detail',
      { id: playlistId, s: 8 },
      30_000,
    )
      .then((body) => {
        if (cancelled) return
        if (!body.playlist) {
          setError('歌单不存在或已删除')
          return
        }
        setPlaylist(body.playlist)
        const initial = body.playlist.tracks ?? []
        setSongs(initial)
        setTotal(body.playlist.trackCount ?? initial.length)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '歌单加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [playlistId])

  // 超大歌单：详情接口只返回前若干首，剩余用 playlist_track_all 分页补齐
  const loadMore = useCallback(async (): Promise<void> => {
    if (loading || loadingMore) return
    if (songs.length === 0 || songs.length >= total) return
    setLoadingMore(true)
    try {
      const body = await api<{ songs?: Song[] }>('playlist_track_all', {
        id: playlistId,
        limit: PAGE_SIZE,
        offset: songs.length,
      })
      const next = body.songs ?? []
      if (next.length > 0) setSongs((previous) => [...previous, ...next])
      else setTotal(songs.length)
    } catch (error) {
      toast.fromError(error, '加载更多歌曲失败')
    } finally {
      setLoadingMore(false)
    }
  }, [loading, loadingMore, songs.length, total, playlistId])

  useEffect(() => {
    const element = scrollerRef.current?.closest('.app-main') ?? null
    if (!element) return
    const handler = (): void => {
      const remain =
        element.scrollHeight - element.scrollTop - element.clientHeight
      if (remain < 400) void loadMore()
    }
    element.addEventListener('scroll', handler, { passive: true })
    return () => element.removeEventListener('scroll', handler)
  }, [loadMore])

  const cover = imageUrl(playlist?.coverImgUrl ?? playlist?.picUrl, 500)

  /* ---------------- 歌单内搜索（本地过滤，已加载曲目范围内） ---------------- */

  const debouncedKeyword = useDebouncedValue(keyword, 200)
  const searchText = debouncedKeyword.trim().toLowerCase()
  const searching = searchText.length > 0

  /** 稳定的行键：与数组下标无关，过滤/重排后仍指向同一首歌 */
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>()
    return songs.map((song) => {
      const base = songKeyOf(song)
      const occurrence = seen.get(base) ?? 0
      seen.set(base, occurrence + 1)
      return songKeyOf(song, occurrence)
    })
  }, [songs])

  const visibleRows = useMemo(() => {
    if (!searching) {
      return songs.map((song, index) => ({ song, index, key: rowKeys[index] }))
    }
    const rows: Array<{ song: Song; index: number; key: string }> = []
    songs.forEach((song, index) => {
      const haystack = [
        song.name,
        ...(song.alia ?? []),
        ...(song.ar ?? []).map((artist) => artist.name),
        song.al?.name ?? '',
      ]
        .join(' ')
        .toLowerCase()
      if (haystack.includes(searchText)) {
        rows.push({ song, index, key: rowKeys[index] })
      }
    })
    return rows
  }, [songs, rowKeys, searchText, searching])

  const visibleSongs = useMemo(
    () => visibleRows.map((row) => row.song),
    [visibleRows],
  )
  const visibleKeys = useMemo(
    () => visibleRows.map((row) => row.key),
    [visibleRows],
  )
  /** 过滤后的行下标 → 在全量 songs 里的下标（选择/移除都要用原始下标） */
  const sourceIndexOf = useMemo(() => {
    const map = new Map<number, number>()
    visibleRows.forEach((row, rowIndex) => map.set(rowIndex, row.index))
    return map
  }, [visibleRows])

  /** 已加载全量才叫「搜全」；否则提示还能搜更多 */
  const fullyLoaded = songs.length >= total
  const missedCount = fullyLoaded ? 0 : total - songs.length


  const isOwner = !!playlist && playlist.userId === profile?.userId
  const subscribed = !!playlist?.subscribed

  const toggleSubscribe = async (): Promise<void> => {
    if (!loggedIn) {
      toast.info('请先登录后再收藏歌单')
      return
    }
    if (!playlist) return
    try {
      await api('playlist_subscribe', {
        id: playlist.id,
        t: subscribed ? 2 : 1,
      })
      setPlaylist({ ...playlist, subscribed: !subscribed })
      invalidateCache('user_playlist')
      invalidateCache('playlist_detail')
      toast.success(subscribed ? '已取消收藏' : '已收藏歌单')
    } catch (error) {
      toast.fromError(error, '操作失败')
    }
  }

  const allSelected =
    visibleSongs.length > 0 && visibleKeys.every((key) => selected.has(key))

  const selectedSongs = useMemo(
    () => songs.filter((song) => selected.has(songKeyOf(song))),
    [songs, selected],
  )

  if (loading) return <DetailSkeleton rows={8} />

  if (error || !playlist) {
    return (
      <div className="page">
        <Empty
          icon="info"
          title={error || '歌单不存在'}
          description="请检查链接是否正确，或返回发现页浏览其它歌单"
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

  return (
    <div className="page" ref={scrollerRef}>
      <div className="detail-hero">
        {cover && (
          <div
            className="detail-hero-bg"
            style={{ backgroundImage: `url(${cover})` }}
          />
        )}
        <div className="detail-hero-mask" />
        <Cover src={cover} size={196} radius={12} className="detail-cover" />
        <div className="detail-info">
          <div className="row gap-8">
            <span className="detail-tag">歌单</span>
            {playlist.highQuality && (
              <span className="badge badge-accent">精品</span>
            )}
          </div>

          <h1 className="detail-title">{playlist.name}</h1>

          {playlist.creator && (
            <div className="detail-creator">
              <Cover
                src={imageUrl(playlist.creator.avatarUrl, 60)}
                size={24}
                round
              />
              <span
                className="link"
                onClick={() => navigate(`/user/${playlist.creator?.userId}`)}
              >
                {playlist.creator.nickname}
              </span>
              {playlist.createTime && (
                <span className="muted f-11">
                  创建于 {formatDate(playlist.createTime)}
                </span>
              )}
            </div>
          )}

          <div className="detail-stats">
            <span>
              歌曲
              <span className="detail-stat-value">
                {playlist.trackCount ?? songs.length}
              </span>
            </span>
            <span>
              播放
              <span className="detail-stat-value">
                {formatCount(playlist.playCount)}
              </span>
            </span>
            <span>
              收藏
              <span className="detail-stat-value">
                {formatCount(playlist.subscribedCount)}
              </span>
            </span>
            <span>
              评论
              <span className="detail-stat-value">
                {formatCount(playlist.commentCount)}
              </span>
            </span>
          </div>

          {playlist.tags && playlist.tags.length > 0 && (
            <div className="filter-row" style={{ margin: 0 }}>
              {playlist.tags.map((tag) => (
                <span
                  key={tag}
                  className="chip"
                  onClick={() =>
                    navigate(`/search?q=${encodeURIComponent(tag)}&type=1000`)
                  }
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {playlist.description && (
            <div
              className={clsx(
                'detail-desc',
                descExpanded && 'detail-desc-expanded',
              )}
              onClick={() => setDescExpanded((value) => !value)}
              title={descExpanded ? '点击收起' : '点击展开简介'}
            >
              {playlist.description}
            </div>
          )}

          <div className="page-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={songs.length === 0}
              onClick={() =>
                void playSongs(songs, 0, {
                  type: 'playlist',
                  id: playlist.id,
                  name: playlist.name,
                })
              }
            >
              <Icon name="play" size={15} /> 播放全部
            </button>
            <button
              type="button"
              className="btn"
              disabled={songs.length === 0}
              onClick={() => addToQueue(songs)}
            >
              <Icon name="add-list" size={15} /> 添加到播放列表
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void toggleSubscribe()}
            >
              <Icon name={subscribed ? 'check' : 'plus'} size={15} />
              {subscribed ? '已收藏' : '收藏'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={songs.length === 0}
              onClick={() => void startBatch(songs)}
            >
              <Icon name="download" size={15} /> 下载全部
            </button>
            <button
              type="button"
              className="btn"
              onClick={(event) =>
                openContextMenu(event, [
                  ...batchActions(songs),
                  { key: 'd1', divider: true },
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
                  {
                    key: 'refresh',
                    label: '刷新歌单',
                    icon: 'refresh',
                    onClick: () => {
                      invalidateCache('playlist_detail')
                      invalidateCache('playlist_track_all')
                      window.location.reload()
                    },
                  },
                ])
              }
            >
              <Icon name="more" size={15} /> 更多
            </button>
          </div>
        </div>
      </div>

      {songs.length === 0 ? (
        <Empty icon="music" title="这个歌单还没有歌曲" minHeight={200} />
      ) : (
        <>
          <div
            className="row"
            style={{ justifyContent: 'space-between', margin: '18px 0 8px' }}
          >
            <span className="f-14 bold">
              歌曲列表{' '}
              <span className="muted f-12">
                {searching
                  ? `${visibleSongs.length} / ${songs.length} 匹配`
                  : `${songs.length} / ${total}`}
              </span>
            </span>
            <div className="row gap-6">
              <div className="list-search">
                <Icon name="search" size={14} className="list-search-icon" />
                <input
                  ref={searchInputRef}
                  value={keyword}
                  placeholder="搜索本歌单：歌名 / 歌手 / 专辑"
                  title="在当前歌单内按歌名、歌手、专辑筛选（已加载的曲目）"
                  onChange={(event) => setKeyword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setKeyword('')
                  }}
                />
                {keyword && (
                  <button
                    type="button"
                    className="icon-btn"
                    title="清空搜索"
                    onClick={() => {
                      setKeyword('')
                      searchInputRef.current?.focus()
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="text-btn"
                disabled={visibleSongs.length === 0}
                onClick={() =>
                  setSelected((previous) => {
                    const next = new Set(previous)
                    if (allSelected) visibleKeys.forEach((key) => next.delete(key))
                    else visibleKeys.forEach((key) => next.add(key))
                    return next
                  })
                }
              >
                {allSelected ? '取消全选' : searching ? '全选结果' : '全选'}
              </button>
            </div>
          </div>

          {visibleSongs.length === 0 ? (
            <Empty
              icon="search"
              title={`没有匹配「${debouncedKeyword.trim()}」的歌曲`}
              description={
                missedCount > 0
                  ? `当前只加载了 ${songs.length} / ${total} 首，还有 ${missedCount} 首未加载，可能匹配结果在未加载部分`
                  : '换个关键词试试，或清空搜索框'
              }
              minHeight={180}
            />
          ) : (
            <SongTable
              songs={visibleSongs}
              keys={visibleKeys}
              context={{
                type: 'playlist',
                id: playlist.id,
                name: playlist.name,
              }}
              keyword={searchText}
              emptyText="没有匹配的歌曲"
              selectable
              selectedKeys={selected}
              onToggleSelect={(song, index) => {
                const key =
                  visibleKeys[index] ??
                  rowKeys[sourceIndexOf.get(index) ?? index] ??
                  songKeyOf(song)
                setSelected((previous) => {
                  const next = new Set(previous)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }}
              onRemove={
                isOwner
                  ? (index) => {
                      const sourceIndex = sourceIndexOf.get(index) ?? index
                      const song = songs[sourceIndex]
                      if (!song) return
                      void api('playlist_track_delete', {
                        pid: playlist.id,
                        ids: song.id,
                      })
                        .then(() => {
                          setSongs((previous) =>
                            previous.filter((_, i) => i !== sourceIndex),
                          )
                          invalidateCache('playlist_detail')
                          toast.success('已从歌单移除')
                        })
                        .catch((error: unknown) =>
                          toast.fromError(error, '移除失败'),
                        )
                    }
                  : undefined
              }
              removeLabel={isOwner ? '从歌单移除' : '从播放列表移除'}
            />
          )}

          {searching && missedCount > 0 && visibleSongs.length > 0 && (
            <div
              className="row"
              style={{ justifyContent: 'center', padding: '12px 0' }}
            >
              <span className="muted f-12">
                只搜索了已加载的 {songs.length} / {total} 首
              </span>
              <button
                type="button"
                className="text-btn"
                disabled={loadingMore}
                onClick={() => {
                  setKeyword('')
                  void loadMore()
                }}
              >
                {loadingMore ? '加载中…' : '加载其余歌曲'}
              </button>
            </div>
          )}

          {loadingMore && <Loading minHeight={80} label="加载更多歌曲…" />}
          {!loadingMore && songs.length < total && (
            <div
              className="row"
              style={{ justifyContent: 'center', padding: '14px 0' }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => void loadMore()}
              >
                加载更多（剩余 {total - songs.length} 首）
              </button>
            </div>
          )}

          {selectedSongs.length > 0 && (
            <div className="batch-bar">
              <span className="f-12">已选择 {selectedSongs.length} 首</span>
              <div className="spacer" />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void playSongs(selectedSongs, 0, {
                    type: 'playlist',
                    id: playlist.id,
                    name: `${playlist.name}（已选）`,
                  })
                }
              >
                播放选中
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => addToQueue(selectedSongs)}
              >
                加入队列
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void startBatch(selectedSongs)}
              >
                下载
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSelected(new Set())}
              >
                取消选择
              </button>
            </div>
          )}
        </>
      )}

      <CommentSection type={2} id={playlist.id} title="歌单评论" />
    </div>
  )
}

/**
 * 歌曲的稳定行键。刻意**不含数组下标**：歌单内搜索会过滤列表，
 * 带下标的键会让选择集在过滤后指向另一首歌。
 * 同一首歌在歌单里重复出现时用出现次数兜底，保证仍能各自勾选。
 */
function songKeyOf(song: Song, occurrence = 0): string {
  const base = `${song.id}-${song.source ?? 'netease'}`
  return occurrence > 0 ? `${base}#${occurrence}` : base
}
