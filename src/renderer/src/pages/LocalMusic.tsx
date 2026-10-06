import { useMemo, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import clsx from 'clsx'
import type { LocalTrack, Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  Cover,
  Empty,
  Highlight,
  IconButton,
  Loading,
} from '@/components/ui/Primitives'
import { openContextMenu } from '@/components/ui/ContextMenu'
import { buildSongMenu } from '@/components/song/songActions'
import { formatBytes, formatDuration } from '@/lib/format'
import { useDebouncedValue } from '@/lib/hooks'
import { localTrackToSong, usePlayerStore } from '@/store/player'
import { useLocalStore } from '@/store/local'
import { toast } from '@/store/toast'
import './LocalMusic.css'

/** 排序维度：文本按字典序升序，时长升序，「最近修改」按时间倒序 */
type SortKey = 'title' | 'artist' | 'album' | 'duration' | 'mtime'

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'title', label: '按标题' },
  { value: 'artist', label: '按歌手' },
  { value: 'album', label: '按专辑' },
  { value: 'duration', label: '按时长' },
  { value: 'mtime', label: '按最近修改' },
]

/**
 * 本地音乐：管理主进程扫描出来的音乐库，并直接把本地文件送进播放器。
 * 列表没有复用 SongTable —— 本地条目需要文件大小、在文件夹中显示、删除索引等专属列。
 */
