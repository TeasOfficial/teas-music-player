import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import type { Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Empty, Loading, Modal } from '@/components/ui/Primitives'
import { SongTable } from '@/components/song/SongTable'
import { api } from '@/lib/api'
import { usePaged, useReachBottom } from '@/lib/hooks'
import { useAuthStore } from '@/store/auth'
import { usePlayerStore, type PlayContext } from '@/store/player'
import { toast } from '@/store/toast'
import './Cloud.css'

const PAGE_SIZE = 100

/** 云盘条目：旧版直接返回歌曲，新版可能把歌曲塞在 simpleSong 里并附带上传者信息 */
interface CloudEntry extends Song {
  simpleSong?: Song
}

interface CloudBody {
  data?: Song[] | { list?: Song[]; count?: number; hasMore?: boolean }
  count?: number
  hasMore?: boolean
}

/** 取出真正的歌曲对象，兼容 simpleSong 形态（缺少 id/name 时才回退） */
function toSong(entry: CloudEntry | undefined | null): Song | null {
  if (!entry) return null
  if (entry.id && entry.name) return entry
  const simple = entry.simpleSong
  if (simple?.id && simple.name) return { ...simple, pc: entry.pc ?? simple.pc }
  return null
}

function normalizeCloud(body: CloudBody): { items: Song[]; total: number } {
  const payload = body.data
  const list = Array.isArray(payload) ? payload : (payload?.list ?? [])
  const items = list
    .map((entry) => toSong(entry as CloudEntry))
    .filter((song): song is Song => !!song)
  const count =
    body.count ?? (Array.isArray(payload) ? undefined : payload?.count)
  const hasMore =
    body.hasMore ?? (Array.isArray(payload) ? undefined : payload?.hasMore)
  // count 缺失时用 hasMore 兜底，保证 usePaged 的「还有下一页」判定仍然成立
  const total = count ?? (hasMore ? items.length + PAGE_SIZE : items.length)
  return { items, total }
}

export default function Cloud(): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const playSongs = usePlayerStore((state) => state.playSongs)

  const [removed, setRemoved] = useState<Set<number>>(() => new Set())
  const [pending, setPending] = useState<Song | null>(null)
  const [deleting, setDeleting] = useState(false)

  const {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    reset,
  } = usePaged<Song>(
    async (offset) => {
      const body = await api<CloudBody>('user_cloud', {
        limit: PAGE_SIZE,
        offset,
      })
      return normalizeCloud(body)
    },
    [loggedIn],
    PAGE_SIZE,
  )

  // 已删除的歌在本地过滤掉即可，不必重置分页从头再拉一遍
  const songs = useMemo(
    () => items.filter((song) => !removed.has(song.id)),
    [items, removed],
  )
  const visibleTotal = Math.max(0, total - removed.size)

  // .app-main 才是项目真正的滚动容器，这里直接引用它做触底监听，
  // 避免在页面里再套一层滚动区域导致高度计算和样式失效
  const scrollerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    scrollerRef.current = document.querySelector<HTMLElement>('.app-main')
  }, [])

  useReachBottom(
    scrollerRef,
    () => {
      if (hasMore && !loading && !loadingMore) loadMore()
    },
    loggedIn && hasMore && !loading && !loadingMore,
  )

  useEffect(() => {
    if (error && loggedIn) toast.fromError(error, '云盘加载失败')
  }, [error, loggedIn])

  const context: PlayContext = { type: 'cloud', name: '我的音乐云盘' }

  const confirmDelete = async (): Promise<void> => {
    if (!pending) return
    const target = pending
    setDeleting(true)
    try {
      await api('user_cloud_del', { id: target.id })
      setRemoved((previous) => new Set(previous).add(target.id))
      setPending(null)
      toast.success(`已从云盘删除《${target.name}》`)
    } catch (error) {
      toast.fromError(error, '删除云盘歌曲失败')
    } finally {
      setDeleting(false)
    }
  }

  if (!loggedIn) {
    return (
      <div className="page">
        <Empty
          icon="cloud"
          title="登录后查看我的音乐云盘"
          description="云盘里的歌曲可以在任意设备播放，也会同步到手机端"
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

  if (loading) return <Loading minHeight={420} label="正在加载云盘…" />

  if (error && items.length === 0) {
    return (
      <div className="page">
        <Empty
          icon="info"
          title="云盘加载失败"
          description={error.message}
          action={
            <button type="button" className="btn btn-primary" onClick={reset}>
              重新加载
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="cloud-head">
        <div className="cloud-head-icon">
          <Icon name="cloud" size={32} />
        </div>
        <div className="col gap-4">
          <h1 className="f-24">我的音乐云盘</h1>
          <span className="muted f-12">
            共 {visibleTotal} 首 · 支持在线播放与删除，上传请使用网页版
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
            onClick={() =>
              toast.info('桌面端暂不支持上传，请在网页版上传后同步')
            }
          >
            <Icon name="arrow-up" size={15} /> 上传
          </button>
        </div>
      </div>

      <div className="cloud-tip muted f-12">
        云盘歌曲占用云盘容量，删除后不可恢复；已匹配的歌曲会显示原曲信息
      </div>

      <SongTable
        songs={songs}
        context={context}
        emptyText="云盘里还没有歌曲，去网页版上传吧"
        onRemove={(index) => setPending(songs[index] ?? null)}
        removeLabel="从云盘删除"
      />

      {loadingMore && <Loading minHeight={80} label="正在加载更多…" />}

      {!loadingMore && hasMore && songs.length > 0 && (
        <div
          className="row"
          style={{ justifyContent: 'center', padding: '16px 0' }}
        >
          <button type="button" className="btn" onClick={loadMore}>
            加载更多
          </button>
        </div>
      )}

      {!loadingMore && !hasMore && songs.length > 0 && (
        <div
          className="row"
          style={{ justifyContent: 'center', padding: '16px 0' }}
        >
          <span className="muted f-12">已经到底了</span>
        </div>
      )}

      <Modal
        open={!!pending}
        title="从云盘删除"
        onClose={() => {
          if (!deleting) setPending(null)
        }}
        footer={
          <>
            <button
              type="button"
              className="btn"
              disabled={deleting}
              onClick={() => setPending(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <div className="col gap-8">
          <span className="f-14">
            确定要从云盘删除《{pending?.name ?? ''}》吗？
          </span>
          <span className="muted f-12">
            删除会同时移除云盘上的文件且不可恢复
            {pending?.pc?.nickname ? `，上传者：${pending.pc.nickname}` : ''}
          </span>
        </div>
      </Modal>
    </div>
  )
}
