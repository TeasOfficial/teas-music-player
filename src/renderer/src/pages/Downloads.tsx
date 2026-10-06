import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import clsx from 'clsx'
import type { DownloadTask, Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  Cover,
  Empty,
  IconButton,
  Loading,
  Modal,
} from '@/components/ui/Primitives'
import { QUALITY_LABEL } from '@/lib/constants'
import {
  formatBytes,
  formatRelativeTime,
  formatSpeed,
  imageUrl,
} from '@/lib/format'
import { useDownloadStore } from '@/store/download'
import { usePlayerStore } from '@/store/player'
import { toast } from '@/store/toast'
import './Downloads.css'

/** 需要二次确认的破坏性动作 */
type ConfirmAction = { kind: 'clear' } | { kind: 'remove'; task: DownloadTask }

/**
 * 下载任务 → 播放器可用的 Song。
 * task.url 是主进程生成的 ncmfile:// 本地地址，配合 source: 'local'
 * 让播放器跳过 song_url_v1 直接使用该地址。
 */
function taskToSong(task: DownloadTask): Song {
  return {
    id: task.songId,
    name: task.name,
    ar: [{ id: 0, name: task.artist || '未知艺术家' }],
    al: { id: 0, name: task.album || '未知专辑', picUrl: task.coverUrl },
    dt: 0,
    source: 'local',
    url: task.url,
    localPath: task.filePath,
  }
}

/** progress 为 -1 表示总量未知，退化成已下载字节比例 */
function percentOf(task: DownloadTask): number {
  if (task.progress >= 0) return Math.min(100, task.progress)
  if (task.totalBytes > 0)
    return Math.min(100, (task.receivedBytes / task.totalBytes) * 100)
  return 0
}

