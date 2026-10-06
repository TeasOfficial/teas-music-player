import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import type { DjProgram, DjRadio } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  Cover,
  Empty,
  Loading,
  SectionHeader,
} from '@/components/ui/Primitives'
import { GridContainer, RadioCard } from '@/components/cards'
import { api, apiCached } from '@/lib/api'
import { normalizeDjPrograms } from '@/lib/normalize'
import { formatCount, formatDuration, imageUrl, truncate } from '@/lib/format'
import { usePlayerStore } from '@/store/player'
import { toast } from '@/store/toast'
import './Podcast.css'

const HOT_PAGE_SIZE = 30

/* 上游对同类资源会返回 djRadios / data / 裸数组几种形状，统一做兜底 */

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function pickRadioList(body: unknown): DjRadio[] {
  if (Array.isArray(body)) return body as DjRadio[]
  const record = asRecord(body)
  if (!record) return []
  if (Array.isArray(record.djRadios)) return record.djRadios as DjRadio[]
  const data = asRecord(record.data)
  if (Array.isArray(data?.djRadios)) return data.djRadios as DjRadio[]
  return []
}

function pickRadioTotal(body: unknown, fallback: number): number {
  const record = asRecord(body)
  const data = asRecord(record?.data)
  const count = record?.count ?? data?.count
  return typeof count === 'number' && count >= 0 ? count : fallback
}

function pickPrograms(body: unknown): DjProgram[] {
  const record = asRecord(body)
  if (!record) return []
  // personalized_djprogram 的每一项是 { id, name, picUrl, program: {...} }，
  // 直接当 DjProgram 用会丢掉 mainSong 与 radio，表现为「点了播放没反应」
  return normalizeDjPrograms(record.result ?? record.data ?? record.programs)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function pickDescribe(value?: string): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text ? text : undefined
}

interface Category {
  id: number
  name: string
}

interface HotState {
  items: DjRadio[]
  total: number
  loading: boolean
  loadingMore: boolean
  /** 拉取失败时停止滚动续拉，避免每次触底都重试 */
  failed: boolean
}

const EMPTY_HOT: HotState = {
  items: [],
  total: 0,
  loading: true,
  loadingMore: false,
  failed: false,
}

/** 热门电台分页：按索引换页并推算总数（部分返回不带 count） */
async function fetchRadioPage(
  offset: number,
  loader: (offset: number, limit: number) => Promise<unknown>,
): Promise<{ items: DjRadio[]; total: number }> {
  const body = await loader(offset, HOT_PAGE_SIZE)
  const items = pickRadioList(body)
  const hasMore = !!(body as Record<string, unknown> | null)?.hasMore
  const total = pickRadioTotal(
    body,
    hasMore ? offset + items.length + HOT_PAGE_SIZE : offset + items.length,
  )
  return { items, total: Math.max(total, offset + items.length) }
}

