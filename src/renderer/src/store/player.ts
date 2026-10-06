import { create } from 'zustand'
import type {
  LyricPayload,
  PlayerCommand,
  PlayerSyncPayload,
  PlayMode,
  Settings,
  Song,
  SongUrlItem,
  SoundLevel,
} from '@shared/types'
import { audioEngine } from '@/lib/audio'
import { api, callApi, invalidateCache } from '@/lib/api'
import {
  EMPTY_LYRICS,
  findLineIndex,
  lineProgress,
  lyricOffsetMs,
  parseLyrics,
  type ParsedLyrics,
} from '@/lib/lyrics'
import { formatDuration } from '@/lib/format'
import { normalizeSong } from '@/lib/normalize'
import { currentUserId, useAuthStore } from './auth'
import { useSettingsStore } from './settings'
import { toast } from './toast'

export interface PlayContext {
  type:
    | 'playlist'
    | 'daily'
    | 'album'
    | 'artist'
    | 'search'
    | 'local'
    | 'cloud'
    | 'radio'
    | 'single'
    | 'download'
    | 'top'
  id?: number
  name?: string
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

interface PlayerState {
  ready: boolean
  queue: Song[]
  /** 随机播放前的原始顺序，关闭随机时恢复 */
  queueBackup: Song[]
  index: number
  playing: boolean
  status: PlayerStatus
  errorMessage: string
  position: number
  duration: number
  volume: number
  muted: boolean
  playMode: PlayMode
  level: SoundLevel
  context: PlayContext | null
  /** 心动模式插入的曲目（`source:id`），队列面板会给它们打标 */
  heartKeys: string[]
  /** 正在查看评论的歌曲；为 null 表示评论抽屉关闭 */
  commentTarget: Song | null
  /** 打开全屏播放页并要求自动滚到评论区（点评论按钮时用，否则用户以为没有评论区） */
  commentScrollPending: boolean
  lyrics: ParsedLyrics
  lyricsLoading: boolean
  likedIds: number[]
  likePending: boolean
  showNowPlaying: boolean
  showQueue: boolean
  /** 本地播放历史（未登录用户也能看「最近播放」） */
  history: Song[]

