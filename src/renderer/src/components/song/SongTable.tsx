import { useMemo, type ReactNode } from 'react'
import clsx from 'clsx'
import { useAppNavigate } from '@/lib/navigation'
import type { Song } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Cover, Empty, Highlight } from '@/components/ui/Primitives'
import { openContextMenu } from '@/components/ui/ContextMenu'
import { buildSongMenu } from './songActions'
import { usePlayerStore, type PlayContext } from '@/store/player'
import { useAuthStore } from '@/store/auth'
import { artistNames, formatDuration, imageUrl } from '@/lib/format'

export interface SongTableProps {
  songs: Song[]
  context?: PlayContext
  showAlbum?: boolean
  showCover?: boolean
  showIndex?: boolean
  keyword?: string
  /** 队列场景：移除某一首 */
  onRemove?: (index: number) => void
  removeLabel?: string
  /** 批量选择 */
  selectable?: boolean
  selectedKeys?: Set<string>
  onToggleSelect?: (song: Song, index: number) => void
  /**
   * 与 `songs` 等长的稳定行键。传入时用它替代「数组下标」作为行标识：
   * 列表被过滤/重排后，行选择与 React key 仍指向同一首歌。
   */
  keys?: string[]
  /** 行点击（不传则只有双击播放） */
  onRowClick?: (song: Song, index: number) => void
  emptyText?: string
  /** 是否把当前播放的歌高亮并置顶显示播放中图标 */
  highlightCurrent?: boolean
  className?: string
}

function songKey(song: Song, index: number): string {
  return `${song.id}-${song.source ?? 'netease'}-${index}`
}

/**
 * 歌曲列表。行使用 content-visibility 优化，千首歌单也不会卡。
 */
