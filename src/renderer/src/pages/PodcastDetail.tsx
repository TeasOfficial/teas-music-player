import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import clsx from 'clsx'
import type { DjProgram, DjRadio } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  Cover,
  DetailSkeleton,
  Empty,
  Loading,
} from '@/components/ui/Primitives'
import { CommentSection } from '@/components/comment/CommentSection'
import { api, apiCached, invalidateCache } from '@/lib/api'
import { useAsync, usePaged } from '@/lib/hooks'
import {
  formatCount,
  formatDuration,
  formatRelativeTime,
  imageUrl,
  truncate,
} from '@/lib/format'
import { usePlayerStore } from '@/store/player'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'
import './PodcastDetail.css'

const PROGRAM_PAGE_SIZE = 30

/* ------------------------------------------------------------------ */
/* 响应形状兜底：上游同名字段可能包在 data 里，甚至直接给 djRadio 对象      */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 详情接口比列表多带订阅状态等字段，类型里没有的部分在这里补齐 */
interface RadioDetail extends DjRadio {
  /** 当前登录用户是否已订阅 */
  subscribed?: boolean
}

/** dj_detail 多层兜底：body.data.djRadio / body.data / body.djRadio / body */
function normalizeRadio(body: unknown): RadioDetail | null {
  const root = asRecord(body)
  if (!root) return null
  const data = asRecord(root.data) ?? root
  const radio = asRecord(data.djRadio) ?? asRecord(root.djRadio) ?? data
  if (typeof radio.id !== 'number') return null
  return radio as unknown as RadioDetail
}

function pickProgramPage(body: unknown): {
  programs: DjProgram[]
  count: number
  more: boolean
} {
  const record = asRecord(body) ?? {}
  const programs = Array.isArray(record.programs)
    ? (record.programs as DjProgram[])
    : Array.isArray(record.data)
      ? (record.data as DjProgram[])
      : []
  const count = readNumber(record.count) ?? programs.length
  const more = !!record.more || count > programs.length
  return { programs, count, more }
}

function pickDescribe(value?: string): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text ? text : undefined
}

/* ------------------------------------------------------------------ */