export default function Podcast(): ReactNode {
  const navigate = useAppNavigate()
  const coverRef = useRef<HTMLDivElement | null>(null)
  const hotRef = useRef<HotState>(EMPTY_HOT)
  const categoryRequestRef = useRef(0)

  const [categories, setCategories] = useState<Category[]>([])
  const [hot, setHot] = useState<HotState>(EMPTY_HOT)
  const [recommended, setRecommended] = useState<DjRadio[]>([])
  const [programs, setPrograms] = useState<DjProgram[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [categoryRadios, setCategoryRadios] = useState<DjRadio[]>([])
  const [categoryLoading, setCategoryLoading] = useState(false)

  hotRef.current = hot

  const play = useCallback(async (program: DjProgram): Promise<void> => {
    const song = program.mainSong
    if (!song?.id) {
      toast.info('该节目暂无可播放的音频')
      return
    }
    await usePlayerStore.getState().playSongs([song], 0, {
      type: 'radio',
      id: program.radio?.id,
      name: program.radio?.name ?? program.name,
    })
  }, [])

  /* ---------------- 热门电台：分页 ---------------- */

  const loadHot = useCallback(async (reset: boolean): Promise<void> => {
    const previous = hotRef.current
    if (!reset && (previous.failed || previous.items.length >= previous.total))
      return
    setHot((state) =>
      reset
        ? { ...state, items: [], total: 0, loading: true, failed: false }
        : { ...state, loadingMore: true },
    )
    try {
      const offset = reset ? 0 : previous.items.length
      // 热门电台用 api 而非 apiCached：分页结果不必缓存
      const page = await fetchRadioPage(offset, (next, limit) => {
        return api('dj_hot', { limit, offset: next })
      })
      setHot((state) => ({
        items: reset ? page.items : [...state.items, ...page.items],
        total: page.total,
        loading: false,
        loadingMore: false,
        failed: false,
      }))
    } catch (error) {
      setHot((state) => ({
        ...state,
        loading: false,
        loadingMore: false,
        failed: true,
      }))
      toast.fromError(error, reset ? '热门电台加载失败' : '加载更多电台失败')
    }
  }, [])

  /* ---------------- 首次进入：各区块并行加载 ---------------- */

  useEffect(() => {
    let cancelled = false

    void loadHot(true)

    // 分类列表失败不影响热门电台，按需降级为不显示分类
    apiCached<{ categories?: Category[] }>('dj_catelist', {})
      .then((body) => {
        if (!cancelled) setCategories(toArray<Category>(body.categories))
      })
      .catch(() => {
        if (!cancelled) setCategories([])
      })

    apiCached('dj_recommend', {})
      .then((body) => {
        if (!cancelled) setRecommended(pickRadioList(body))
      })
      .catch(() => {
        if (!cancelled) setRecommended([])
      })

    apiCached<{ result?: DjProgram[] }>('personalized_djprogram', { limit: 12 })
      .then((body) => {
        if (!cancelled) setPrograms(pickPrograms(body))
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.fromError(error, '推荐节目加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [loadHot])

  /* ---------------- 分类电台 ---------------- */

  const loadCategory = useCallback(
    async (category: Category): Promise<void> => {
      const requestId = ++categoryRequestRef.current
      setCategoryLoading(true)
      try {
        // dj_category_recommend 源码未透传 cateId，返回为空时用 dj_hot 按分类兜底
        const body = await apiCached('dj_category_recommend', {
          cateId: category.id,
          limit: 30,
        })
        let items = pickRadioList(body)
        if (items.length === 0) {
          const fallback = await apiCached(
            'dj_hot',
            { cateId: category.id, limit: 30, offset: 0 },
            0,
          )
          items = pickRadioList(fallback)
        }
        if (requestId !== categoryRequestRef.current) return
        setCategoryRadios(items)
        if (items.length === 0) toast.info(`「${category.name}」暂无可用电台`)
      } catch (error) {
        if (requestId !== categoryRequestRef.current) return
        setCategoryRadios([])
        toast.fromError(error, '分类电台加载失败')
      } finally {
        if (requestId === categoryRequestRef.current) setCategoryLoading(false)
      }
    },
    [],
  )

  const handleCategoryClick = useCallback(
    (category: Category): void => {
      setCategoryId(category.id)
      setCategoryRadios([])
      void loadCategory(category)
    },
    [loadCategory],
  )

  /* ---------------- 触底加载更多热门电台 ---------------- */

  // 真正的滚动容器是 .app-main（.page 自身不滚动），沿用 PlaylistDetail 的做法
  const loadMoreRef = useRef<() => void>(() => undefined)
  loadMoreRef.current = () => {
    const current = hotRef.current
    if (current.failed || current.loading || current.loadingMore) return
    if (current.items.length >= current.total) return
    void loadHot(false)
  }

  useEffect(() => {
    const element = coverRef.current?.closest('.app-main')
    if (!element) return
    const handler = (): void => {
      const remain =
        element.scrollHeight - element.scrollTop - element.clientHeight
      if (remain < 400) loadMoreRef.current()
    }
    element.addEventListener('scroll', handler, { passive: true })
    return () => element.removeEventListener('scroll', handler)
  }, [loading])

  const activeCategory = categories.find(
    (category) => category.id === categoryId,
  )

  return (
    <div className="page" ref={coverRef}>
      <div className="podcast-head">
        <span className="podcast-head-icon">
          <Icon name="radio" size={22} />
        </span>
        <div className="col">
          <span className="f-24 bold">播客电台</span>
          <span className="f-12 muted">
            精选电台与热门节目，点击节目即可收听
          </span>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="filter-row podcast-cates">
          <span
            className={categoryId === null ? 'chip chip-active' : 'chip'}
            onClick={() => setCategoryId(null)}
          >
            全部
          </span>
          {categories.map((category) => (
            <span
              key={category.id}
              className={
                category.id === categoryId ? 'chip chip-active' : 'chip'
              }
              onClick={() => handleCategoryClick(category)}
            >
              {category.name}
            </span>
          ))}
        </div>
      )}

      {activeCategory && (
        <>
          <SectionHeader
            title={`${activeCategory.name} · 电台`}
            icon="radio"
            extra={
              <span className="text-btn" onClick={() => setCategoryId(null)}>
                收起
              </span>
            }
          />
          {categoryLoading ? (
            <Loading minHeight={220} label="正在加载分类电台…" />
          ) : categoryRadios.length === 0 ? (
            <Empty icon="radio" title="该分类下暂时没有电台" minHeight={200} />
          ) : (
            <GridContainer>
              {categoryRadios.map((radio) => (
                <RadioCard key={radio.id} radio={radio} />
              ))}
            </GridContainer>
          )}
        </>
      )}

      <SectionHeader
        title="热门电台"
        icon="radio"
        subtitle={`共 ${formatCount(hot.total)} 个`}
      />
      {hot.loading ? (
        <Loading minHeight={260} label="正在加载热门电台…" />
      ) : hot.items.length === 0 ? (
        <Empty
          icon="radio"
          title="暂时没有热门电台"
          description="可能是网络异常或上游接口限流，稍后重试"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void loadHot(true)}
            >
              重新加载
            </button>
          }
        />
      ) : (
        <>
          <GridContainer>
            {hot.items.map((radio) => (
              <RadioCard key={radio.id} radio={radio} />
            ))}
          </GridContainer>
          {hot.loadingMore && (
            <Loading minHeight={80} label="正在加载更多电台…" />
          )}
          {!hot.loadingMore && hot.failed && (
            <div className="row podcast-more">
              <button
                type="button"
                className="btn"
                onClick={() => void loadHot(false)}
              >
                加载失败，点击重试
              </button>
            </div>
          )}
          {!hot.loadingMore && !hot.failed && hot.items.length < hot.total && (
            <div className="row podcast-more">
              <button
                type="button"
                className="btn"
                onClick={() => void loadHot(false)}
              >
                加载更多（剩余 {formatCount(hot.total - hot.items.length)}）
              </button>
            </div>
          )}
        </>
      )}

      <SectionHeader
        title="推荐节目"
        icon="mic"
        subtitle={programs.length > 0 ? `${programs.length} 期` : undefined}
      />
      {loading ? (
        <Loading minHeight={200} label="正在加载推荐节目…" />
      ) : programs.length === 0 ? (
        <Empty icon="mic" title="暂时没有推荐节目" minHeight={160} />
      ) : (
        <div className="podcast-programs">
          {programs.map((program, index) => (
            <ProgramRow
              key={program.id || `program-${index}`}
              program={program}
              onPlay={() => void play(program)}
            />
          ))}
        </div>
      )}

      {recommended.length > 0 && (
        <>
          <SectionHeader
            title="推荐电台"
            icon="disc"
            onMore={() => navigate('/podcast')}
          />
          <GridContainer>
            {recommended.map((radio) => (
              <RadioCard key={radio.id} radio={radio} />
            ))}
          </GridContainer>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** 推荐节目行：点击任意位置播放 mainSong */
function ProgramRow({
  program,
  onPlay,
}: {
  program: DjProgram
  onPlay: () => void
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const desc = pickDescribe(program.description)
  const radioName = program.radio?.name
  // 简介过长时折叠，展开用本地状态控制
  const long = !!desc && desc.length > 90

  return (
    <div className="podcast-row" onClick={onPlay}>
      <Cover src={imageUrl(program.coverUrl, 160)} size={64} radius={8} />
      <div className="podcast-row-main">
        <div className="podcast-row-title ellipsis">{program.name}</div>
        <div className="podcast-row-desc">
          {radioName && <span className="podcast-row-radio">{radioName}</span>}
          {desc ? (expanded ? desc : truncate(desc, 90)) : '暂无节目简介'}
        </div>
        <div className="podcast-row-meta">
          {program.duration ? (
            <span>{formatDuration(program.duration)}</span>
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
        </div>
      </div>
      <div className="podcast-row-side">
        {long && (
          <span
            className="text-btn"
            onClick={(event) => {
              event.stopPropagation()
              setExpanded((value) => !value)
            }}
          >
            {expanded ? '收起简介' : '展开简介'}
          </span>
        )}
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
