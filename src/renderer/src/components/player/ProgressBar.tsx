import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Slider } from '@/components/ui/Slider'
import { formatDuration } from '@/lib/format'
import { usePlayerStore, selectCurrentSong } from '@/store/player'

/** 播放进度条：拖动时显示预览时间，松手才真正 seek */
export function ProgressBar({
  showTime = true,
}: {
  showTime?: boolean
}): ReactNode {
  const position = usePlayerStore((state) => state.position)
  const duration = usePlayerStore((state) => state.duration)
  const song = usePlayerStore(selectCurrentSong)
  const seek = usePlayerStore((state) => state.seek)
  const [preview, setPreview] = useState<number | null>(null)

  const total = duration || song?.dt || 0
  const shown = preview ?? position
  const ratio = total > 0 ? Math.min(1, shown / total) : 0

  return (
    <div className="progress-row">
      {showTime && (
        <span className="progress-time">{formatDuration(shown)}</span>
      )}
      <Slider
        value={ratio}
        onDragging={(value) => setPreview(value * total)}
        onChange={(value) => setPreview(value * total)}
        onCommit={(value) => {
          seek(value * total)
          setPreview(null)
        }}
        tip={formatDuration(shown)}
        className="progress-slider"
        height={4}
      />
      {showTime && (
        <span className="progress-time">{formatDuration(total)}</span>
      )}
    </div>
  )
}

/** 音量控制 */
export function VolumeControl({
  compact = false,
}: {
  compact?: boolean
}): ReactNode {
  const volume = usePlayerStore((state) => state.volume)
  const muted = usePlayerStore((state) => state.muted)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const toggleMute = usePlayerStore((state) => state.toggleMute)

  const icon =
    muted || volume === 0 ? 'mute' : volume < 0.45 ? 'volume-low' : 'volume'

  return (
    <div className="volume-control">
      <button
        type="button"
        className="icon-btn"
        title={muted ? '取消静音' : '静音'}
        onClick={toggleMute}
      >
        <Icon name={icon} size={17} />
      </button>
      {!compact && (
        <Slider
          value={muted ? 0 : volume}
          onChange={setVolume}
          className="volume-slider"
          height={4}
          tip={`${Math.round((muted ? 0 : volume) * 100)}%`}
        />
      )}
    </div>
  )
}
