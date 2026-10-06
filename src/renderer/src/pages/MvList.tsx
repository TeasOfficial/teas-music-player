import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import clsx from 'clsx'
import type { Mv } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Empty, Loading, Tabs, type TabItem } from '@/components/ui/Primitives'
import { GridContainer, MvCard } from '@/components/cards'
import { usePaged, useReachBottom } from '@/lib/hooks'
import { api, apiCached } from '@/lib/api'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'
import './MvList.css'

type MvTab = 'all' | 'top' | 'mine'

const PAGE_SIZE = 30

/** mv_all 的 area 取值（不填/全部 均为全部）；top_mv 用空串表示全部 */
const AREAS = ['全部', '内地', '港台', '欧美', '日本', '韩国'] as const

const TABS: TabItem<MvTab>[] = [
  { value: 'all', label: '全部 MV' },
  { value: 'top', label: '排行榜' },
  { value: 'mine', label: '我的收藏' },
]

/** 上游老数据仍是 http 封面，CSP 的 img-src 只放行 https */
function secureMv(mv: Mv): Mv {
  const fix = (url?: string): string | undefined =>
    url?.replace(/^http:\/\//, 'https://')
  return { ...mv, cover: fix(mv.cover), picUrl: fix(mv.picUrl) }
}

export default function MvList(): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)

  const [tab, setTab] = useState<MvTab>('all')
  const [area, setArea] = useState<string>('全部')

  const pageRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)

  const paged = usePaged<Mv>(
    async (offset) => {
      // 未登录时「我的收藏」不发请求，直接给空列表由页面提示去登录
      if (tab === 'mine' && !loggedIn) return { items: [], total: 0 }

      if (tab === 'mine') {
        const body = await api<{ data?: Mv[]; hasMore?: boolean }>(
          'mv_sublist',
          {
            limit: PAGE_SIZE,
            offset,
          },
        )
        const items = body.data ?? []
        return {
          items,
          total: body.hasMore
            ? offset + items.length + PAGE_SIZE
            : offset + items.length,
        }
      }

      if (tab === 'top') {
        const body = await api<{ data?: Mv[]; hasMore?: boolean }>('top_mv', {
          area: area === '全部' ? '' : area,
          limit: PAGE_SIZE,
          offset,
        })
        const items = body.data ?? []
        return {
          items,
          total: body.hasMore
            ? offset + items.length + PAGE_SIZE
            : offset + items.length,
        }
      }

      const body = await apiCached<{ data?: Mv[]; count?: number }>(
        'mv_all',
        { area, limit: PAGE_SIZE, offset },
        30_000,
      )
      const items = body.data ?? []
      return { items, total: body.count ?? offset + items.length }
    },
    [tab, area, loggedIn],
    PAGE_SIZE,
  )

  // .page 自身不滚动，真正滚动的是外层 .app-main，先把它交给 useReachBottom
  useEffect(() => {
    scrollerRef.current =
      (pageRef.current?.closest('.app-main') as
        HTMLElement | null | undefined) ?? null
  }, [])

  useReachBottom(scrollerRef, () => paged.loadMore(), paged.hasMore)

  useEffect(() => {
    if (paged.error) toast.fromError(paged.error, '视频列表加载失败')
  }, [paged.error])

  return (
    <div className="page" ref={pageRef}>
      <div className="mv-toolbar">
        <Tabs items={TABS} value={tab} onChange={setTab} />
        <div className="row gap-8">
          <span className="f-12 muted">
            {paged.loading ? '加载中…' : `已加载 ${paged.items.length} 个`}
          </span>
          <button
            type="button"
            className="icon-btn"
            title="刷新"
            onClick={() => paged.reset()}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </div>

      {tab !== 'mine' && (
        <div className="filter-row">
          {AREAS.map((item) => (
            <span
              key={item}
              className={clsx('chip', area === item && 'chip-active')}
              onClick={() => setArea(item)}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {tab === 'mine' && !loggedIn ? (
        <Empty
          icon="video"
          title="登录后查看收藏的视频"
          description="收藏过的 MV 会出现在这里"
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
      ) : paged.loading ? (
        <Loading minHeight={280} label="正在加载视频…" />
      ) : paged.error ? (
        <Empty
          icon="info"
          title={paged.error.message}
          action={
            <button type="button" className="btn" onClick={() => paged.reset()}>
              重试
            </button>
          }
        />
      ) : paged.items.length === 0 ? (
        <Empty
          icon="video"
          title={tab === 'mine' ? '还没有收藏的视频' : '这里还没有视频'}
          description={
            tab === 'mine' ? '在 MV 播放页点击收藏即可添加' : undefined
          }
        />
      ) : (
        <>
          <GridContainer>
            {paged.items.map((mv) => (
              <MvCard
                key={String(mv.id)}
                mv={secureMv(mv)}
                onPlay={() => navigate(`/mv/${mv.id}`)}
              />
            ))}
          </GridContainer>

          {paged.hasMore && (
            <div
              className="row"
              style={{ justifyContent: 'center', padding: '18px 0' }}
            >
              <button
                type="button"
                className="btn"
                disabled={paged.loadingMore}
                onClick={() => paged.loadMore()}
              >
                {paged.loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