export default function LocalMusic(): ReactNode {
  const navigate = useAppNavigate()

  const tracks = useLocalStore((state) => state.tracks)
  const folders = useLocalStore((state) => state.folders)
  const scanning = useLocalStore((state) => state.scanning)
  const progress = useLocalStore((state) => state.progress)
  const loaded = useLocalStore((state) => state.loaded)
  const scan = useLocalStore((state) => state.scan)
  const pickFolder = useLocalStore((state) => state.pickFolder)
  const removeFolder = useLocalStore((state) => state.removeFolder)
  const removeTrack = useLocalStore((state) => state.removeTrack)

  const playSongs = usePlayerStore((state) => state.playSongs)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const currentSong = usePlayerStore((state) => state.queue[state.index])
  const playing = usePlayerStore((state) => state.playing)

  const [keyword, setKeyword] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const debouncedKeyword = useDebouncedValue(keyword, 200)

  // 搜索与排序都在前端完成：本地库规模有限，不必为此往返主进程
  const visible = useMemo(() => {
    const needle = debouncedKeyword.trim().toLowerCase()
    const matched = needle
      ? tracks.filter((track) =>
          [track.name, track.artist, track.album].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
      : tracks
    const sorted = [...matched]
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'artist':
          return a.artist.localeCompare(b.artist, 'zh-Hans-CN')
        case 'album':
          return a.album.localeCompare(b.album, 'zh-Hans-CN')
        case 'duration':
          return (a.duration || 0) - (b.duration || 0)
        case 'mtime':
          return (b.mtime || 0) - (a.mtime || 0)
        case 'title':
        default:
          return a.name.localeCompare(b.name, 'zh-Hans-CN')
      }
    })
    return sorted
  }, [tracks, debouncedKeyword, sortKey])

  const totalDuration = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
    [tracks],
  )
  const totalSize = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.size || 0), 0),
    [tracks],
  )

  // 选中集合只保留 id；已从索引移除的条目自然失效，无需额外清理
  const selectedTracks = useMemo(
    () => tracks.filter((track) => selected.has(track.id)),
    [tracks, selected],
  )
  const allSelected =
    visible.length > 0 && visible.every((track) => selected.has(track.id))

  const songsOf = (list: LocalTrack[]): Song[] =>
    list.map((track) => localTrackToSong(track))

  const playAt = (index: number): void => {
    void playSongs(songsOf(visible), index, { type: 'local', name: '本地音乐' })
  }

  const toggleSelect = (id: number): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (allSelected) for (const track of visible) next.delete(track.id)
      else for (const track of visible) next.add(track.id)
      return next
    })
  }

  const removeOne = (id: number): void => {
    void removeTrack(id).catch((error: unknown) =>
      toast.fromError(error, '移除索引失败'),
    )
  }

  // 逐条移除：主进程按 id 落盘，串行执行避免并发写索引文件
  const removeSelected = async (): Promise<void> => {
    const targets = selectedTracks
    let removed = 0
    for (const track of targets) {
      try {
        await removeTrack(track.id)
        removed += 1
      } catch (error) {
        toast.fromError(error, '移除索引失败')
      }
    }
    setSelected(new Set())
    if (removed > 0) toast.success(`已移除 ${removed} 条索引`)
  }

  const openMenu = (
    event: { clientX: number; clientY: number },
    index: number,
  ): void => {
    const track = visible[index]
    if (!track) return
    openContextMenu(
      event,
      buildSongMenu({
        song: localTrackToSong(track),
        onPlay: () => playAt(index),
        onRemove: () => removeOne(track.id),
        removeLabel: '从索引移除',
        navigate,
      }),
    )
  }

  const scanPercent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.scanned / progress.total) * 100))
      : 0

  const searchText = debouncedKeyword.trim()

  return (
    <div className="page">
      <div className="local-head">
        <h1 className="f-24">本地音乐</h1>
        <span className="muted f-12">
          共 {tracks.length} 首 · 总时长 {formatDuration(totalDuration)} · 占用{' '}
          {formatBytes(totalSize)}
        </span>
      </div>

      {/* 工具条：目录维护 / 扫描 / 过滤 / 排序 / 统计 */}
      <div className="local-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void pickFolder()}
        >
          <Icon name="folder-open" size={15} /> 添加文件夹
        </button>
        <button
          type="button"
          className="btn"
          disabled={scanning}
          onClick={() => void scan()}
          title={
            folders.length === 0 ? '请先添加音乐文件夹' : '重新扫描所有文件夹'
          }
        >
          <Icon
            name={scanning ? 'loading' : 'refresh'}
            size={15}
            className={scanning ? 'spin' : undefined}
          />
          {scanning ? '扫描中…' : '重新扫描'}
        </button>

        <div className="local-search">
          <Icon name="search" size={14} className="local-search-icon" />
          <input
            value={keyword}
            placeholder="搜索歌名 / 歌手 / 专辑"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword && (
            <button
              type="button"
              className="icon-btn"
              title="清空搜索"
              onClick={() => setKeyword('')}
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>

        <select
          className="select"
          value={sortKey}
          title="排序方式"
          onChange={(event) => setSortKey(event.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="spacer" />

        <div className="local-stat">
          <span>
            共 <strong>{visible.length}</strong> 首
            {searchText && tracks.length !== visible.length
              ? `（已从 ${tracks.length} 首中筛选）`
              : ''}
          </span>
          <span>
            总时长 <strong>{formatDuration(totalDuration)}</strong>
          </span>
          <span>
            占用空间 <strong>{formatBytes(totalSize)}</strong>
          </span>
        </div>
      </div>

      {/* 扫描进度：progress 为空表示主进程尚未回报首条进度 */}
      {scanning && (
        <div className="local-scan">
          <div className="local-scan-text f-12">
            <Icon name="loading" size={13} className="spin" />
            {progress && progress.total > 0 ? (
              <span className="ellipsis" title={progress.current}>
                正在扫描 {progress.scanned}/{progress.total}
                {progress.current ? `：${progress.current}` : ''}
              </span>
            ) : (
              <span>正在准备扫描…</span>
            )}
            {progress && progress.added > 0 && (
              <span className="muted">· 已入库 {progress.added} 首</span>
            )}
          </div>
          <div className="local-progress">
            <div
              className="local-progress-fill"
              style={{ width: `${scanPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* 已纳入的文件夹；移除后需重新扫描才能更新曲库 */}
      {folders.length > 0 && (
        <div className="local-folders">
          {folders.map((folder) => (
            <div className="local-folder" key={folder}>
              <Icon name="folder" size={13} />
              <span className="ellipsis" title={folder}>
                {folder}
              </span>
              <button
                type="button"
                className="icon-btn"
                title="移除该文件夹"
                onClick={() => void removeFolder(folder)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!loaded ? (
        <Loading minHeight={320} label="正在读取本地音乐库…" />
      ) : folders.length === 0 ? (
        <Empty
          icon="folder"
          title="添加音乐文件夹"
          description="选择本机存放音乐的文件夹，扫描后即可直接播放这些文件；索引只记录路径，不会复制或改动你的音乐"
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void pickFolder()}
            >
              <Icon name="folder-open" size={15} /> 添加音乐文件夹
            </button>
          }
        />
      ) : scanning && tracks.length === 0 ? (
        // 首次扫描期间曲库还是空的，这里必须优先于「未发现音频文件」空状态，
        // 否则用户会误以为文件夹里没有音乐。
        <div className="center-box" style={{ minHeight: 320 }}>
          <Icon
            name="loading"
            size={22}
            className="spin"
            style={{ color: 'var(--accent)' }}
          />
          <span className="f-13 text-2">
            {progress
              ? `正在扫描 ${progress.scanned}/${progress.total}${
                  progress.current ? `：${progress.current}` : ''
                }`
              : '正在准备扫描…'}
          </span>
          <span className="f-12 muted">
            扫描期间可以先浏览其它页面，完成后会自动更新
          </span>
        </div>
      ) : tracks.length === 0 ? (
        <Empty
          icon="music"
          title="未发现音频文件"
          description="已添加的文件夹里没有支持的音频格式，试试重新扫描或换一个文件夹"
          action={
            <button
              type="button"
              className="btn"
              disabled={scanning}
              onClick={() => void scan()}
            >
              <Icon name="refresh" size={15} /> 重新扫描
            </button>
          }
        />
      ) : visible.length === 0 ? (
        <Empty
          icon="search"
          title={`没有找到与「${searchText}」相关的歌曲`}
          description="只会匹配歌名、歌手与专辑，换个关键词试试"
          action={
            <button
              type="button"
              className="btn"
              onClick={() => setKeyword('')}
            >
              清空搜索
            </button>
          }
        />
      ) : (
        <>
          <div className="local-table">
            <div className="local-head-row">
              <div className="local-col-check">
                <button
                  type="button"
                  className={clsx(
                    'checkbox',
                    allSelected && 'checkbox-checked',
                  )}
                  title={allSelected ? '取消全选' : '全选'}
                  onClick={toggleSelectAll}
                >
                  {allSelected && <Icon name="check" size={12} />}
                </button>
              </div>
              <div className="local-col-index">#</div>
              <div className="local-col-title">标题</div>
              <div className="local-col-artist">歌手</div>
              <div className="local-col-album">专辑</div>
              <div className="local-col-time">
                <Icon name="clock" size={14} />
              </div>
              <div className="local-col-size">大小</div>
              <div className="local-col-actions" />
            </div>

            <div className="local-body">
              {visible.map((track, index) => {
                const isCurrent =
                  currentSong?.id === track.id &&
                  currentSong?.source === 'local'
                const isSelected = selected.has(track.id)
                return (
                  <div
                    key={track.id}
                    className={clsx(
                      'local-row',
                      isCurrent && 'local-row-current',
                      isSelected && 'local-row-selected',
                    )}
                    onDoubleClick={() => playAt(index)}
                    onContextMenu={(event) => openMenu(event, index)}
                  >
                    <div className="local-col-check">
                      <button
                        type="button"
                        className={clsx(
                          'checkbox',
                          isSelected && 'checkbox-checked',
                        )}
                        title={isSelected ? '取消选择' : '选择'}
                        onClick={() => toggleSelect(track.id)}
                      >
                        {isSelected && <Icon name="check" size={12} />}
                      </button>
                    </div>

                    <div className="local-col-index">
                      {isCurrent && playing ? (
                        <Icon
                          name="wave"
                          size={15}
                          className="song-playing-icon"
                        />
                      ) : (
                        <span className="song-index-text">{index + 1}</span>
                      )}
                    </div>

                    <div className="local-col-title">
                      <Cover
                        src={track.coverUrl}
                        size={40}
                        radius={6}
                        className="song-cover"
                        playing={isCurrent && playing}
                        onPlay={() => playAt(index)}
                      />
                      <div className="song-title-text">
                        <div
                          className={clsx(
                            'song-name ellipsis',
                            isCurrent && 'song-name-current',
                          )}
                          title={track.name}
                        >
                          <Highlight
                            text={track.name}
                            keyword={searchText || undefined}
                          />
                        </div>
                        {/* 副行显示文件名：本地库最常见的困惑是「同名歌曲是哪一首」 */}
                        <div
                          className="song-artists ellipsis"
                          title={track.path}
                        >
                          {fileNameOf(track.path)}
                        </div>
                      </div>
                    </div>

                    <div
                      className="local-col-artist ellipsis"
                      title={track.artist}
                    >
                      <Highlight
                        text={track.artist || '未知艺术家'}
                        keyword={searchText || undefined}
                      />
                    </div>

                    <div
                      className="local-col-album ellipsis"
                      title={track.album}
                    >
                      <Highlight
                        text={track.album || '未知专辑'}
                        keyword={searchText || undefined}
                      />
                    </div>

                    <div className="local-col-time">
                      {formatDuration(track.duration)}
                    </div>
                    <div className="local-col-size">
                      {formatBytes(track.size)}
                    </div>

                    <div className="local-col-actions">
                      <IconButton
                        icon="play"
                        title="播放"
                        onClick={(event) => {
                          event.stopPropagation()
                          playAt(index)
                        }}
                      />
                      <IconButton
                        icon="add-list"
                        title="加入播放列表"
                        onClick={(event) => {
                          event.stopPropagation()
                          addToQueue(songsOf([track]))
                        }}
                      />
                      <IconButton
                        icon="folder-open"
                        title="在文件夹中显示"
                        onClick={(event) => {
                          event.stopPropagation()
                          void window.ncm.app.openPath(track.path)
                        }}
                      />
                      <IconButton
                        icon="trash"
                        title="从索引移除"
                        className="local-icon-danger"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeOne(track.id)
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {selectedTracks.length > 0 && (
            <div className="batch-bar">
              <span className="f-12">已选择 {selectedTracks.length} 首</span>
              <div className="spacer" />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void playSongs(songsOf(selectedTracks), 0, {
                    type: 'local',
                    name: '本地音乐（已选）',
                  })
                }
              >
                <Icon name="play" size={14} /> 播放选中
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => addToQueue(songsOf(selectedTracks))}
              >
                <Icon name="add-list" size={14} /> 加入队列
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void removeSelected()}
              >
                <Icon name="trash" size={14} /> 批量移除索引
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSelected(new Set())}
              >
                取消选择
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 绝对路径 → 文件名（Windows 与 POSIX 分隔符都兼容） */
function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}
