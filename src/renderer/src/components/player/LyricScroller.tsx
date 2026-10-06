import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from '@/components/ui/Icon'
import { usePlayerStore } from '@/store/player'
import { useSettingsStore } from '@/store/settings'
import {
  findLineIndex,
  lyricOffsetMs,
  wordProgress,
  type LyricLine,
} from '@/lib/lyrics'
import { audioEngine } from '@/lib/audio'

interface LyricScrollerProps {
  /** 紧凑模式（侧栏/桌面歌词用） */
  compact?: boolean
  /** 是否允许点击行跳转 */
  clickable?: boolean
  className?: string
  /** 未播放时的占位文案 */
  placeholder?: string
}

/**
 * 歌词滚动器：自动居中当前行、逐字高亮、支持点击跳转。
 * 主界面与桌面歌词窗口共用一个实现。
 */
export function LyricScroller({
  compact = false,
  clickable = true,
  className,
  placeholder = '暂无歌词',
}: LyricScrollerProps): ReactNode {
  const lyrics = usePlayerStore((state) => state.lyrics)
  const position = usePlayerStore((state) => state.position)
  const loading = usePlayerStore((state) => state.lyricsLoading)
  const seek = usePlayerStore((state) => state.seek)
  const playing = usePlayerStore((state) => state.playing)
  const showTranslation = useSettingsStore(
    (state) => state.settings.showTranslation,
  )
  const showRoman = useSettingsStore((state) => state.settings.showRoman)
  const lyricOffset = useSettingsStore((state) => state.settings.lyricOffset)

  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Array<HTMLDivElement | null>>([])
  const [userScrolling, setUserScrolling] = useState(false)
  const scrollTimer = useRef<number | null>(null)
  /** 正在执行自动滚动。自己触发的 scroll 事件不能被当成用户操作 */
  const autoScrolling = useRef(false)
  const scrollAnim = useRef<number | null>(null)
  /** 最近一次「自己写 scrollTop」的时间。末帧的 scroll 事件会晚于动画结束才送达，
      只靠 autoScrolling 布尔量会漏掉它，于是又被当成用户滚动锁 3 秒。 */
  const lastAutoScrollAt = useRef(0)

  const activeIndex = useMemo(
    // 加上用户设置的歌词偏移：正数代表歌词提前。逐字读词用同一个值（见下方 write）
    () => findLineIndex(lyrics.lines, position + lyricOffsetMs()),
    [lyrics.lines, position, lyricOffset],
  )

  /**
   * 自己实现的滚动动画。
   *
   * 之前用 `scrollTo({ behavior: 'smooth' })`，但它会触发 scroll 事件，
   * 被 onScroll 当成「用户手动滚动」→ 锁 3 秒 → 下一次自动居中要等 3 秒后
   * 才发生，表现就是「歌词永远跟不上节奏」。所以这里自己做动画：
   * 动画期间打标记，自己触发的 scroll 事件直接忽略。
   * 时长也压短（110~180ms），让歌词跟得更紧。
   */
  function scrollToLine(container: HTMLDivElement, target: number): void {
    if (scrollAnim.current !== null) cancelAnimationFrame(scrollAnim.current)
    const from = container.scrollTop
    const delta = target - from
    if (Math.abs(delta) < 1) {
      autoScrolling.current = false
      return
    }
    const duration = Math.min(180, 110 + Math.abs(delta) * 0.08)
    const start = performance.now()
    autoScrolling.current = true
    const step = (now: number): void => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - p) ** 3
      container.scrollTop = from + delta * eased
      lastAutoScrollAt.current = performance.now()
      if (p < 1) {
        scrollAnim.current = requestAnimationFrame(step)
      } else {
        scrollAnim.current = null
        autoScrolling.current = false
      }
    }
    scrollAnim.current = requestAnimationFrame(step)
  }

  // 自动滚动：用户手动滚动后 3 秒内不打扰；正在看评论时也不把人拽回歌词
  useEffect(() => {
    if (userScrolling) return
    const container = containerRef.current
    const line = activeIndex >= 0 ? lineRefs.current[activeIndex] : null
    if (!container || !line) return

    const target = Math.max(
      0,
      // 用 rect 相对容器计算，而不是 offsetTop：后者依赖 offsetParent，
      // 一旦外层出现定位/变换容器就会算错，导致当前行滚不到中间。
      container.scrollTop +
        line.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        container.clientHeight / 2 +
        line.clientHeight / 2,
    )
    scrollToLine(container, target)
  }, [activeIndex, userScrolling])

  useEffect(() => {
    return () => {
      if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
      if (scrollAnim.current !== null) cancelAnimationFrame(scrollAnim.current)
    }
  }, [])

  const handleScroll = (): void => {
    // 自动滚动自己触发的 scroll 事件不算用户操作（含动画结束后才送达的末帧事件）
    if (
      autoScrolling.current ||
      performance.now() - lastAutoScrollAt.current < 150
    )
      return
    setUserScrolling(true)
    if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => setUserScrolling(false), 3000)
  }

  // 逐字高亮：读音频元素自身的时钟逐帧推进（store 的进度只有 ~4Hz，会跳），
  // 只切换发生变化的字符类名，靠 CSS 的 color 过渡形成连续淡入。
  // 是否具备逐字时间轴由 wordProgress 判定：它返回 null 表示这一行只有整行
  // 时间戳（普通 LRC），此时不能按行时长匀速点亮字符 —— 那会得到与演唱完全
  // 脱节的假读词效果。所以整行不拆字、也不启动这个循环。
  useEffect(() => {
    if (activeIndex < 0) return
    const line = lyrics.lines[activeIndex]
    const row = lineRefs.current[activeIndex]
    if (!line || !row) return
    const chars = row.querySelectorAll<HTMLElement>('.lyric-char')
    if (chars.length === 0) return

    let applied = 0
    const apply = (count: number): void => {
      if (count === applied) return
      const from = Math.min(applied, count)
      const to = Math.max(applied, count)
      for (let i = from; i < to; i += 1) {
        chars[i]?.classList.toggle('lyric-char-on', i < count)
      }
      applied = count
    }

    const write = (): void => {
      // 时钟 + 用户偏移 + 30ms 提前量：前两项对齐「听到的声音」，
      // 最后 30ms 抵掉 60ms 颜色过渡的中点（见 .lyric-char 的过渡）。
      const progress = wordProgress(
        line,
        audioEngine.currentMs + lyricOffsetMs() + 30,
      )
      if (progress === null) return
      apply(Math.floor(progress * chars.length))
    }

    write()
    if (!playing) return
    let raf = 0
    const tick = (): void => {
      write()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [activeIndex, lyrics.lines, playing])

  /**
   * 诊断探针：排查「当前行/读词器滞后」用。默认关闭，开启方式：
   *   NCM_LYRIC_DEBUG=1 pnpm dev
   * 开关经 preload 暴露（渲染进程里没有 process）。
   * 每 500ms 打印一次：音频时钟 / store 进度 / 活动行起始时间 / 该行是否在视口内。
   * 判定方法：audio ≈ store 且 dev 很小 → 数据与判定都没问题，问题在滚动或渲染层；
   * 若 inView=NO 则说明是「自动滚动没跟上」，而不是活动行算错。
   */
  useEffect(() => {
    if (!window.ncm?.debug?.lyric) return
    const timer = window.setInterval(() => {
      const state = usePlayerStore.getState()
      const lines = state.lyrics.lines
      const audio = audioEngine.currentMs
      const index = findLineIndex(lines, audio + lyricOffsetMs())
      const line = index >= 0 ? lines[index] : undefined
      const row = index >= 0 ? lineRefs.current[index] : null
      const container = containerRef.current
      let inView = 'n/a'
      if (row && container) {
        const top = row.getBoundingClientRect().top
        const box = container.getBoundingClientRect()
        inView = top >= box.top - 2 && top <= box.bottom ? 'yes' : 'NO'
      }
      console.log(
        '[lyric-debug]',
        JSON.stringify({
          audio,
          store: state.position,
          index,
          lineStart: line?.time ?? -1,
          dev: line ? audio - line.time : -1,
          text: (line?.text ?? '').slice(0, 14),
          inView,
          scrollTop: Math.round(container?.scrollTop ?? -1),
        }),
      )
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  if (loading && lyrics.lines.length === 0) {
    return (
      <div className={clsx('lyric-scroller lyric-loading', className)}>
        <Icon name="loading" size={22} className="spin" />
      </div>
    )
  }

  if (lyrics.lines.length === 0) {
    return (
      <div className={clsx('lyric-scroller lyric-empty', className)}>
        <Icon name="mic" size={26} />
        <span>{lyrics.pureMusic ? '纯音乐，请欣赏' : placeholder}</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={clsx(
        'lyric-scroller',
        compact && 'lyric-scroller-compact',
        className,
      )}
      onWheel={handleScroll}
      onScroll={handleScroll}
    >
      <div className="lyric-padding" />
      {lyrics.lines.map((line, index) => (
        <LyricRow
          key={`${line.time}-${index}`}
          ref={(node) => {
            lineRefs.current[index] = node
          }}
          line={line}
          active={index === activeIndex}
          passed={index < activeIndex}
          showTranslation={showTranslation}
          showRoman={showRoman}
          clickable={clickable}
          onSeek={() => seek(line.time)}
        />
      ))}
      <div className="lyric-padding" />
    </div>
  )
}

interface LyricRowProps {
  line: LyricLine
  active: boolean
  passed: boolean
  showTranslation: boolean
  showRoman: boolean
  clickable: boolean
  onSeek: () => void
}

function LyricRow({
  line,
  active,
  passed,
  showTranslation,
  showRoman,
  clickable,
  onSeek,
  ref,
}: LyricRowProps & { ref?: (node: HTMLDivElement | null) => void }): ReactNode {
  return (
    <div
      ref={ref}
      className={clsx(
        'lyric-line',
        active && 'lyric-line-active',
        passed && 'lyric-line-passed',
      )}
      onClick={() => clickable && onSeek()}
      title={clickable ? '点击跳转到这一句' : undefined}
    >
      <div className="lyric-text">
        {active && line.words.length > 0 ? (
          // 逐字符渲染：配合 .lyric-char 的 color 过渡，既连续淡入，
          // 又不会像横向渐变那样在「折行」时错乱（渐变按整个盒子算宽度，
          // 第二行会按 x 坐标重新擦一遍，看起来就是乱的）。
          // 只有带逐字时间轴的行才走这里；普通 LRC 整句渲染，不做假读词。
          <span className="lyric-karaoke">
            {Array.from(line.text).map((char, index) => (
              <span key={index} className="lyric-char">
                {char}
              </span>
            ))}
          </span>
        ) : (
          line.text
        )}
      </div>
      {showRoman && line.roman && (
        <div className="lyric-sub lyric-roman">{line.roman}</div>
      )}
      {showTranslation && line.trans && (
        <div className="lyric-sub">{line.trans}</div>
      )}
    </div>
  )
}