export function SongTable({
  songs,
  context,
  showAlbum = true,
  showCover = true,
  showIndex = true,
  keyword,
  onRemove,
  removeLabel,
  selectable = false,
  selectedKeys,
  onToggleSelect,
  keys,
  onRowClick,
  emptyText = '这里还没有歌曲',
  highlightCurrent = true,
  className,
}: SongTableProps): ReactNode {
  const navigate = useAppNavigate()
  const currentSong = usePlayerStore((state) => state.queue[state.index])
  const playing = usePlayerStore((state) => state.playing)
  const playSongs = usePlayerStore((state) => state.playSongs)
  const likedIds = usePlayerStore((state) => state.likedIds)
  const toggleLike = usePlayerStore((state) => state.toggleLike)
  const loggedIn = useAuthStore((state) => state.loggedIn)

  const likedSet = useMemo(() => new Set(likedIds), [likedIds])

  if (songs.length === 0) {
    return <Empty icon="music" title={emptyText} minHeight={160} />
  }

  const handlePlay = (index: number): void => {
    void playSongs(songs, index, context)
  }

  return (
    // 勾选模式比普通模式多一列复选框，必须带上修饰类，
    // 否则 6 个子元素挤进 5 列模板：序号会被放进「标题」列居中、操作列换行到第二行。
    <div className={clsx('song-table', selectable && 'with-check', className)}>
      <div className="song-head">
        {selectable && <div className="song-col-check" />}
        {showIndex && <div className="song-col-index">#</div>}
        <div className="song-col-title">标题</div>
        {showAlbum && <div className="song-col-album">专辑</div>}
        <div className="song-col-time">
          <Icon name="clock" size={14} />
        </div>
        <div className="song-col-actions" />
      </div>

      <div className="song-body">
        {songs.map((song, index) => {
          const key = keys?.[index] ?? songKey(song, index)
          const isCurrent =
            highlightCurrent &&
            currentSong?.id === song.id &&
            currentSong?.source === song.source
          const liked = likedSet.has(song.id)
          const selected = selectedKeys?.has(key) ?? false
          const cover = imageUrl(song.al?.picUrl, 80)

          return (
            <div
              key={key}
              className={clsx(
                'song-row',
                isCurrent && 'song-row-current',
                selected && 'song-row-selected',
              )}
              onDoubleClick={() => handlePlay(index)}
              onClick={() => onRowClick?.(song, index)}
              onContextMenu={(event) =>
                openContextMenu(
                  event,
                  buildSongMenu({
                    song,
                    onPlay: () => handlePlay(index),
                    onRemove: onRemove ? () => onRemove(index) : undefined,
                    removeLabel,
                    navigate,
                  }),
                )
              }
            >
              {selectable && (
                <div className="song-col-check">
                  <button
                    type="button"
                    className={clsx('checkbox', selected && 'checkbox-checked')}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleSelect?.(song, index)
                    }}
                  >
                    {selected && <Icon name="check" size={12} />}
                  </button>
                </div>
              )}

              {showIndex && (
                <div className="song-col-index">
                  {isCurrent && playing ? (
                    <Icon name="wave" size={15} className="song-playing-icon" />
                  ) : (
                    <span className="song-index-text">{index + 1}</span>
                  )}
                  <button
                    type="button"
                    className="song-index-play"
                    title="播放"
                    onClick={(event) => {
                      event.stopPropagation()
                      handlePlay(index)
                    }}
                  >
                    <Icon
                      name={isCurrent && playing ? 'pause' : 'play'}
                      size={14}
                    />
                  </button>
                </div>
              )}

              <div className="song-col-title">
                {showCover && (
                  <Cover
                    src={cover}
                    size={40}
                    radius={6}
                    onPlay={() => handlePlay(index)}
                    className="song-cover"
                  />
                )}
                <div className="song-title-text">
                  <div
                    className={clsx(
                      'song-name ellipsis',
                      isCurrent && 'song-name-current',
                    )}
                  >
                    <Highlight text={song.name} keyword={keyword} />
                    {song.alia && song.alia.length > 0 && (
                      <span className="muted f-12"> ({song.alia[0]})</span>
                    )}
                    {song.source === 'local' && (
                      <span className="tag-mini">本地</span>
                    )}
                  </div>
                  <div className="song-artists ellipsis">
                    {(song.ar ?? []).map((artist, artistIndex) => (
                      <span key={`${artist.id}-${artistIndex}`}>
                        {artistIndex > 0 && <span className="muted"> / </span>}
                        {artist.id ? (
                          <span
                            className="link"
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/artist/${artist.id}`)
                            }}
                          >
                            <Highlight text={artist.name} keyword={keyword} />
                          </span>
                        ) : (
                          <span>{artist.name}</span>
                        )}
                      </span>
                    ))}
                    {!song.ar?.length && (
                      <span className="muted">{artistNames(song.ar)}</span>
                    )}
                  </div>
                </div>
              </div>

              {showAlbum && (
                <div className="song-col-album ellipsis">
                  {song.al?.id ? (
                    <span
                      className="link"
                      onClick={(event) => {
                        event.stopPropagation()
                        navigate(`/album/${song.al?.id}`)
                      }}
                    >
                      {song.al.name}
                    </span>
                  ) : (
                    <span className="muted">{song.al?.name ?? '—'}</span>
                  )}
                </div>
              )}

              <div className="song-col-time">{formatDuration(song.dt)}</div>

              <div className="song-col-actions">
                {loggedIn && song.source !== 'local' && (
                  <button
                    type="button"
                    className={clsx(
                      'icon-btn song-like',
                      liked && 'song-like-active',
                    )}
                    title={liked ? '取消喜欢' : '喜欢'}
                    onClick={(event) => {
                      event.stopPropagation()
                      void toggleLike(song)
                    }}
                  >
                    <Icon name={liked ? 'heart-filled' : 'heart'} size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn song-more"
                  title="更多操作"
                  onClick={(event) => {
                    event.stopPropagation()
                    openContextMenu(
                      event,
                      buildSongMenu({
                        song,
                        onPlay: () => handlePlay(index),
                        onRemove: onRemove ? () => onRemove(index) : undefined,
                        removeLabel,
                        navigate,
                      }),
                    )
                  }}
                >
                  <Icon name="more" size={16} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
