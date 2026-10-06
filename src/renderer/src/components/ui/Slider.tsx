import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import clsx from 'clsx'

export interface SliderProps {
  /** 0-1 */
  value: number
  onChange: (value: number) => void
  /** 拖动过程回调（用于实时预览） */
  onDragging?: (value: number) => void
  onCommit?: (value: number) => void
  /** 缓冲进度 0-1（第二层） */
  buffer?: number
  className?: string
  /** 竖直方向（音量条） */
  vertical?: boolean
  /** 是否显示滑块圆点 */
  showThumb?: boolean
  disabled?: boolean
  /** 悬浮时的提示文本 */
  tip?: ReactNode
  height?: number
}

/**
 * 通用滑杆：支持点按跳转、拖动、键盘方向键。
 * 不依赖原生 input[range]，因为需要“缓冲层 + 逐字歌词”这类自定义视觉。
 */
export function Slider({
  value,
  onChange,
  onDragging,
  onCommit,
  buffer,
  className,
  vertical = false,
  showThumb = true,
  disabled = false,
  tip,
  height = 4,
}: SliderProps): ReactNode {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const [local, setLocal] = useState(value)

  useEffect(() => {
    if (!dragging) setLocal(value)
  }, [value, dragging])

  const ratioFromEvent = useCallback(
    (clientX: number, clientY: number): number => {
      const track = trackRef.current
      if (!track) return 0
      const rect = track.getBoundingClientRect()
      const ratio = vertical
        ? 1 - (clientY - rect.top) / rect.height
        : (clientX - rect.left) / rect.width
      return Math.max(0, Math.min(1, ratio))
    },
    [vertical],
  )

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (disabled) return
    event.preventDefault()
    const ratio = ratioFromEvent(event.clientX, event.clientY)
    setDragging(true)
    setLocal(ratio)
    onDragging?.(ratio)
    onChange(ratio)
  }

  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent): void => {
      const ratio = ratioFromEvent(event.clientX, event.clientY)
      setLocal(ratio)
      onDragging?.(ratio)
      onChange(ratio)
    }
    const up = (event: PointerEvent): void => {
      setDragging(false)
      onCommit?.(ratioFromEvent(event.clientX, event.clientY))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, onChange, onDragging, onCommit, ratioFromEvent])

  const percent = Math.max(0, Math.min(1, local)) * 100
  const bufferPercent =
    buffer !== undefined ? Math.max(0, Math.min(1, buffer)) * 100 : undefined

  return (
    <div
      ref={trackRef}
      className={clsx(
        'slider',
        vertical && 'slider-vertical',
        dragging && 'slider-dragging',
        disabled && 'slider-disabled',
        className,
      )}
      // 厚度只作为轨道粗细传给 CSS，根元素高度靠 padding 撑出可点击区域；
      // 直接在根元素写 height 会被全局 border-box 连同 padding 一起吃掉，轨道就没了。
      style={{ '--slider-thickness': `${height}px` } as CSSProperties}
      onPointerDown={handlePointerDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={local}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) return
        const step = event.shiftKey ? 0.1 : 0.02
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          onCommit?.(Math.min(1, local + step))
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault()
          onCommit?.(Math.max(0, local - step))
        }
      }}
    >
      <div className="slider-rail">
        {bufferPercent !== undefined && (
          <div
            className="slider-buffer"
            style={
              vertical
                ? { height: `${bufferPercent}%` }
                : { width: `${bufferPercent}%` }
            }
          />
        )}
        <div
          className="slider-fill"
          style={
            vertical ? { height: `${percent}%` } : { width: `${percent}%` }
          }
        />
      </div>
      {showThumb && (
        <div
          className="slider-thumb"
          style={
            vertical
              ? { bottom: `calc(${percent}% - 5px)` }
              : { left: `calc(${percent}% - 5px)` }
          }
        />
      )}
      {tip && (hover || dragging) && !vertical && (
        <div className="slider-tip" style={{ left: `${percent}%` }}>
          {tip}
        </div>
      )}
    </div>
  )
}
