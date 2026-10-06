import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import type { Album, Artist, Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  Cover,
  DetailSkeleton,
  Empty,
  Loading,
  SectionHeader,
} from '@/components/ui/Primitives'
import { SongTable } from '@/components/song/SongTable'
import { CommentSection } from '@/components/comment/CommentSection'
import { useAsync } from '@/lib/hooks'
import { api, apiCached, apiSafe, invalidateCache } from '@/lib/api'
import { formatCount, formatDate, imageUrl } from '@/lib/format'
import { usePlayerStore } from '@/store/player'
import { useDownloadStore } from '@/store/download'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'
import './AlbumDetail.css'

interface AlbumBody {
  album?: Album
  songs?: Song[]
}

/** album_detail_dynamic 提供收藏状态与各项计数（album 接口自身只有 info 摘要） */
interface AlbumDynamic {
  isSub?: boolean
  subCount?: number
  commentCount?: number
  shareCount?: number
}

/** 老接口的图片仍是 http，CSP 的 img-src 只放行 https */
function httpsUrl(url?: string): string | undefined {
  return url?.replace(/^http:\/\//, 'https://')
}

export default function AlbumDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const navigate = useAppNavigate()
  const albumId = Number(id)

  const loggedIn = useAuthStore((state) => state.loggedIn)
  const playSongs = usePlayerStore((state) => state.playSongs)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const startBatch = useDownloadStore((state) => state.startBatch)

  const [subscribed, setSubscribed] = useState(false)

  const { data, loading, error } = useAsync<{
    album: Album
    songs: Song[]
    dynamic: AlbumDynamic
  }>(async () => {
    if (!Number.isFinite(albumId)) throw new Error('专辑 id 无效')
    const [body, dynamic] = await Promise.all([
      apiCached<AlbumBody>('album', { id: albumId }, 60_000),
      apiSafe<AlbumDynamic>('album_detail_dynamic', { id: albumId }, {}),
    ])
    const album = body.album
    if (!album) throw new Error('专辑不存在或已删除')
    // 曲目可能挂在顶层，也可能塞在 album.songs 里
    return { album, songs: body.songs ?? album.songs ?? [], dynamic }
  }, [albumId])

  useEffect(() => {
    setSubscribed(!!data?.dynamic.isSub)
  }, [data])

  useEffect(() => {
    if (error) toast.fromError(error, '专辑加载失败')
  }, [error])

  const toggleSubscribe = async (): Promise<void> => {
    if (!data) return
    if (!loggedIn) {
      toast.info('请先登录后再收藏专辑')
      return
    }
    const next = !subscribed
    setSubscribed(next)
    try {
      // album_sub：t=1 收藏，其余取消收藏
      await api('album_sub', { id: data.album.id, t: next ? 1 : 2 })
      invalidateCache('album_detail_dynamic')
      invalidateCache('album_sublist')
      toast.success(next ? '已收藏专辑' : '已取消收藏')
    } catch (err) {
      setSubscribed(!next)
      toast.fromError(err, '操作失败')
    }
  }

  if (loading) return <DetailSkeleton rows={6} />

  if (!data) {
    return (
      <div className="page">
        <Empty
          icon="disc"
          title={error?.message || '专辑不存在'}
          description="请检查链接是否正确，或返回发现页浏览其它专辑"
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

  const { album, songs, dynamic } = data
  const cover = imageUrl(httpsUrl(album.picUrl ?? album.coverImgUrl), 500)
  const albumArtists: Artist[] =
    album.artists ?? (album.artist ? [album.artist] : [])

  return (
    <div className="page">
      <div className="detail-hero">
        {cover && (
          <div
            className="detail-hero-bg"
            style={{ backgroundImage: `url(${cover})` }}
          />
        )}
        <div className="detail-hero-mask" />
        <Cover
          src={cover}
          size={196}
          radius={12}
          className="detail-cover"
          alt={album.name}
        />

        <div className="detail-info">
          <div className="row gap-8">
            <span className="detail-tag">专辑</span>
            {album.subType && <span className="badge">{album.subType}</span>}
            {subscribed && <span className="badge badge-accent">已收藏</span>}
          </div>

          <h1 className="detail-title">{album.name}</h1>

          <div className="detail-creator">
            {albumArtists.length > 0 ? (
              albumArtists.map((artist, index) => (
                <span key={`${artist.id}-${index}`}>
                  {index > 0 && <span className="muted"> / </span>}
                  <span
                    className="link clickable"
                    onClick={() => navigate(`/artist/${artist.id}`)}
                  >
                    {artist.name}
                  </span>
                </span>
              ))
            ) : (
              <span className="muted">未知艺术家</span>
            )}
          </div>

          <div className="detail-meta album-hero-meta">
            {album.publishTime ? (
              <span>发行 {formatDate(album.publishTime)}</span>
            ) : null}
            {album.company ? <span>发行公司 {album.company}</span> : null}
            <span>收录 {album.size ?? songs.length} 首</span>
          </div>

          <div className="detail-stats">
            <span>
              收藏
              <span className="detail-stat-value">
                {formatCount(dynamic.subCount)}
              </span>
            </span>
            <span>
              评论
              <span className="detail-stat-value">
                {formatCount(dynamic.commentCount)}
              </span>
            </span>
            <span>
              分享
              <span className="detail-stat-value">
                {formatCount(dynamic.shareCount)}
              </span>
            </span>
          </div>

          <div className="page-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={songs.length === 0}
              onClick={() =>
                void playSongs(songs, 0, {
                  type: 'album',
                  id: album.id,
                  name: album.name,
                })
              }
            >
              <Icon name="play" size={15} /> 播放全部
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
              disabled={songs.length === 0}
              onClick={() => addToQueue(songs)}
            >
              <Icon name="add-list" size={15} /> 添加到播放列表
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <SongTable
          songs={songs}
          context={{ type: 'album', id: album.id, name: album.name }}
          emptyText="这张专辑还没有曲目"
        />
      </div>

      {album.description && (
        <>
          <SectionHeader title="专辑简介" icon="info" />
          <div className="album-desc">{album.description}</div>
        </>
      )}

      <CommentSection type={3} id={album.id} title="专辑评论" />
    </div>
  )
}
