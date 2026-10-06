/**
 * 音频引擎：封装单个 HTMLAudioElement，统一处理播放、进度、音量与淡入淡出。
 * 渲染层只通过这个类操作音频，方便后续替换实现（例如 WebAudio 增益节点）。
 */

export interface AudioEngineEvents {
  timeupdate: (currentMs: number, durationMs: number) => void
  durationchange: (durationMs: number) => void
  ended: () => void
  playing: () => void
  pause: () => void
  waiting: () => void
  canplay: () => void
  error: (message: string) => void
  volumechange: (volume: number, muted: boolean) => void
}

type EventName = keyof AudioEngineEvents

const FADE_DURATION = 260

/**
 * 把 Chromium 的原始报错转成人能看懂的中文。
 * <audio> 的失败信息（"The element has no supported sources." 等）直接弹给用户毫无意义。
 */
export function friendlyAudioError(raw: string): string {
  if (
    /no supported sources|MEDIA_ELEMENT_ERROR|DEMUXER_ERROR|Format error/i.test(
      raw,
    )
  ) {
    return '无法播放该音频（格式不支持或文件已损坏）'
  }
  if (/not allowed|user gesture|interact/i.test(raw)) {
    return '系统阻止了自动播放，点击播放按钮重试'
  }
  if (/network|failed to fetch|load failed/i.test(raw)) {
    return '网络错误，无法加载音频'
  }
  if (/aborted|abort/i.test(raw)) return '播放已中止'
  return raw || '播放失败'
}

export class AudioEngine {
  private el: HTMLAudioElement
  private listeners: { [K in EventName]: Set<AudioEngineEvents[K]> } = {
    timeupdate: new Set(),
    durationchange: new Set(),
    ended: new Set(),
    playing: new Set(),
    pause: new Set(),
    waiting: new Set(),
    canplay: new Set(),
    error: new Set(),
    volumechange: new Set(),
  }

  private fadeTimer: number | null = null
  private userVolume = 0.7
  private userMuted = false

  constructor() {
    this.el = new Audio()
    this.el.preload = 'auto'
    // 注意：绝对不要设置 crossOrigin='anonymous'。
    // 网易云 CDN 不返回 Access-Control-Allow-Origin，一旦带上该属性，
    // <audio> 会因为跨域校验失败而完全无法播放。

    this.el.addEventListener('timeupdate', () => {
      this.emit('timeupdate', this.currentMs, this.durationMs)
    })
    this.el.addEventListener('durationchange', () => {
      this.emit('durationchange', this.durationMs)
    })
    this.el.addEventListener('loadedmetadata', () => {
      this.emit('durationchange', this.durationMs)
    })
    this.el.addEventListener('ended', () => this.emit('ended'))
    this.el.addEventListener('playing', () => this.emit('playing'))
    this.el.addEventListener('pause', () => this.emit('pause'))
    this.el.addEventListener('waiting', () => this.emit('waiting'))
    this.el.addEventListener('canplay', () => this.emit('canplay'))
    this.el.addEventListener('error', () =>
      this.emit('error', friendlyAudioError(this.describeError())),
    )
    this.el.addEventListener('volumechange', () => {
      this.emit('volumechange', this.el.volume, this.el.muted)
    })
  }

  /* ---------------- 事件 ---------------- */

  on<K extends EventName>(name: K, handler: AudioEngineEvents[K]): () => void {
    this.listeners[name].add(handler as never)
    return () => {
      this.listeners[name].delete(handler as never)
    }
  }

  private emit<K extends EventName>(
    name: K,
    ...args: Parameters<AudioEngineEvents[K]>
  ): void {
    for (const handler of this.listeners[name]) {
      try {
        ;(handler as (...a: unknown[]) => void)(...args)
      } catch {
        /* 单个监听器异常不影响其它监听器 */
      }
    }
  }

  private describeError(): string {
    const error = this.el.error
    if (!error) return '播放失败'
    switch (error.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        return '播放已中止'
      case MediaError.MEDIA_ERR_NETWORK:
        return '网络错误，无法加载音频'
      case MediaError.MEDIA_ERR_DECODE:
        return '音频解码失败（文件可能损坏）'
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        return '不支持的音频格式，或资源已失效'
      default:
        return '播放失败'
    }
  }
  /* ---------------- 基础信息 ---------------- */

  get currentMs(): number {
    return Math.round((this.el.currentTime || 0) * 1000)
  }

  get durationMs(): number {
    const duration = this.el.duration
    return Number.isFinite(duration) && duration > 0
      ? Math.round(duration * 1000)
      : 0
  }

  get paused(): boolean {
    return this.el.paused
  }

  get src(): string {
    return this.el.currentSrc || this.el.src
  }

  /* ---------------- 控制 ---------------- */

  setSource(url: string, autoplay = false): void {
    this.stopFade()
    // 同一地址重复赋值会重新加载，这里做一次判断
    if (this.el.src !== url) {
      this.el.src = url
      this.el.load()
    }
    this.el.volume = this.effectiveVolume()
    if (autoplay) void this.play()
  }

  clearSource(): void {
    this.stopFade()
    this.el.removeAttribute('src')
    this.el.load()
  }

  async play(): Promise<void> {
    try {
      await this.el.play()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // AbortError 是切换歌曲时的正常打断；若媒体元素已经抛出过 error
      // （el.error 不为空），说明错误已经上报过，再报一次会让提示叠两层。
      if (!/abort/i.test(message) && !this.el.error) {
        this.emit('error', friendlyAudioError(message))
      }
    }
  }

  pause(): void {
    this.el.pause()
  }

  seek(ms: number): void {
    const seconds = Math.max(0, ms / 1000)
    try {
      this.el.currentTime = seconds
    } catch {
      /* 元数据未就绪时忽略 */
    }
  }

  setVolume(volume: number): void {
    this.userVolume = Math.max(0, Math.min(1, volume))
    this.el.volume = this.effectiveVolume()
    this.el.muted = this.userMuted
  }

  setMuted(muted: boolean): void {
    this.userMuted = muted
    this.el.muted = muted
  }

  get volume(): number {
    return this.userVolume
  }

  get muted(): boolean {
    return this.userMuted
  }

  private effectiveVolume(): number {
    return this.userMuted ? 0 : this.userVolume
  }

  /* ---------------- 淡入淡出 ---------------- */

  private stopFade(): void {
    if (this.fadeTimer !== null) {
      window.clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }
  }

  fadeTo(target: number, duration = FADE_DURATION): void {
    this.stopFade()
    const from = this.el.volume
    const to = Math.max(0, Math.min(1, target))
    if (Math.abs(from - to) < 0.01) {
      this.el.volume = to
      return
    }
    const steps = Math.max(1, Math.round(duration / 16))
    let step = 0
    this.fadeTimer = window.setInterval(() => {
      step += 1
      const ratio = step / steps
      this.el.volume = from + (to - from) * ratio
      if (step >= steps) this.stopFade()
    }, 16)
  }

  /** 淡入播放 */
  fadeIn(): void {
    this.el.volume = 0
    void this.play()
    this.fadeTo(this.effectiveVolume())
  }

  /** 淡出后暂停 */
  fadeOut(onDone?: () => void): void {
    this.fadeTo(0)
    window.setTimeout(() => {
      this.pause()
      this.el.volume = this.effectiveVolume()
      onDone?.()
    }, FADE_DURATION)
  }

  destroy(): void {
    this.stopFade()
    this.el.pause()
    this.el.removeAttribute('src')
  }
}

/** 全局单例：整个应用只应存在一个音频元素 */
export const audioEngine = new AudioEngine()
