import { useEffect, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import type { Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Cover, Empty, Loading } from '@/components/ui/Primitives'
import { SongTable } from '@/components/song/SongTable'
import { apiCached, invalidateCache } from '@/lib/api'
import { imageUrl } from '@/lib/format'
import { normalizeSongs } from '@/lib/normalize'
import { useAsync } from '@/lib/hooks'
import { useAuthStore } from '@/store/auth'
import { useDownloadStore } from '@/store/download'
import { usePlayerStore, type PlayContext } from '@/store/player'
import { toast } from '@/store/toast'

/** 单次 song_detail 的 id 上限（上游对歌曲数量有限制） */
const BATCH_SIZE = 300

/**
 * likelist 只返回 id，且 song_detail 的返回顺序不保证与请求一致，
 * 因此串行分批取详情后，再按 likelist 的 ids 顺序重排。
 * 串行而非并发是为了避免一次性打出几十个请求触发上游风控。
 */
async function fetchSongsByIds(ids: number[]): Promise<Song[]> {
  const found = new Map<number, Song>()
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE)
    const body = await apiCached<{ songs?: Song[] }>(
      'song_detail',
      { ids: batch.join(',') },
      30_000,
    )
    for (const song of body.songs ?? []) {
      if (song?.id) found.set(song.id, song)
    }
  }
  return ids.map((id) => found.get(id)).filter((song): song is Song => !!song)
}

/**
 * 排序方向：true = 最近添加的在前。
 * 想改成「最早添加的在前」，把它改成 false 即可。
 */
const LIKED_NEWEST_FIRST = true

interface TrackIdEntry {
  id: number
  /** 收藏时间戳，playlist_detail 才带 */
  at?: number
}

/** 我喜欢的音乐的歌单 id（用户歌单里 specialType=5 的那条） */
async function fetchLikedPlaylistId(uid: number): Promise<number | null> {
  const body = await apiCached<{
    playlist?: { id: number; specialType?: number }[]
  }>('user_playlist', { uid, limit: 1, offset: 0 }, 3_600_000)
  return body.playlist?.[0]?.id ?? null
}

/**
 * 加载我喜欢的音乐，按收藏时间排序。
 *
 * 不能直接用 likelist 的顺序：它返回的 id 顺序与收藏时间无关（实测 283 首里
 * 递增 130 次、递减 152 次，基本是乱的），所以列表看起来毫无规律。
 * 权威依据是 playlist_detail 的 trackIds，每一条都带 `at`（收藏时间戳）。
 */
async function fetchLikedSongs(
  uid: number,
): Promise<{ songs: Song[]; total: number; playlistId: number | null }> {
  const playlistId = await fetchLikedPlaylistId(uid)

  if (playlistId) {
    const detail = await apiCached<{
      playlist?: { trackIds?: TrackIdEntry[]; tracks?: Song[] }
    }>('playlist_detail', { id: playlistId }, 60_000)

    const trackIds = detail.playlist?.trackIds ?? []
    if (trackIds.length > 0) {
      const ids = [...trackIds]
        .sort((a, b) =>
          LIKED_NEWEST_FIRST
            ? (b.at ?? 0) - (a.at ?? 0)
            : (a.at ?? 0) - (b.at ?? 0),
        )
        .map((item) => item.id)

      const tracks = detail.playlist?.tracks ?? []
      // 详情接口通常已带全量歌曲，能省掉一批 song_detail；超长歌单走分页兜底
      const byId = new Map(tracks.map((song) => [song.id, song]))
      const songs =
        tracks.length === ids.length
          ? normalizeSongs(ids.map((id) => byId.get(id)).filter(Boolean))
          : (await fetchSongsByIds(ids)).map(
              (song) => normalizeSongs([song])[0] ?? song,
            )

      return { songs, total: ids.length, playlistId }
    }
  }

  // 兜底：拿不到 trackIds 时退回 likelist（顺序不保证，但至少能出内容）
  const body = await apiCached<{ ids?: number[] }>('likelist', { uid }, 30_000)
  const ids = (body.ids ?? []).filter((id) => Number.isFinite(id))
  return { songs: await fetchSongsByIds(ids), total: ids.length, playlistId }
}