export default function PodcastDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const navigate = useAppNavigate()
  const radioId = Number(id)

  const loggedIn = useAuthStore((state) => state.loggedIn)
  const playSongs = usePlayerStore((state) => state.playSongs)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [subPending, setSubPending] = useState(false)

  const {
    data: radio,
    loading,
    error,
    reload,
  } = useAsync(async () => {
    if (!Number.isFinite(radioId)) return null
    const body = await apiCached<unknown>('dj_detail', { rid: radioId }, 60_000)
    const detail = normalizeRadio(body)
    if (!detail) throw new Error('电台不存在或已下架')
    return detail
  }, [radioId])

  /* ---------------- 节目分页 ---------------- */

  const {
    items: programs,
    total,
    loading: programsLoading,
    loadingMore,
    hasMore,
    loadMore,
  } = usePaged<DjProgram>(
    async (offset) => {
      const body = await api<unknown>('dj_program', {
        rid: radioId,
        limit: PROGRAM_PAGE_SIZE,
        offset,
        asc: false,
      })
      const page = pickProgramPage(body)
      return {
        items: page.programs,
        total: Math.max(page.count, offset + page.programs.length),
      }
    },
    [radioId],
    PROGRAM_PAGE_SIZE,
  )

  // 真正的滚动容器是 .app-main（.page 自身不滚动），沿用 PlaylistDetail 的做法
  const loadMoreRef = useRef<() => void>(() => undefined)
  loadMoreRef.current = () => {
    if (hasMore && !loadingMore) loadMore()
  }

  useEffect(() => {
    const element = scrollerRef.current?.closest('.app-main')
    if (!element) return
    const handler = (): void => {
      const remain =
        element.scrollHeight - element.scrollTop - element.clientHeight
      if (remain < 400) loadMoreRef.current()
    }
    element.addEventListener('scroll', handler, { passive: true })
    return () => element.removeEventListener('scroll', handler)
  }, [loading])

  const dj = radio?.dj
  const isSubscribed = subscribed ?? !!radio?.subscribed

  const playProgram = useCallback(
    async (program: DjProgram): Promise<void> => {
      const song = program.mainSong
      if (!song?.id) {
        toast.info('该节目暂无可播放的音频')
        return
      }
      await playSongs([song], 0, {
        type: 'radio',
        id: radio?.id ?? radioId,
        name: radio?.name ?? program.name,
      })
    },
    [playSongs, radio?.id, radio?.name, radioId],
  )

  const playAll = useCallback(async (): Promise<void> => {
    const songs = programs
      .map((program) => program.mainSong)
      .filter((song): song is NonNullable<DjProgram['mainSong']> => !!song?.id)
    if (songs.length === 0) {
      toast.info('该电台还没有可播放的节目')
      return
    }
    await playSongs(songs, 0, {
      type: 'radio',
      id: radioId,
      name: radio?.name ?? '电台',
    })
  }, [programs, playSongs, radio?.name, radioId])

  const toggleSubscribe = useCallback(async (): Promise<void> => {
    if (!loggedIn) {
      toast.info('请先登录后再订阅电台')
      navigate('/login')
      return
    }
    if (subPending) return
    setSubPending(true)
    try {
      await api('dj_sub', { rid: radioId, t: isSubscribed ? 0 : 1 })
      const next = !isSubscribed
      setSubscribed(next)
      invalidateCache('dj_detail')
      invalidateCache('dj_sublist')
      toast.success(next ? '已订阅电台' : '已取消订阅')
    } catch (err) {
      toast.fromError(err, '订阅操作失败')
    } finally {
      setSubPending(false)
    }
  }, [loggedIn, navigate, subPending, isSubscribed, radioId])

  /* ---------------- 状态分支 ---------------- */

  if (loading) return <DetailSkeleton rows={6} />

  if (error || !radio) {
    return (
      <div className="page">
        <Empty
          icon="radio"
          title={error?.message || '电台不存在'}
          description="请检查链接是否正确，或返回播客页浏览其它电台"
          action={
            <div className="row gap-8">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/podcast')}
              >
                去播客首页
              </button>
              <button type="button" className="btn" onClick={reload}>
                重试
              </button>
            </div>
          }
        />
      </div>
    )
  }

  const cover = imageUrl(radio.picUrl, 500)
  const describe = pickDescribe(radio.desc)

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
        <Cover src={cover} size={196} round className="detail-cover" />
        <div className="detail-info">
          <div className="row gap-8">
            <span className="detail-tag">电台</span>
            {radio.category && (
              <span className="badge badge-accent">{radio.category}</span>
            )}
          </div>

          <h1 className="detail-title">{radio.name}</h1>

          {dj && (
            <div className="detail-creator">
              <Cover src={imageUrl(dj.avatarUrl, 60)} size={26} round />
              <span
                className="link"
                onClick={() => navigate(`/user/${dj.userId}`)}
              >
                {dj.nickname}
              </span>
              <span className="muted f-11">DJ</span>
            </div>
          )}

          <div className="detail-stats">
            <span>
              节目
              <span className="detail-stat-value">
                {radio.programCount ?? total}
              </span>
            </span>
            <span>
              订阅
              <span className="detail-stat-value">
                {formatCount(radio.subCount)}
              </span>
            </span>
            <span>
              播放
              <span className="detail-stat-value">
                {formatCount(radio.playCount)}
              </span>
            </span>
          </div>

          {describe && (
            <div
              className={clsx(
                'detail-desc clickable',
                descExpanded && 'detail-desc-expanded',
              )}
              onClick={() => setDescExpanded((value) => !value)}
              title={descExpanded ? '点击收起简介' : '点击展开简介'}
            >
              {descExpanded ? describe : truncate(describe, 150)}
            </div>
          )}

          <div className="page-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={programs.length === 0}
              onClick={() => void playAll()}
            >
              <Icon name="play" size={15} /> 播放全部
            </button>
            <button
              type="button"
              className={clsx('btn', isSubscribed && 'podcast-subscribed')}
              disabled={subPending}
              onClick={() => void toggleSubscribe()}
            >
              <Icon name={isSubscribed ? 'check' : 'plus'} size={15} />
              {isSubscribed ? '已订阅' : '订阅'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`https://music.163.com/#/djradio?id=${radio.id}`)
                  .then(() => toast.success('链接已复制'))
                  .catch(() => toast.error('复制失败'))
              }}
            >
              <Icon name="share" size={15} /> 复制链接
            </button>
          </div>
        </div>
      </div>

      <div className="podcast-detail-head row">
        <span className="f-16 bold">节目列表</span>
        <span className="muted f-12">
          {programs.length} / {total}
        </span>
        <span className="spacer" />
        <span className="muted f-12">按更新时间倒序</span>
      </div>

      {programsLoading ? (
        <Loading minHeight={220} label="正在加载节目…" />
      ) : programs.length === 0 ? (
        <Empty icon="mic" title="这个电台还没有节目" minHeight={200} />
      ) : (
        <>
          <div className="podcast-programs">
            {programs.map((program, index) => (
              <ProgramRow
                key={program.id || `program-${index}`}
                program={program}
                onPlay={() => void playProgram(program)}
              />
            ))}
          </div>

          {loadingMore && <Loading minHeight={80} label="正在加载更多节目…" />}
          {!loadingMore && hasMore && (
            <div className="row podcast-detail-more">
              <button type="button" className="btn" onClick={loadMore}>
                加载更多（剩余 {formatCount(total - programs.length)}）
              </button>
            </div>
          )}
        </>
      )}

      <CommentSection type={4} id={radioId} title="电台评论" />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ProgramRow({
  program,
  onPlay,
}: {
  program: DjProgram
  onPlay: () => void
}): ReactNode {
  const [full, setFull] = useState<DjProgram | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const desc = pickDescribe(full?.description ?? program.description)
  const radioName = program.radio?.name

  // 列表里的 description 常被截断，展开时再拉一次节目详情
  const toggleExpand = async (): Promise<void> => {
    if (expanded) {
      setExpanded(false)
      return
    }
    if (!full && program.id) {
      setDetailLoading(true)
      try {
        const body = await api<{ program?: DjProgram }>('dj_program_detail', {
          id: program.id,
        })
        setFull(body?.program ?? null)
      } catch (error) {
        toast.fromError(error, '节目详情加载失败')
      } finally {
        setDetailLoading(false)
      }
    }
    setExpanded(true)
  }

  return (
    <div className="podcast-row" onClick={onPlay}>
      <Cover src={imageUrl(program.coverUrl, 160)} size={64} radius={8} />
      <div className="podcast-row-main">
        <div className="podcast-row-title ellipsis">{program.name}</div>
        <div
          className={
            expanded ? 'podcast-row-desc expanded' : 'podcast-row-desc'
          }
        >
          {desc ? (expanded ? desc : truncate(desc, 80)) : '暂无节目简介'}
        </div>
        <div className="podcast-row-meta">
          {program.createTime ? (
            <span>{formatRelativeTime(program.createTime)}</span>
          ) : null}
          {program.listenerCount ? (
            <span>
              <Icon name="play" size={11} />{' '}
              {formatCount(program.listenerCount)}
            </span>
          ) : null}
          {program.commentCount ? (
            <span>
              <Icon name="comment" size={11} />{' '}
              {formatCount(program.commentCount)}
            </span>
          ) : null}
          {radioName ? (
            <span className="podcast-row-radio">{radioName}</span>
          ) : null}
        </div>
      </div>
      <div className="podcast-row-side">
        {program.duration ? (
          <span className="podcast-row-time">
            {formatDuration(program.duration)}
          </span>
        ) : null}
        <button
          type="button"
          className="text-btn"
          disabled={detailLoading}
          onClick={(event) => {
            event.stopPropagation()
            void toggleExpand()
          }}
        >
          {detailLoading ? '加载中…' : expanded ? '收起简介' : '展开简介'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={(event) => {
            event.stopPropagation()
            onPlay()
          }}
        >
          <Icon name="play" size={13} /> 播放
        </button>
      </div>
    </div>
  )
}
