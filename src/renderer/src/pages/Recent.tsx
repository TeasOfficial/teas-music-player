import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import type { Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Empty, Loading, Modal, Tabs } from '@/components/ui/Primitives'
import { SongTable } from '@/components/song/SongTable'
import { api } from '@/lib/api'
import { normalizeSong } from '@/lib/normalize'
import { useAsync } from '@/lib/hooks'
import { useAuthStore } from '@/store/auth'
import { usePlayerStore, type PlayContext } from '@/store/player'
import { toast } from '@/store/toast'
import './Recent.css'

type RecentTab = 'cloud' | 'local'

interface RecentRecord {
  song?: Song
  playCount?: number
  resourceType?: string
}

/** 上游可能把列表放在 data 下、直接放在 data 里，或整体平铺，几种层级都兜底 */
interface RecentBody {
  data?: { list?: RecentRecord[]; total?: number } | RecentRecord[]
  list?: RecentRecord[]
  total?: number
}

interface NormalizedRecords {
  songs: Song[]
  counts: Map<number, number>
  total: number
}

/** 兼容「记录包着 song」与「记录本身就是 song」两种形态 */
function normalizeRecords(body: RecentBody): NormalizedRecords {
  const payload = body.data
  const list = Array.isArray(payload)
    ? payload
    : (payload?.list ?? body.list ?? [])
  const rawTotal = Array.isArray(payload)
    ? undefined
    : (payload?.total ?? body.total)
  const songs: Song[] = []
  const counts = new Map<number, number>()
  for (const item of list) {
    const song = normalizeSong(item) ?? (item as Song | undefined)
    if (!song?.id) continue
    songs.push(song)
    counts.set(song.id, item?.playCount ?? 0)
  }
  return { songs, counts, total: rawTotal ?? songs.length }
}

export default function Recent(): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const history = usePlayerStore((state) => state.history)
  const playSongs = usePlayerStore((state) => state.playSongs)

  const [tab, setTab] = useState<RecentTab>('cloud')
  const [showCounts, setShowCounts] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const { data, loading, error, reload } = useAsync(async () => {
    if (!loggedIn)
      return {
        songs: [] as Song[],
        counts: new Map<number, number>(),
        total: 0,
      }
    const body = await api<RecentBody>('record_recent_song', { limit: 100 })
    return normalizeRecords(body)
  }, [loggedIn])

  // 云端记录失败（未登录 / 接口受限）时降级到本机历史，保证页面仍有内容
  useEffect(() => {
    if (!error) return
    setTab('local')
    toast.fromError(error, '云端播放记录获取失败，已切换到本机历史')
  }, [error])

  const cloudSongs = data?.songs ?? []
  const counts = data?.counts ?? new Map<number, number>()
  const list = tab === 'cloud' ? cloudSongs : history

  const context = useMemo<PlayContext>(
    () =>
      tab === 'cloud'
        ? { type: 'playlist', name: '最近播放（云端）' }
        : { type: 'playlist', name: '最近播放（本机）' },
    [tab],
  )

  const clearHistory = (): void => {
    // 只清本机历史：store 与 localStorage 同步清掉，避免下次启动又被读回来
    usePlayerStore.setState({ history: [] })
    window.localStorage.removeItem('ncm.playHistory')
    setConfirmClear(false)
    toast.success('已清空本机播放历史')
  }

  return (
    <div className="page">
      <div className="recent-head">
        <div className="recent-head-icon">
          <Icon name="clock" size={32} />
        </div>
        <div className="col gap-4">
          <h1 className="f-24">最近播放</h1>
          <span className="muted f-12">
            {tab === 'cloud'
              ? `云端记录 ${cloudSongs.length} 首`
              : `本机历史 ${history.length} 首，最多保留 120 首`}
          </span>
        </div>
        <div className="spacer" />
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={list.length === 0}
            onClick={() => void playSongs(list, 0, context)}
          >
            <Icon name="play" size={15} /> 播放全部
          </button>
          <button
            type="button"
            className="btn"
            disabled={history.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Icon name="trash" size={15} /> 清空本机历史
          </button>
        </div>
      </div>

      <div className="recent-toolbar">
        <Tabs
          items={[
            { value: 'cloud', label: '云端记录' },
            { value: 'local', label: '本机历史' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as RecentTab)}
        />
        <div className="spacer" />
        {tab === 'cloud' && cloudSongs.length > 0 && (
          <button
            type="button"
            className="text-btn"
            onClick={() => setShowCounts((value) => !value)}
          >
            <Icon name={showCounts ? 'chevron-up' : 'chevron-down'} size={14} />
            播放次数明细
          </button>
        )}
      </div>

      {error && tab === 'local' && (
        <div className="recent-fallback muted f-12">
          云端记录不可用，当前显示本机播放历史
        </div>
      )}

      {tab === 'cloud' && !loggedIn ? (
        <Empty
          icon="user"
          title="登录后查看云端播放记录"
          description="云端记录会同步你在手机、网页端的播放历史"
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
      ) : tab === 'cloud' && loading ? (
        <Loading minHeight={280} label="正在加载云端播放记录…" />
      ) : tab === 'cloud' && error && cloudSongs.length === 0 ? (
        <Empty
          icon="info"
          title="云端播放记录加载失败"
          description={error.message}
          action={
            <button type="button" className="btn btn-primary" onClick={reload}>
              重新加载
            </button>
          }
        />
      ) : (
        <>
          {/* SongTable 不开放额外列，播放次数改用可展开的明细展示 */}
          {tab === 'cloud' && showCounts && cloudSongs.length > 0 && (
            <div className="recent-counts">
              {cloudSongs.map((song, index) => (
                <div className="recent-count-row" key={`${song.id}-${index}`}>
                  <span className="ellipsis">
                    {index + 1}. {song.name}
                  </span>
                  <span className="muted f-12">
                    {counts.get(song.id) ?? 0} 次
                  </span>
                </div>
              ))}
            </div>
          )}

          <SongTable
            songs={list}
            context={context}
            emptyText={
              tab === 'cloud' ? '云端还没有播放记录' : '本机还没有播放记录'
            }
          />
        </>
      )}

      <Modal
        open={confirmClear}
        title="清空本机历史"
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmClear(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={clearHistory}
            >
              确认清空
            </button>
          </>
        }
      >
        <span className="f-14">
          将删除本机记录的 {history.length} 条播放历史，不影响云端的播放记录。
        </span>
      </Modal>
    </div>
  )
}
