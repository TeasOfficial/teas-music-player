import { useMemo, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from '@/components/ui/Icon'
import { Cover, Empty } from '@/components/ui/Primitives'
import { openContextMenu } from '@/components/ui/ContextMenu'
import { buildSongMenu } from '@/components/song/songActions'
import { useAppNavigate } from '@/lib/navigation'
import { imageUrl } from '@/lib/format'
import { usePlayerStore, selectCurrentSong } from '@/store/player'

/** 右侧播放队列抽屉 */
export function QueuePanel(): ReactNode {
  const navigate = useAppNavigate()
  const open = usePlayerStore((state) => state.showQueue)
  const queue = usePlayerStore((state) => state.queue)
  const index = usePlayerStore((state) => state.index)
  const playing = usePlayerStore((state) => state.playing)
  const current = usePlayerStore(selectCurrentSong)
  const setShowQueue = usePlayerStore((state) => state.setShowQueue)
  const jumpTo = usePlayerStore((state) => state.jumpTo)
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue)
  const clearQueue = usePlayerStore((state) => state.clearQueue)
  const context = usePlayerStore((state) => state.context)
  const heartKeys = usePlayerStore((state) => state.heartKeys)
  const heartSet = useMemo(() => new Set(heartKeys), [heartKeys])

  // 关闭时不卸载：进退场交给 CSS 的 display 过渡，
  // 直接 return null 的话元素消失，退场动画就没机会播
  return (
    <div className={clsx('queue-panel', open && 'queue-panel-open')}>
      <div className="queue-head">
        <div className="col">
          <span className="f-14 bold">当前播放</span>
          <span className="f-12 muted">
            共 {queue.length} 首{context?.name ? ` · 来自${context.name}` : ''}
            {heartKeys.length > 0 && (
              <span className="queue-heart-badge">
                <Icon name="heart-filled" size={11} />
                心动 {heartKeys.length}
              </span>
            )}
          </span>
        </div>
        <div className="row gap-4">
          <button
            type="button"
            className="text-btn"
            onClick={clearQueue}
            disabled={queue.length === 0}
          >
            清空
          </button>
          <button
            type="button"
            className="icon-btn"
            title="关闭"
            onClick={() => setShowQueue(false)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      <div className="queue-body scroll-y">
        {queue.length === 0 ? (
          <Empty icon="list" title="播放列表是空的" minHeight={180} />
        ) : (
          queue.map((song, itemIndex) => {
            const isCurrent =
              current?.id === song.id && current?.source === song.source
            const isHeart = heartSet.has(
              `${song.source ?? 'netease'}:${song.id}`,
            )
            return (
              <div
                key={`${song.id}-${itemIndex}`}
                className={clsx(
                  'queue-item',
                  isCurrent && 'queue-item-current',
                )}
                onDoubleClick={() => void jumpTo(itemIndex)}
                onContextMenu={(event) =>
                  openContextMenu(
                    event,
                    buildSongMenu({
                      song,
                      onPlay: () => void jumpTo(itemIndex),
                      onRemove: () => removeFromQueue(itemIndex),
                      navigate: (path) => navigate(path),
                    }),
                  )
                }
              >
                <span className="queue-index">
                  {isCurrent && playing ? (
                    <Icon name="wave" size={14} />
                  ) : (
                    itemIndex + 1
                  )}
                </span>
                <Cover
                  src={imageUrl(song.al?.picUrl, 60)}
                  size={34}
                  radius={5}
                />
                <div className="queue-info">
                  <div className="row gap-4" style={{ minWidth: 0 }}>
                    <div
                      className={clsx(
                        'ellipsis',
                        isCurrent && 'song-name-current',
                      )}
                    >
                      {song.name}
                    </div>
                    {isHeart && (
                      <span className="queue-heart-tag" title="心动模式推荐">
                        <Icon name="heart-filled" size={11} />
                      </span>
                    )}
                  </div>
                  <div className="f-11 muted ellipsis">
                    {(song.ar ?? []).map((artist) => artist.name).join(' / ')}
                  </div>
                </div>
                <div className="queue-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="播放"
                    onClick={(event) => {
                      event.stopPropagation()
                      void jumpTo(itemIndex)
                    }}
                  >
                    <Icon name="play" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="从列表移除"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeFromQueue(itemIndex)
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
