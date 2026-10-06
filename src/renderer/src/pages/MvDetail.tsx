import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import type { Mv } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  DetailSkeleton,
  Empty,
  Loading,
  SectionHeader,
} from '@/components/ui/Primitives'
import { GridContainer, MvCard } from '@/components/cards'
import { CommentSection } from '@/components/comment/CommentSection'
import { useAsync } from '@/lib/hooks'
import { api, apiCached, invalidateCache } from '@/lib/api'
import { formatCount, formatDate, formatDuration } from '@/lib/format'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'
import './MvDetail.css'

/** mv_url 取回的地址带时效，这里连同请求时的 id 一起记，便于判断是否已过期 */
interface PlayInfo {
  mvid: number
  url: string | null
}

/** 相似 MV / 列表里的 http 封面在 CSP 下会被拦，统一升级协议 */
function secureMv(mv: Mv): Mv {
  const fix = (url?: string): string | undefined =>
    url?.replace(/^http:\/\//, 'https://')
  return { ...mv, cover: fix(mv.cover), picUrl: fix(mv.picUrl) }
}

export default function MvDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const navigate = useAppNavigate()
  const mvId = Number(id)

  const loggedIn = useAuthStore((state) => state.loggedIn)
  const [subscribed, setSubscribed] = useState(false)

  /* mv_detail 的收藏态在最外层的 subed 上，data 里没有 */
  const {
    data: fetched,
    loading,
    error,
  } = useAsync<{ mvid: number; mv: Mv; subed: boolean }>(async () => {
    if (!Number.isFinite(mvId)) throw new Error('视频 id 无效')
    const body = await apiCached<{ data?: Mv; subed?: boolean }>(
      'mv_detail',
      { mvid: mvId },
      60_000,
    )
    if (!body.data) throw new Error('视频不存在或已删除')
    return { mvid: mvId, mv: body.data, subed: !!body.subed }
  }, [mvId])

  // 播放地址有时效，不做缓存；可能返回 null，由页面兜底提示
  const {
    data: playInfo,
    loading: urlLoading,
    error: urlError,
  } = useAsync<PlayInfo>(async () => {
    if (!Number.isFinite(mvId)) return { mvid: mvId, url: null }
    const body = await api<{ data?: { url?: string | null } }>('mv_url', {
      id: mvId,
      r: 1080,
    })
    return { mvid: mvId, url: body.data?.url ?? null }
  }, [mvId])

  const { data: similar, loading: similarLoading } = useAsync<
    Mv[]
  >(async () => {
    if (!Number.isFinite(mvId)) return []
    const body = await apiCached<{ mvs?: Mv[] }>(
      'simi_mv',
      { mvid: mvId },
      60_000,
    )
    return body.mvs ?? []
  }, [mvId])

  // 结果里带着它对应的 id：id 变了、新结果还没回来时按「加载中」处理，避免闪现上一条 MV
  const data = fetched && fetched.mvid === mvId ? fetched : undefined
  const pending = loading || (!data && !error)

  useEffect(() => {
    setSubscribed(!!data?.subed)
  }, [data])

  useEffect(() => {
    if (error) toast.fromError(error, '视频信息加载失败')
  }, [error])

  useEffect(() => {
    if (urlError) toast.fromError(urlError, '播放地址获取失败')
  }, [urlError])

  const toggleSubscribe = async (): Promise<void> => {
    if (!data) return
    if (!loggedIn) {
      toast.info('请先登录后再收藏视频')
      return
    }
    const next = !subscribed
    setSubscribed(next)
    try {
      // mv_sub 的参数是 mvid；t=1 收藏，其余取消收藏
      await api('mv_sub', { mvid: mvId, t: next ? 1 : 2 })
      invalidateCache('mv_detail')
      invalidateCache('mv_sublist')
      toast.success(next ? '已收藏视频' : '已取消收藏')
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
          icon="video"
          title={error?.message || '视频不存在'}
          description="请检查链接是否正确，或返回视频列表"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/mv')}
            >
              返回视频列表
            </button>
          }
        />
      </div>
    )
  }

  const { mv } = data
  // 只有当前 id 的地址才算有效，否则切歌瞬间会短暂用到上一支 MV 的地址
  const playUrl = playInfo && playInfo.mvid === mvId ? playInfo.url : undefined
  const canPlay =
    !urlLoading &&
    !urlError &&
    typeof playUrl === 'string' &&
    playUrl.length > 0

  return (
    <div className="page">
      {/* key 绑定 id，切换 MV 时强制重建 video，避免残留上一条的进度 */}
      <div className="video-wrap">
        {canPlay ? (
          <video
            key={`mv-${mvId}`}
            src={playUrl ?? undefined}
            controls
            autoPlay
          />
        ) : urlLoading ? (
          <Loading minHeight={200} label="正在获取播放地址…" />
        ) : (
          <div className="mv-video-fallback">
            <Icon name="video" size={34} />
            <span className="f-14 text-2">该视频暂不可播放</span>
            <span className="f-11 muted">可能受版权、地区限制或需要会员</span>
          </div>
        )}
      </div>

      <div className="mv-head">
        <h1 className="detail-title">{mv.name}</h1>

        <div className="detail-meta">
          {mv.artistId ? (
            <span
              className="link clickable"
              onClick={() => navigate(`/artist/${mv.artistId}`)}
            >
              <Icon name="mic" size={13} /> {mv.artistName ?? '未知歌手'}
            </span>
          ) : (
            <span>{mv.artistName ?? '未知歌手'}</span>
          )}
          {mv.publishTime ? (
            <span>发行 {formatDate(mv.publishTime)}</span>
          ) : null}
          <span>时长 {formatDuration(mv.duration)}</span>
        </div>

        <div className="detail-stats">
          <span>
            播放
            <span className="detail-stat-value">
              {formatCount(mv.playCount)}
            </span>
          </span>
          <span>
            收藏
            <span className="detail-stat-value">
              {formatCount(mv.subCount)}
            </span>
          </span>
          <span>
            评论
            <span className="detail-stat-value">
              {formatCount(mv.commentCount)}
            </span>
          </span>
          <span>
            分享
            <span className="detail-stat-value">
              {formatCount(mv.shareCount)}
            </span>
          </span>
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void toggleSubscribe()}
          >
            <Icon name={subscribed ? 'check' : 'plus'} size={15} />
            {subscribed ? '已收藏' : '收藏'}
          </button>
          <button type="button" className="btn" onClick={() => navigate('/mv')}>
            <Icon name="video" size={15} /> 更多视频
          </button>
        </div>
      </div>

      {(mv.desc || mv.briefDesc) && (
        <>
          <SectionHeader title="视频简介" icon="info" />
          <div className="mv-desc">{mv.desc || mv.briefDesc}</div>
        </>
      )}

      <SectionHeader title="相似 MV" icon="video" />
      {similarLoading ? (
        <Loading minHeight={180} />
      ) : (similar ?? []).length === 0 ? (
        <Empty icon="video" title="暂无相似视频" minHeight={180} />
      ) : (
        <GridContainer>
          {(similar ?? []).map((item) => (
            <MvCard
              key={String(item.id)}
              mv={secureMv(item)}
              onPlay={() => navigate(`/mv/${item.id}`)}
            />
          ))}
        </GridContainer>
      )}

      <CommentSection type={1} id={mvId} title="视频评论" />
    </div>
  )
}