  /* 行为 */
  /** 打开歌曲评论抽屉（与播放队列互斥，避免两个抽屉重叠），用于查看任意歌曲 */
  openComments: (song: Song) => void
  closeComments: () => void
  /** 打开全屏播放页并滚到歌词下方的评论区（评论按钮的主路径） */
  openCommentsInline: () => void
  /** 消费一次「滚到评论区」请求 */
  consumeCommentScroll: () => boolean
  init: () => Promise<void>
  playSongs: (
    songs: Song[],
    startIndex?: number,
    context?: PlayContext,
  ) => Promise<void>
  playSong: (song: Song, context?: PlayContext) => Promise<void>
  playNextUp: (song: Song) => void
  addToQueue: (songs: Song[]) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  jumpTo: (index: number) => Promise<void>
  toggle: () => void
  next: (auto?: boolean) => Promise<void>
  prev: () => Promise<void>
  seek: (ms: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setPlayMode: (mode: PlayMode) => void
  setLevel: (level: SoundLevel) => Promise<void>
  loadLyrics: (songId: number) => Promise<void>
  toggleLike: (song?: Song) => Promise<void>
  isLiked: (songId?: number) => boolean
  loadLiked: () => Promise<void>
  setShowNowPlaying: (show: boolean) => void
  setShowQueue: (show: boolean) => void
  handleCommand: (command: PlayerCommand) => void
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function unique<T>(list: T[]): T[] {
  return [...new Set(list)]
}

function shuffleArray<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function songTitle(song?: Song): string {
  return song?.name ?? '未在播放'
}

export function songArtists(song?: Song): string {
  if (!song) return ''
  if (song.source === 'local') return song.ar?.[0]?.name ?? ''
  return (song.ar ?? []).map((a) => a.name).join(' / ')
}

/** 把本地音乐条目包装成播放器通用的 Song */
export function localTrackToSong(track: {
  id: number
  name: string
  artist: string
  album: string
  duration: number
  url: string
  coverUrl?: string
  coverPath?: string
  path: string
}): Song {
  return {
    id: track.id,
    name: track.name,
    ar: [{ id: 0, name: track.artist || '未知艺术家' }],
    al: { id: 0, name: track.album || '未知专辑', picUrl: track.coverUrl },
    dt: track.duration,
    source: 'local',
    localPath: track.path,
    localCoverPath: track.coverPath,
    url: track.url,
  }
}

/**
 * 把本地歌曲里可能已经过期的 ncmfile:// 地址按当前协议规则重算。
 * 播放队列是持久化的，协议格式一旦调整，历史地址就会全部失效，
 * 所以恢复队列时必须过一遍这里。
 */
async function refreshLocalUrls(song: Song): Promise<Song> {
  if (song.source !== 'local') return song
  const next: Song = { ...song }
  if (song.localPath) {
    const url = await window.ncm.app.localUrl(song.localPath)
    if (url) next.url = url
  }
  if (song.localCoverPath) {
    const cover = await window.ncm.app.localUrl(song.localCoverPath)
    if (cover) next.al = { ...(song.al ?? { id: 0, name: '' }), picUrl: cover }
  }
  return next
}

/* ------------------------------------------------------------------ */
/* 播放地址解析                                                        */
/* ------------------------------------------------------------------ */

interface ResolvedUrl {
  url: string
  level: SoundLevel
  trial: boolean
}

async function resolvePlayUrl(
  song: Song,
  preferred: SoundLevel,
): Promise<ResolvedUrl> {
  // 本地音乐（含已下载文件）不走接口。
  // 注意：不能直接信任 song.url —— 它可能来自持久化的播放队列，
  // 而协议格式一旦调整，历史地址就会失效；有 localPath 时一律现算。
  if (song.source === 'local') {
    if (song.localPath) {
      const url = await window.ncm.app.localUrl(song.localPath)
      if (url) return { url, level: preferred, trial: false }
    }
    if (song.url) return { url: song.url, level: preferred, trial: false }
  }

  const order = unique<SoundLevel>([preferred, 'exhigh', 'higher', 'standard'])
  let lastError = '无法获取播放地址'

  for (const level of order) {
    const res = await callApi<{ data?: SongUrlItem[] }>('song_url_v1', {
      id: song.id,
      level,
    })
    const item = res.body?.data?.[0]
    if (item?.url) {
      return { url: item.url, level, trial: !!item.freeTrialInfo }
    }
    if (item?.freeTrialInfo) lastError = '该歌曲仅提供试听片段'
    else if (!res.ok && res.error) lastError = res.error
  }

  throw new Error(lastError)
}

/* ------------------------------------------------------------------ */
/* 本地播放历史                                                        */
/* ------------------------------------------------------------------ */

const HISTORY_KEY = 'ncm.playHistory'
const HISTORY_LIMIT = 120

function loadHistory(): Song[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Song[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(list: Song[]): void {
  try {
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(list.slice(0, HISTORY_LIMIT)),
    )
  } catch {
    /* 存储不可用时忽略 */
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

let scrobbledIds = new Set<number>()
let syncTimer: number | null = null
/**
 * 生成要持久化的队列快照。
 *
 * 不能直接 slice(0, 300)：心动模式会不断往队列里插推荐，队列很快超过 300，
 * 那样被截掉的恰好是「还没听到的歌单尾部」，重启后静默丢失。
 * 这里保留当前曲目前方的少量历史 + 之后的最多 300 首，保证待播歌曲不丢。
 */
function queueSnapshot(
  queue: Song[],
  index: number,
): { songs: Song[]; index: number } {
  const historyKeep = 20
  const from = Math.max(0, index - historyKeep)
  return { songs: queue.slice(from, from + 300), index: index - from }
}

let persistTimer: number | null = null
let currentSettings: Settings | null = null
let engineBound = false
let quitHookBound = false

/**
 * 高频位置推送。
 *
 * `timeupdate` 只有 ~4Hz，意味着 position 最多滞后 250ms —— 而歌词行切换、
 * 进度条、逐字高亮全都挂在 position 上，叠加起来就是「歌词总是慢半拍」。
 * 播放时用 rAF 从音频时钟补齐，节流到 ~12Hz：够跟手，又不会让整棵树每帧重渲染。
 */
let positionRaf = 0
let lastPositionPush = 0
const POSITION_PUSH_MS = 80

/** 播放进度落盘的最小间隔：够细，又不至于每 250ms 写一次盘 */
const PROGRESS_SAVE_STEP_MS = 5000
/** 心动模式每次补充的歌曲数（服务端不遵守 count，需要本地截断） */
const HEART_FILL_COUNT = 12
/** 前方心动歌少于这个数就续补 */
const HEART_AHEAD_MIN = 3
/** 心动模式的推荐依据歌单（没有歌单上下文时兜底用「我喜欢的音乐」） */
let heartPlaylistId: number | null = null
/** 已经提示过的失败原因，避免重复弹 toast */
const heartWarned = new Set<string>()
/** 本次会话是否已经提示过「已加入推荐」 */
let heartAnnounced = false
/** 上次落盘的进度，用来判断是否够一个间隔了 */
let lastSavedProgress = -1

export const usePlayerStore = create<PlayerState>((set, get) => {
  /* ---------- 内部辅助 ---------- */

  function persistQueue(): void {
    if (persistTimer !== null) window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      persistTimer = null
      const { queue, index, position, context } = get()
      lastSavedProgress = position
      const snapshot = queueSnapshot(queue, index)
      void window.ncm.config
        .set('lastQueue', {
          songs: snapshot.songs,
          index: snapshot.index,
          progress: position,
          context: context ?? null,
          heartKeys: get().heartKeys,
        })
        .catch(() => undefined)
    }, 800)
  }

  function pushHistory(song: Song): void {
    const list = get().history.filter(
      (item) => item.id !== song.id || item.source !== song.source,
    )
    const next = [song, ...list].slice(0, HISTORY_LIMIT)
    set({ history: next })
    saveHistory(next)
  }

  function buildSyncPayload(): PlayerSyncPayload {
    const { playing, queue, index, position, duration, lyrics } = get()
    const song = queue[index]
    // 桌面歌词窗口与主界面共用同一个偏移，避免两处显示的当前句不一致
    const lineIndex = findLineIndex(lyrics.lines, position + lyricOffsetMs())
    const current = lineIndex >= 0 ? lyrics.lines[lineIndex] : undefined
    const next =
      lineIndex + 1 < lyrics.lines.length
        ? lyrics.lines[lineIndex + 1]
        : undefined
    return {
      playing,
      songName: songTitle(song),
      artistName: songArtists(song),
      current: current?.text ?? '',
      currentTrans: current?.trans ?? '',
      next: next?.text ?? '',
      lineProgress: lineProgress(current, position),
      position,
      duration: duration || song?.dt || 0,
    }
  }

  function startSyncTimer(): void {
    if (syncTimer !== null) return
    syncTimer = window.setInterval(() => {
      if (!window.ncm) return
      window.ncm.player.sync(buildSyncPayload())
    }, 250)
  }

  async function reportScrobble(song: Song, seconds: number): Promise<void> {
    if (song.source === 'local') return
    try {
      await callApi('scrobble', {
        id: song.id,
        sourceid: get().context?.id ?? 0,
        time: Math.max(0, Math.round(seconds)),
        source: 'list',
      })
    } catch {
      /* 打卡失败不影响播放 */
    }
  }

  /** 真正开始播放某一首；restore=true 表示恢复上次会话，不打卡/不加历史 */
  async function startSong(
    song: Song,
    autoplay = true,
    restore = false,
  ): Promise<void> {
    const { level } = get()
    set({
      status: 'loading',
      errorMessage: '',
      duration: song.dt ?? 0,
      position: 0,
    })
    try {
      const resolved = await resolvePlayUrl(song, level)
      audioEngine.setVolume(get().volume)
      audioEngine.setMuted(get().muted)
      audioEngine.setSource(resolved.url, false)
      if (autoplay) {
        if (currentSettings?.fadeInOut) audioEngine.fadeIn()
        else void audioEngine.play()
      }
      set({
        status: autoplay ? 'playing' : 'paused',
        playing: autoplay,
      })
      if (resolved.trial && !restore)
        toast.info('该歌曲仅提供试听片段，开通会员可听完整版')
      void get().loadLyrics(song.id)
      if (!restore) {
        pushHistory(song)
        scrobbledIds = new Set<number>()
        void reportScrobble(song, 0)
        void maybeFillIntelligence(song)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '播放失败'
      set({ status: 'error', errorMessage: message, playing: false })
      toast.error(`${song.name}：${message}`)
    }
  }

  /**
   * 心动模式需要一个「歌单 id」作为推荐依据。
   *
   * 必须挑真正是歌单的上下文：专辑/歌手/搜索的 id 不是歌单 id，
   * 传过去服务端会直接回「歌单不存在」；pid 为空时接口返回 500。
   * 没有歌单上下文时兜底用「我喜欢的音乐」，与网易云自身的心动模式一致。
   */
  async function resolveHeartPlaylistId(): Promise<number | null> {
    const { context } = get()
    if (
      context?.id &&
      (context.type === 'playlist' ||
        context.type === 'top' ||
        context.type === 'radio')
    ) {
      return context.id
    }
    if (heartPlaylistId !== null) return heartPlaylistId
    const uid = currentUserId()
    if (!uid) return null
    try {
      const body = await api<{ playlist?: { id: number }[] }>('user_playlist', {
        uid,
        limit: 1,
      })
      heartPlaylistId = body.playlist?.[0]?.id ?? null
    } catch {
      return null
    }
    return heartPlaylistId
  }

  const songKey = (song: Song): string =>
    `${song.source ?? 'netease'}:${song.id}`

  /** 当前曲目之后还剩几首心动推荐 */
  function heartAheadCount(): number {
    const { queue, index, heartKeys } = get()
    const set = new Set(heartKeys)
    return queue.slice(index + 1).filter((song) => set.has(songKey(song)))
      .length
  }

  /**
   * 心动模式补歌。
   *
   * 关键：推荐必须**插在当前曲目之后**，不能追加到队尾 ——
   * 283 首的歌单里追加到队尾，用户永远听不到，功能等于没生效。
   * 触发条件是「前方剩下的心动歌不足 3 首」，这样开启模式时会立刻补、
   * 听的过程中也会持续续上，而不是等到歌单快放完。
   */
  async function maybeFillIntelligence(song: Song): Promise<void> {
    const { playMode } = get()
    if (playMode !== 'heart') return
    if (heartAheadCount() >= HEART_AHEAD_MIN) return

    const pid = await resolveHeartPlaylistId()
    if (!pid) {
      warnHeartOnce('心动模式需要先从一个歌单开始播放')
      return
    }

    try {
      const body = await api<{ data?: unknown[] }>(
        'playmode_intelligence_list',
        {
          id: song.id,
          pid,
          sid: song.id,
          count: HEART_FILL_COUNT,
        },
      )

      const { queue, index } = get()
      const existing = new Set(queue.map(songKey))
      const fresh: Song[] = []
      for (const raw of body.data ?? []) {
        // 接口返回 { id, alg, recommended, songInfo }，歌曲本体在 songInfo 里
        const source = (raw as { songInfo?: unknown })?.songInfo ?? raw
        const normalized = normalizeSong(source)
        if (!normalized?.id) continue
        const key = songKey(normalized)
        if (existing.has(key)) continue
        existing.add(key)
        fresh.push(normalized)
        // 服务端不遵守 count（实测请求 12 返回 148 条），这里自己截断
        if (fresh.length >= HEART_FILL_COUNT) break
      }

      if (fresh.length === 0) {
        warnHeartOnce('心动模式暂时没有新的推荐')
        return
      }

      // 插到当前曲目之后：index 不变，后面的歌顺延
      const next = [...queue]
      next.splice(index + 1, 0, ...fresh)
      set({
        queue: next,
        heartKeys: [...get().heartKeys, ...fresh.map(songKey)],
      })
      persistQueue()
      heartPlaylistId = pid
      if (heartAnnounced)
        toast.success(`心动模式：已为你加入 ${fresh.length} 首推荐`)
      heartAnnounced = true
    } catch (error) {
      // 以前这里是空 catch，接口 500 也毫无痕迹，功能等于静默失效
      warnHeartOnce(
        `心动模式补歌失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 同一类失败只提示一次，避免每首歌都弹 */
  function warnHeartOnce(message: string): void {
    if (heartWarned.has(message)) return
    heartWarned.add(message)
    console.warn(`[heart] ${message}`)
    toast.info(message)
  }

  async function goToIndex(target: number, autoplay = true): Promise<void> {
    const { queue } = get()
    if (queue.length === 0) return
    const safe = ((target % queue.length) + queue.length) % queue.length
    set({ index: safe })
    persistQueue()
    await startSong(queue[safe], autoplay)
  }

  function pickNextIndex(auto: boolean): number | null {
    const { queue, index, playMode } = get()
    if (queue.length === 0) return null
    if (queue.length === 1)
      return playMode === 'single' && auto ? index : auto ? null : index

    switch (playMode) {
      case 'single':
        return auto ? index : (index + 1) % queue.length
      case 'shuffle': {
        let candidate = index
        while (candidate === index)
          candidate = Math.floor(Math.random() * queue.length)
        return candidate
      }
      case 'heart':
        return (index + 1) % queue.length
      case 'loop':
        return (index + 1) % queue.length
      case 'order':
      default:
        if (index + 1 < queue.length) return index + 1
        return auto ? null : 0
    }
  }

  /* ---------- 音频引擎事件绑定 ---------- */

  function startPositionTicker(): void {
    if (positionRaf) return
    const step = (): void => {
      positionRaf = requestAnimationFrame(step)
      const now = audioEngine.currentMs
      if (
        now - lastPositionPush >= POSITION_PUSH_MS ||
        now < lastPositionPush
      ) {
        lastPositionPush = now
        set({ position: now })
      }
    }
    positionRaf = requestAnimationFrame(step)
  }

  function stopPositionTicker(): void {
    if (!positionRaf) return
    cancelAnimationFrame(positionRaf)
    positionRaf = 0
  }

  function bindEngine(): void {
    if (engineBound) return
    engineBound = true

    audioEngine.on('timeupdate', (currentMs) => {
      const { duration } = get()
      set({ position: currentMs })

      // 进度必须周期性落盘。以前只在「队列变化」时写 lastQueue，
      // 于是 progress 永远停在刚点歌那一刻（实测只有 4 秒），
      // 重启后自然是从头开始而不是接着上次的地方。
      if (Math.abs(currentMs - lastSavedProgress) >= PROGRESS_SAVE_STEP_MS) {
        // 必须在这里就记账，不能等 persistQueue 的防抖回调去更新它：
        // timeupdate 每 ~250ms 一次，条件若一直成立就会不停重置 800ms 计时器，
        // 计时器被无限推后 —— 表现为进度永远不落盘。
        lastSavedProgress = currentMs
        persistQueue()
      }

      const song = get().queue[get().index]
      if (!song || song.source === 'local') return
      const total = duration || song.dt || 0
      // 网易云打卡规则：播放超过 50% 或 240 秒
      if (
        total > 0 &&
        !scrobbledIds.has(song.id) &&
        (currentMs >= total * 0.5 || currentMs >= 240_000)
      ) {
        scrobbledIds.add(song.id)
        void reportScrobble(song, currentMs / 1000)
      }
    })

    audioEngine.on('durationchange', (durationMs) => {
      const song = get().queue[get().index]
      const fallback = song?.dt ?? 0
      set({ duration: durationMs > 0 ? durationMs : fallback })
    })

    audioEngine.on('playing', () => {
      set({ playing: true, status: 'playing' })
      startPositionTicker()
    })

    audioEngine.on('pause', () => {
      stopPositionTicker()
      // 切换歌曲时也会触发 pause，此时状态由 startSong 决定
      if (get().status === 'loading') return
      set({ playing: false, status: 'paused' })
      // 暂停是「用户要离开」的信号，立刻记下当前位置
      persistQueue()
    })

    audioEngine.on('ended', () => {
      void get().next(true)
    })

    audioEngine.on('error', (message) => {
      set({ status: 'error', errorMessage: message, playing: false })
      const song = get().queue[get().index]
      if (song) toast.error(`${song.name}：${message}`)
    })

    audioEngine.on('volumechange', (volume, muted) => {
      if (Math.abs(get().volume - volume) > 0.001 || get().muted !== muted)
        set({ volume, muted })
    })

    startSyncTimer()
  }

  /* ---------- 对外 ---------- */

  return {
    ready: false,
    queue: [],
    queueBackup: [],
    index: 0,
    playing: false,
    status: 'idle',
    errorMessage: '',
    position: 0,
    duration: 0,
    volume: 0.7,
    muted: false,
    playMode: 'order',
    level: 'exhigh',
    context: null,
    heartKeys: [],
    commentTarget: null,
    commentScrollPending: false,
    lyrics: EMPTY_LYRICS,
    lyricsLoading: false,
    likedIds: [],
    likePending: false,
    showNowPlaying: false,
    showQueue: false,
    history: loadHistory(),

    init: async () => {
      const settings = await window.ncm.config.all().catch(() => null)
      currentSettings = settings
      if (settings) {
        set({
          volume: settings.volume,
          muted: settings.muted,
          playMode: settings.playMode,
          level: settings.level,
        })
        audioEngine.setVolume(settings.volume)
        audioEngine.setMuted(settings.muted)
      }
      bindEngine()

      if (
        settings?.resumeOnStart &&
        settings.lastQueue &&
        settings.lastQueue.songs.length > 0
      ) {
        const { index, progress } = settings.lastQueue
        // 恢复前重算本地文件的播放地址与封面：
        // 队列是持久化的，协议格式一变，历史地址就会全部失效。
        const songs = await Promise.all(
          settings.lastQueue.songs.map(refreshLocalUrls),
        )
        set({
          queue: songs,
          index: Math.min(index, songs.length - 1),
          position: progress ?? 0,
          // 还原播放来源：心动模式的推荐依据、以及播放上报的 sourceid 都依赖它
          context: (settings.lastQueue.context as PlayContext | null) ?? null,
          heartKeys: settings.lastQueue.heartKeys ?? [],
        })
        const song = songs[Math.min(index, songs.length - 1)]
        if (song) {
          // 恢复时不自动播放，只把进度准备好
          await startSong(song, false, true)
          const resumeAt = progress ?? 0
          audioEngine.seek(resumeAt)
          // startSong 内部会把 position 归零，这里要还原：
          // 否则刚打开界面显示 0:00，要等第一次 timeupdate 才纠正
          set({ position: resumeAt })
          lastSavedProgress = resumeAt
          // 启动时若已是心动模式，立刻补一轮 —— 否则要等用户切一首歌才生效
          if (get().playMode === 'heart') void maybeFillIntelligence(song)
        }
      }

      set({ ready: true })
      if (useAuthStore.getState().loggedIn) void get().loadLiked()
    },

    playSongs: async (songs, startIndex = 0, context) => {
      const list = songs.filter(Boolean)
      if (list.length === 0) return
      const safeIndex = Math.max(0, Math.min(startIndex, list.length - 1))
      set({
        queue: list,
        queueBackup: list,
        index: safeIndex,
        context: context ?? null,
        showQueue: false,
      })
      persistQueue()
      await startSong(list[safeIndex], true)
    },

    playSong: async (song, context) => {
      await get().playSongs(
        [song],
        0,
        context ?? { type: 'single', name: song.name },
      )
    },

    playNextUp: (song) => {
      const { queue, index } = get()
      const next = [...queue]
      next.splice(index + 1, 0, song)
      set({ queue: next })
      persistQueue()
      toast.success('已设为下一首播放')
    },

    addToQueue: (songs) => {
      if (songs.length === 0) return
      const existing = new Set(
        get().queue.map((item) => `${item.id}-${item.source ?? 'netease'}`),
      )
      const fresh = songs.filter(
        (song) => !existing.has(`${song.id}-${song.source ?? 'netease'}`),
      )
      if (fresh.length === 0) {
        toast.info('歌曲已在播放列表中')
        return
      }
      set({ queue: [...get().queue, ...fresh] })
      persistQueue()
      toast.success(`已添加 ${fresh.length} 首到播放列表`)
    },

    removeFromQueue: (target) => {
      const { queue, index } = get()
      if (target < 0 || target >= queue.length) return
      const next = queue.filter((_, i) => i !== target)
      let nextIndex = index
      if (target < index) nextIndex = index - 1
      else if (target === index) nextIndex = Math.min(index, next.length - 1)
      set({ queue: next, index: Math.max(0, nextIndex) })
      persistQueue()
      if (next.length === 0) {
        audioEngine.clearSource()
        set({ playing: false, status: 'idle', position: 0, duration: 0 })
      }
    },

    clearQueue: () => {
      audioEngine.clearSource()
      set({
        queue: [],
        queueBackup: [],
        index: 0,
        playing: false,
        status: 'idle',
        position: 0,
        duration: 0,
        lyrics: EMPTY_LYRICS,
      })
      persistQueue()
    },

    jumpTo: async (target) => {
      await goToIndex(target, true)
    },

    toggle: () => {
      const { playing, status, queue } = get()
      if (queue.length === 0) return
      if (status === 'error') {
        void goToIndex(get().index, true)
        return
      }
      if (playing) {
        if (currentSettings?.fadeInOut) audioEngine.fadeOut()
        else audioEngine.pause()
        set({ playing: false, status: 'paused' })
      } else {
        if (currentSettings?.fadeInOut) audioEngine.fadeIn()
        else void audioEngine.play()
        set({ playing: true, status: 'playing' })
      }
    },

    next: async (auto = false) => {
      const target = pickNextIndex(auto)
      if (target === null) {
        set({ playing: false, status: 'paused', position: 0 })
        audioEngine.pause()
        return
      }
      await goToIndex(target, true)
    },

    prev: async () => {
      // 播放超过 3 秒时，上一首先回到本曲开头（与主流播放器一致）
      if (get().position > 3000) {
        get().seek(0)
        return
      }
      const { queue, index, playMode } = get()
      if (queue.length === 0) return
      const target =
        playMode === 'shuffle'
          ? Math.floor(Math.random() * queue.length)
          : index - 1
      await goToIndex(
        target === index && queue.length > 1 ? index - 1 : target,
        true,
      )
    },

    seek: (ms) => {
      audioEngine.seek(ms)
      set({ position: ms })
      // 手动拖动后马上记住，别等下一个 5 秒窗口
      persistQueue()
    },

    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(1, volume))
      audioEngine.setVolume(clamped)
      audioEngine.setMuted(false)
      set({ volume: clamped, muted: false })
      void window.ncm.config.set('volume', clamped).catch(() => undefined)
      void window.ncm.config.set('muted', false).catch(() => undefined)
    },

    toggleMute: () => {
      const muted = !get().muted
      audioEngine.setMuted(muted)
      set({ muted })
      void window.ncm.config.set('muted', muted).catch(() => undefined)
    },

    setPlayMode: (mode) => {
      const { queue, index, playMode, queueBackup } = get()
      if (mode === playMode) return
      const current = queue[index]

      if (mode === 'shuffle' && queue.length > 1) {
        const rest = queue.filter((_, i) => i !== index)
        const shuffled = [current, ...shuffleArray(rest)].filter(
          Boolean,
        ) as Song[]
        set({
          playMode: mode,
          queueBackup: queueBackup.length ? queueBackup : queue,
          queue: shuffled,
          index: 0,
        })
      } else if (
        playMode === 'shuffle' &&
        queueBackup.length === queue.length
      ) {
        const restoredIndex = current
          ? queueBackup.findIndex((item) => item.id === current.id)
          : 0
        set({
          playMode: mode,
          queue: queueBackup,
          index: restoredIndex >= 0 ? restoredIndex : 0,
        })
      } else {
        set({ playMode: mode })
      }

      void window.ncm.config.set('playMode', mode).catch(() => undefined)
      if (mode === 'heart' && current) void maybeFillIntelligence(current)
    },

    setLevel: async (level) => {
      set({ level })
      void window.ncm.config.set('level', level).catch(() => undefined)
      const song = get().queue[get().index]
      if (song && get().status !== 'idle') {
        const wasPlaying = get().playing
        await startSong(song, wasPlaying)
        audioEngine.seek(get().position)
      }
    },

    loadLyrics: async (songId) => {
      set({ lyricsLoading: true })
      try {
        const body = await api<LyricPayload>('lyric_new', { id: songId })
        // 切歌期间可能已经换了另一首，丢弃过期结果
        if (get().queue[get().index]?.id !== songId) {
          set({ lyricsLoading: false })
          return
        }
        set({ lyrics: parseLyrics(body), lyricsLoading: false })
      } catch {
        set({ lyrics: EMPTY_LYRICS, lyricsLoading: false })
      }
    },

    toggleLike: async (song) => {
      const target = song ?? get().queue[get().index]
      if (!target) return
      if (!useAuthStore.getState().loggedIn) {
        toast.info('请先登录后再收藏')
        return
      }
      const liked = get().likedIds.includes(target.id)
      const nextLiked = liked
        ? get().likedIds.filter((id) => id !== target.id)
        : [...get().likedIds, target.id]
      set({ likedIds: nextLiked, likePending: true })
      try {
        await api('song_like', { id: target.id, like: !liked })
        toast.success(liked ? '已取消喜欢' : '已添加到我喜欢的音乐')
        invalidateCache('likelist')
      } catch (error) {
        set({ likedIds: get().likedIds.filter((id) => id !== target.id) })
        toast.fromError(error, '操作失败')
      } finally {
        set({ likePending: false })
      }
    },

    isLiked: (songId) => {
      if (!songId) return false
      return get().likedIds.includes(songId)
    },

    loadLiked: async () => {
      const profile = useAuthStore.getState().profile
      if (!profile) return
      try {
        const body = await api<{ ids?: number[] }>('likelist', {
          uid: profile.userId,
        })
        set({ likedIds: body.ids ?? [] })
      } catch {
        /* 未登录或接口异常时静默 */
      }
    },

    setShowNowPlaying: (show) => set({ showNowPlaying: show }),
    setShowQueue: (show) =>
      // 两个抽屉占同一个位置，开一个就关掉另一个
      set({
        showQueue: show,
        commentTarget: show ? null : get().commentTarget,
      }),

    openComments: (song) => set({ commentTarget: song, showQueue: false }),

    closeComments: () => set({ commentTarget: null }),

    openCommentsInline: () =>
      set({
        showNowPlaying: true,
        showQueue: false,
        commentTarget: null,
        commentScrollPending: true,
      }),

    consumeCommentScroll: () => {
      const pending = get().commentScrollPending
      if (pending) set({ commentScrollPending: false })
      return pending
    },

    handleCommand: (command) => {
      const store = get()
      switch (command) {
        case 'toggle':
          store.toggle()
          break
        case 'next':
          void store.next(false)
          break
        case 'prev':
          void store.prev()
          break
        case 'volume-up':
          store.setVolume(Math.min(1, store.volume + 0.05))
          break
        case 'volume-down':
          store.setVolume(Math.max(0, store.volume - 0.05))
          break
        case 'toggle-mute':
          store.toggleMute()
          break
        case 'seek-forward':
          store.seek(Math.min(store.duration, store.position + 10_000))
          break
        case 'seek-backward':
          store.seek(Math.max(0, store.position - 10_000))
          break
        case 'toggle-like':
          void store.toggleLike()
          break
        case 'toggle-desktop-lyric': {
          const open = !useSettingsStore.getState().settings.desktopLyric
          void window.ncm.win.setLyric(open)
          break
        }
        default:
          break
      }
    },
  }
})

/* ------------------------------------------------------------------ */
/* 派生选择器                                                          */
/* ------------------------------------------------------------------ */

export const selectCurrentSong = (state: PlayerState): Song | undefined =>
  state.queue[state.index]

export const selectProgress = (state: PlayerState): number =>
  state.duration > 0 ? Math.min(1, state.position / state.duration) : 0

export const selectDurationText = (state: PlayerState): string =>
  formatDuration(state.duration || selectCurrentSong(state)?.dt)

export const selectPositionText = (state: PlayerState): string =>
  formatDuration(state.position)

/** 桌面歌词开关变化时同步给主进程（设置页调用） */
export async function setDesktopLyric(open: boolean): Promise<void> {
  await window.ncm.win.setLyric(open)
  currentSettings = { ...(currentSettings as Settings), desktopLyric: open }
}

/** 更新缓存里的设置（settings store 更新后调用，避免读旧值） */
export function syncPlayerSettings(settings: Settings): void {
  currentSettings = settings
}

/**
 * 立即把播放状态落盘，绕过防抖。
 * 关窗/退出时用，避免刚好落在 800ms 防抖窗口里丢掉最后一段进度。
 */
export function flushPlaybackState(): void {
  const { queue, index, position, context } = usePlayerStore.getState()
  if (queue.length === 0) return
  lastSavedProgress = position
  const snapshot = queueSnapshot(queue, index)
  void window.ncm.config
    .set('lastQueue', {
      songs: snapshot.songs,
      index: snapshot.index,
      progress: position,
      context: context ?? null,
      heartKeys: usePlayerStore.getState().heartKeys,
    })
    .catch(() => undefined)
}

/** 只绑定一次退出钩子 */
export function bindQuitFlush(): void {
  if (quitHookBound) return
  quitHookBound = true
  window.addEventListener('beforeunload', flushPlaybackState)
}