export default function Likes(): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const profile = useAuthStore((state) => state.profile)
  const playSongs = usePlayerStore((state) => state.playSongs)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const startBatch = useDownloadStore((state) => state.startBatch)

  const uid = profile?.userId ?? 0

  const { data, loading, error, reload } = useAsync(async () => {
    if (!uid) return { songs: [] as Song[], total: 0, playlistId: null }
    const { songs, total, playlistId } = await fetchLikedSongs(uid)
    // 顺手同步红心状态，省掉一次重复请求
    usePlayerStore.setState({ likedIds: songs.map((song) => song.id) })
    return { songs, total, playlistId }
  }, [uid, loggedIn])

  useEffect(() => {
    if (error && loggedIn) toast.fromError(error, '我喜欢的音乐加载失败')
  }, [error, loggedIn])

  const songs = data?.songs ?? []
  const total = data?.total ?? songs.length
  const missing = Math.max(0, total - songs.length)

  const avatar = imageUrl(profile?.avatarUrl, 500)
  const context: PlayContext = {
    type: 'playlist',
    name: '我喜欢的音乐',
    id: data?.playlistId ?? undefined,
  }

  const refresh = (): void => {
    // 用到的接口都带缓存，刷新时必须一起失效
    invalidateCache('likelist')
    invalidateCache('song_detail')
    invalidateCache('playlist_detail')
    reload()
  }

  /** 随机播放：打乱后在本地队列里播放，避免改动全局播放模式 */
  const shufflePlay = (): void => {
    const list = [...songs]
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const current = list[i]
      list[i] = list[j]
      list[j] = current
    }
    void playSongs(list, 0, { type: 'playlist', name: '我喜欢的音乐（随机）' })
  }

  if (!loggedIn) {
    return (
      <div className="page">
        <Empty
          icon="heart"
          title="登录后查看我喜欢的音乐"
          description="登录后会同步你在手机、网页端收藏的全部歌曲"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/login')}
            >
              去登录
            </button>
          }
        />
      </div>
    )
  }

  if (loading) return <Loading minHeight={480} label="正在加载我喜欢的音乐…" />

  if (error && songs.length === 0) {
    return (
      <div className="page">
        <Empty
          icon="info"
          title="我喜欢的音乐加载失败"
          description={error.message}
          action={
            <button type="button" className="btn btn-primary" onClick={refresh}>
              重新加载
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="detail-hero">
        {avatar && (
          <div
            className="detail-hero-bg"
            style={{ backgroundImage: `url(${avatar})` }}
          />
        )}
        <div className="detail-hero-mask" />
        <Cover src={avatar} size={196} round className="detail-cover" />
        <div className="detail-info">
          <span className="detail-tag">歌单</span>

          <h1 className="detail-title">我喜欢的音乐</h1>

          <div className="detail-meta">
            <Cover src={imageUrl(profile?.avatarUrl, 60)} size={24} round />
            <span>{profile?.nickname ?? '我'}</span>
            {missing > 0 && (
              <span className="muted">· {missing} 首因版权下架未显示</span>
            )}
          </div>

          <div className="detail-stats">
            <span>
              歌曲<span className="detail-stat-value">{total}</span>
            </span>
            <span>
              已加载<span className="detail-stat-value">{songs.length}</span>
            </span>
            <span className="muted">
              {LIKED_NEWEST_FIRST ? '最近添加在前' : '最早添加在前'}
            </span>
          </div>

          <div className="page-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={songs.length === 0}
              onClick={() => void playSongs(songs, 0, context)}
            >
              <Icon name="play" size={15} /> 播放全部
            </button>
            <button
              type="button"
              className="btn"
              disabled={songs.length === 0}
              onClick={shufflePlay}
            >
              <Icon name="shuffle" size={15} /> 随机播放
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
              disabled={songs.length === 0}
              onClick={() => void startBatch(songs)}
            >
              <Icon name="download" size={15} /> 下载全部
            </button>
            <button type="button" className="btn" onClick={refresh}>
              <Icon name="refresh" size={15} /> 刷新
            </button>
          </div>
        </div>
      </div>

      <SongTable
        songs={songs}
        context={context}
        emptyText="还没有收藏任何歌曲，去发现页逛逛吧"
      />
    </div>
  )
}