/** 下载管理：查看任务进度、播放已完成的文件、维护本地文件 */
export default function Downloads(): ReactNode {
  const navigate = useAppNavigate()

  const tasks = useDownloadStore((state) => state.tasks)
  const loaded = useDownloadStore((state) => state.loaded)
  const cancel = useDownloadStore((state) => state.cancel)
  const remove = useDownloadStore((state) => state.remove)
  const clear = useDownloadStore((state) => state.clear)
  const reveal = useDownloadStore((state) => state.reveal)
  const open = useDownloadStore((state) => state.open)

  const playSongs = usePlayerStore((state) => state.playSongs)
  const currentSong = usePlayerStore((state) => state.queue[state.index])
  const playing = usePlayerStore((state) => state.playing)

  const [downloadDir, setDownloadDir] = useState('')
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  // 挂载时拉一次最新列表：离开页面期间可能错过了若干进度事件；目录只取一次
  useEffect(() => {
    void useDownloadStore.getState().refresh()
    void window.ncm.app
      .info()
      .then((info) => setDownloadDir(info.paths.download))
      .catch(() => undefined)
  }, [])

  const stats = useMemo(() => {
    const result = {
      downloading: 0,
      pending: 0,
      done: 0,
      failed: 0,
      canceled: 0,
    }
    for (const task of tasks) {
      if (task.status === 'downloading') result.downloading += 1
      else if (task.status === 'pending') result.pending += 1
      else if (task.status === 'done') result.done += 1
      else if (task.status === 'error') result.failed += 1
      else result.canceled += 1
    }
    return result
  }, [tasks])

  // 最新创建的任务排在最前
  const ordered = useMemo(
    () => [...tasks].sort((a, b) => b.createdAt - a.createdAt),
    [tasks],
  )

  const playTask = (task: DownloadTask): void => {
    const playable = ordered.filter(
      (item) => item.status === 'done' && item.url,
    )
    const index = playable.findIndex((item) => item.id === task.id)
    void playSongs(
      playable.map((item) => taskToSong(item)),
      index < 0 ? 0 : index,
      {
        type: 'download',
        name: '下载管理',
      },
    )
  }

  const cancelTask = (task: DownloadTask): void => {
    void cancel(task.id).catch((error: unknown) =>
      toast.fromError(error, '取消下载失败'),
    )
  }

  const removeTask = (task: DownloadTask): void => {
    void remove(task.id, false).catch((error: unknown) =>
      toast.fromError(error, '删除记录失败'),
    )
  }

  const clearRecords = async (): Promise<void> => {
    try {
      await clear(false)
      toast.success('已清空下载记录')
    } catch (error) {
      toast.fromError(error, '清空下载记录失败')
    }
  }

  // 提前取出待删除任务名：避免在 JSX 里对联合类型反复做可选链判断
  const confirmTaskName =
    confirm && confirm.kind === 'remove' ? confirm.task.name : ''

  const runConfirm = async (): Promise<void> => {
    const action = confirm
    setConfirm(null)
    if (!action) return
    try {
      if (action.kind === 'clear') {
        await clear(true)
        toast.success('已清空记录并删除文件')
      } else {
        await remove(action.task.id, true)
        toast.success('已删除记录与文件')
      }
    } catch (error) {
      toast.fromError(error, '删除失败')
    }
  }

  return (
    <div className="page">
      <div className="dl-head">
        <h1 className="f-24">下载管理</h1>
        <span className="muted f-12">下载完成的歌曲保存在本机，可直接播放</span>
      </div>

      <div className="dl-toolbar">
        <div className="dl-stats">
          <span className="dl-stat">
            <span className="dl-stat-value">{stats.downloading}</span>下载中
          </span>
          {stats.pending > 0 && (
            <span className="dl-stat">
              <span className="dl-stat-value">{stats.pending}</span>排队中
            </span>
          )}
          <span className="dl-stat">
            <span className="dl-stat-value">{stats.done}</span>已完成
          </span>
          <span
            className={clsx('dl-stat', stats.failed > 0 && 'dl-stat-danger')}
          >
            <span className="dl-stat-value">{stats.failed}</span>失败
          </span>
          {stats.canceled > 0 && (
            <span className="dl-stat">
              <span className="dl-stat-value">{stats.canceled}</span>已取消
            </span>
          )}
          <span className="dl-stat muted">共 {tasks.length} 条记录</span>
        </div>

        <div className="spacer" />

        <button
          type="button"
          className="btn"
          disabled={!downloadDir}
          onClick={() => void window.ncm.app.openPath(downloadDir)}
          title={downloadDir || '下载目录尚未就绪'}
        >
          <Icon name="folder-open" size={15} /> 打开下载目录
        </button>
        <button
          type="button"
          className="btn"
          disabled={tasks.length === 0}
          onClick={() => void clearRecords()}
        >
          <Icon name="trash" size={15} /> 清空记录
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={tasks.length === 0}
          onClick={() => setConfirm({ kind: 'clear' })}
        >
          清空记录并删除文件
        </button>
      </div>

      {!loaded ? (
        <Loading minHeight={320} label="正在读取下载记录…" />
      ) : tasks.length === 0 ? (
        <Empty
          icon="download"
          title="还没有下载过歌曲"
          description="在歌单、专辑或搜索结果里通过「下载」操作添加任务，进度会实时显示在这里"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/discover')}
            >
              去歌单页找歌
            </button>
          }
        />
      ) : (
        <div className="dl-table">
          <div className="dl-head-row">
            <div className="dl-col-title">歌曲</div>
            <div className="dl-col-quality">音质</div>
            <div className="dl-col-status">状态</div>
            <div className="dl-col-size">大小</div>
            <div className="dl-col-actions" />
          </div>

          <div className="dl-body">
            {ordered.map((task) => {
              const isCurrent =
                currentSong?.id === task.songId &&
                currentSong?.source === 'local'
              const isActive =
                task.status === 'downloading' || task.status === 'pending'
              const percent = percentOf(task)
              return (
                <div className="dl-row" key={task.id}>
                  <div className="dl-col-title">
                    <Cover
                      src={imageUrl(task.coverUrl, 80)}
                      size={44}
                      radius={6}
                    />
                    <div className="song-title-text">
                      <div
                        className={clsx(
                          'song-name ellipsis',
                          isCurrent && playing && 'song-name-current',
                        )}
                        title={task.name}
                      >
                        {task.name}
                      </div>
                      <div className="song-artists ellipsis" title={task.album}>
                        {task.artist || '未知艺术家'} ·{' '}
                        {task.album || '未知专辑'}
                      </div>
                    </div>
                  </div>

                  <div className="dl-col-quality">
                    <span className="badge badge-accent">
                      {QUALITY_LABEL[task.level] || task.level}
                    </span>
                  </div>

                  <div className="dl-col-status">
                    {task.status === 'downloading' && (
                      <>
                        <div className="dl-progress">
                          <div
                            className="dl-progress-fill"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <div className="dl-status-text f-11 muted">
                          {formatBytes(task.receivedBytes)}/
                          {formatBytes(task.totalBytes)} ·{' '}
                          {formatSpeed(task.speed)} · {Math.round(percent)}%
                        </div>
                      </>
                    )}
                    {task.status === 'pending' && (
                      <span className="dl-status-text muted f-12">排队中…</span>
                    )}
                    {task.status === 'done' && (
                      <span className="dl-status-text dl-status-ok f-12">
                        <Icon name="check" size={13} /> 已完成
                      </span>
                    )}
                    {task.status === 'error' && (
                      <span
                        className="dl-status-text dl-status-error f-12"
                        title={task.error}
                      >
                        失败：{task.error || '未知错误'}
                      </span>
                    )}
                    {task.status === 'canceled' && (
                      <span className="dl-status-text muted f-12">已取消</span>
                    )}
                  </div>

                  <div className="dl-col-size">
                    <div>{formatBytes(task.totalBytes)}</div>
                    <div className="muted f-11">
                      {formatRelativeTime(task.createdAt)}
                    </div>
                  </div>

                  <div className="dl-col-actions">
                    {isActive ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => cancelTask(task)}
                      >
                        取消
                      </button>
                    ) : task.status === 'done' ? (
                      <>
                        <IconButton
                          icon="play"
                          title="播放"
                          onClick={() => playTask(task)}
                        />
                        <IconButton
                          icon="external"
                          title="用系统默认播放器打开"
                          onClick={() => void open(task.id)}
                        />
                        <IconButton
                          icon="folder-open"
                          title="在文件夹中显示"
                          onClick={() => void reveal(task.id)}
                        />
                      </>
                    ) : null}
                    <IconButton
                      icon="trash"
                      title="删除记录"
                      className="dl-icon-danger"
                      onClick={() => removeTask(task)}
                    />
                    <IconButton
                      icon="x"
                      title="删除记录并删除文件"
                      className="dl-icon-danger"
                      onClick={() => setConfirm({ kind: 'remove', task })}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Modal
        open={confirm !== null}
        title={
          confirm?.kind === 'clear'
            ? '清空下载记录并删除文件'
            : '删除记录并删除文件'
        }
        onClose={() => setConfirm(null)}
        width={430}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirm(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void runConfirm()}
            >
              确认删除
            </button>
          </>
        }
      >
        <div className="dl-confirm">
          {confirm?.kind === 'clear' ? (
            <>
              <p>
                将删除全部 <strong>{tasks.length}</strong>{' '}
                条下载记录，并删除已经下载到本机的音频文件
                （含同名的歌词与封面）。
              </p>
              <p className="muted f-12">
                未完成或失败的任务只会被移除记录；该操作不可撤销。
              </p>
            </>
          ) : (
            <>
              <p>
                将删除《{confirmTaskName}》的下载记录，并删除对应的本地文件。
              </p>
              <p className="muted f-12">该操作不可撤销。</p>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
