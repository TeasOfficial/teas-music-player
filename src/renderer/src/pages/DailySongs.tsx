import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import type { Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Empty, Loading } from '@/components/ui/Primitives'
import { openContextMenu } from '@/components/ui/ContextMenu'
import { SongTable } from '@/components/song/SongTable'
import { batchActions } from '@/components/song/songActions'
import { api } from '@/lib/api'
import { useAsync } from '@/lib/hooks'
import { useAuthStore } from '@/store/auth'
import { useDownloadStore } from '@/store/download'
import { usePlayerStore, type PlayContext } from '@/store/player'
import { toast } from '@/store/toast'
import './DailySongs.css'

/** 推荐理由：接口只给 songId，需要回查歌名 */
interface RecommendReason {
  songId?: number
  reason?: string
  reasonId?: string
}

/** 不同上游版本会把结果放在 data 下或直接平铺，两种层级都兜底 */
interface DailyBody {
  data?: {
    dailySongs?: Song[]
    orderSongs?: Song[]
    recommendReasons?: RecommendReason[]
    mvResourceInfos?: unknown
  }
  dailySongs?: Song[]
  recommendReasons?: RecommendReason[]
}

function todayLabel(): string {
  const now = new Date()
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
    now.getDay()
  ]
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${week}`
}

export default function DailySongs(): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const playSongs = usePlayerStore((state) => state.playSongs)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const startBatch = useDownloadStore((state) => state.startBatch)

  const [showReasons, setShowReasons] = useState(false)

  const { data, loading, error, reload } = useAsync(async () => {
    const body = await api<DailyBody>('recommend_songs', {})
    return {
      songs: body.data?.dailySongs ?? body.dailySongs ?? [],
      reasons: body.data?.recommendReasons ?? body.recommendReasons ?? [],
    }
  }, [])

  // 未登录时接口必然失败，这种情况交给空状态引导登录，不再重复弹提示
  useEffect(() => {
    if (error && loggedIn) toast.fromError(error, '每日推荐加载失败')
  }, [error, loggedIn])

  const songs = data?.songs ?? []
  const reasons = useMemo(
    () =>
      (data?.reasons ?? []).filter((item) => item.reason && item.reason.trim()),
    [data],
  )
  const songMap = useMemo(
    () => new Map(songs.map((song) => [song.id, song])),
    [songs],
  )

  const context: PlayContext = { type: 'daily', name: '每日推荐' }

  if (!loggedIn) {
    return (
      <div className="page">
        <Empty
          icon="calendar"
          title="登录后查看每日推荐"
          description="每日推荐会根据你的听歌口味生成，每天早上 6:00 更新"
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

  if (loading) return <Loading minHeight={420} label="正在为你生成每日推荐…" />

  if (error && songs.length === 0) {
    return (
      <div className="page">
        <Empty
          icon="info"
          title="每日推荐加载失败"
          description={error.message}
          action={
            <button type="button" className="btn btn-primary" onClick={reload}>
              重新加载
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="daily-head">
        <div className="daily-head-icon">
          <Icon name="calendar" size={32} />
        </div>
        <div className="col gap-4">
          <h1 className="f-24">每日推荐</h1>
          <span className="muted f-12">
            {todayLabel()} · 共 {songs.length} 首
          </span>
        </div>
        <div className="spacer" />
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
          <button
            type="button"
            className="btn"
            disabled={songs.length === 0}
            onClick={(event) => openContextMenu(event, batchActions(songs))}
          >
            <Icon name="more" size={15} /> 更多
          </button>
        </div>
      </div>

      <SongTable
        songs={songs}
        context={context}
        emptyText="今天还没有推荐，稍后再来吧"
      />

      {/* 推荐理由放在列表下方（不改动 SongTable，保持组件职责单一） */}
      {reasons.length > 0 && (
        <div className="daily-reasons">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="f-14 bold">推荐理由</span>
            <button
              type="button"
              className="text-btn"
              onClick={() => setShowReasons((value) => !value)}
            >
              {showReasons ? '收起' : `展开（${reasons.length}）`}
              <Icon
                name={showReasons ? 'chevron-up' : 'chevron-down'}
                size={14}
              />
            </button>
          </div>

          {showReasons && (
            <div className="daily-reason-list">
              {reasons.map((item, index) => (
                <div
                  className="daily-reason-item"
                  key={`${item.reasonId ?? item.songId ?? index}`}
                >
                  <span
                    className="daily-reason-title ellipsis"
                    title={songMap.get(item.songId ?? -1)?.name}
                  >
                    {songMap.get(item.songId ?? -1)?.name ??
                      `歌曲 ${item.songId ?? index + 1}`}
                  </span>
                  <span className="daily-reason-text">{item.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
