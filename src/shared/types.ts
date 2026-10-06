/**
 * 与网易云 API 返回结构对齐的领域模型。
 *
 * 说明：这些类型描述的是**经过 API 层返回的原始结构**，字段全部可选化处理，
 * 因为上游不同接口对同一实体的裁剪程度不一致（例如 `playlist_detail` 会带
 * `tracks`，而 `user_playlist` 只带 `trackCount`）。渲染层必须对可选字段做兜底。
 */

/** 主进程代理 API 调用后的统一返回 */
export interface NcmApiResponse<T = unknown> {
  /** 请求是否成功（HTTP 与业务 code 均正常） */
  ok: boolean
  /** HTTP 状态码 */
  status: number
  /** 业务响应体（失败时为上游错误体或空对象） */
  body: T
  /** 失败原因；ok 为 true 时不存在 */
  error?: string
}

/** API 引导状态：匿名 token / xeapi 公钥是否就绪 */
export interface ApiStatus {
  ready: boolean
  apiRoot: string
  version: string
  /** 已加载的接口模块数量 */
  moduleCount: number
  bootstrapping: boolean
  bootstrapError?: string
}

/**
 * 后端 API 的安装进度（首次启动要下载源码 + 依赖，合计约 21MB）。
 * 主进程在安装过程中持续广播，界面据此显示进度条与实时日志。
 */
export interface ApiProgress {
  /** 阶段机：idle 空闲 / fetch 取源码 / deps 取依赖 / verify 自检 / ready 完成 / error 失败 */
  phase: 'idle' | 'fetch' | 'deps' | 'verify' | 'ready' | 'error'
  /** 面向用户的一句话说明 */
  message: string
  /** 0~1 */
  ratio: number
  /** 最近几行原始日志（等宽展示，让用户看到「确实在动」） */
  log: string[]
  /** 失败时的错误信息 */
  error?: string
}

export interface Artist {
  id: number
  name: string
  picUrl?: string
  img1v1Url?: string
  alias?: string[]
  briefDesc?: string
  albumSize?: number
  musicSize?: number
  followed?: boolean
  trans?: string | null
}

export interface Album {
  id: number
  name: string
  picUrl?: string
  coverImgUrl?: string
  artists?: Artist[]
  artist?: Artist
  size?: number
  publishTime?: number
  company?: string
  description?: string
  subType?: string
  alias?: string[]
  songs?: Song[]
}

export interface Privilege {
  id: number
  fee?: number
  payed?: number
  st?: number
  pl?: number
  dl?: number
  sp?: number
  cp?: number
  subp?: number
  fl?: number
  maxbr?: number
  toast?: boolean
  flag?: number
}

export type MusicSource = 'netease' | 'cloud' | 'local'

export interface Song {
  id: number
  name: string
  /** 艺术家列表 */
  ar?: Artist[]
  /** 专辑 */
  al?: Album
  /** 时长（毫秒） */
  dt?: number
  fee?: number
  mv?: number
  alia?: string[]
  no?: number
  pop?: number
  privilege?: Privilege
  /** 云盘歌曲才有 */
  pc?: { nickname?: string }
  /** 本地音乐专用：文件绝对路径 */
  localPath?: string
  /** 本地音乐专用：封面缓存文件绝对路径 */
  localCoverPath?: string
  /** 本地音乐专用：文件大小（字节） */
  localSize?: number
  /** 数据来源 */
  source?: MusicSource
  /** 是否为本地扫描标记的“不可播放”项 */
  unavailable?: boolean
  /** 播放地址附带（播放时写入） */
  url?: string
  /** 音质标记 */
  level?: SoundLevel
}

/** 兼容旧版字段命名的歌曲（部分接口返回 artists/album/duration） */
export interface LegacySong {
  id: number
  name: string
  artists?: Artist[]
  album?: Album
  duration?: number
  mv?: number
  alias?: string[]
  fee?: number
}

export type SoundLevel =
  | 'standard'
  | 'higher'
  | 'exhigh'
  | 'lossless'
  | 'hires'
  | 'jyeffect'
  | 'sky'
  | 'jymaster'

export interface UserProfile {
  userId: number
  nickname: string
  avatarUrl?: string
  backgroundUrl?: string
  signature?: string
  description?: string
  gender?: number
  birthday?: number
  province?: number
  city?: number
  vipType?: number
  followeds?: number
  follows?: number
  playlistCount?: number
  playlistBeSubscribedCount?: number
  eventCount?: number
  accountStatus?: number
  createTime?: number
  level?: number
  listenSongs?: number
  followed?: boolean
  mutual?: boolean
}

export interface Playlist {
  id: number
  name: string
  coverImgUrl?: string
  picUrl?: string
  creator?: UserProfile
  userId?: number
  trackCount?: number
  playCount?: number
  subscribedCount?: number
  shareCount?: number
  commentCount?: number
  description?: string
  tags?: string[]
  subscribed?: boolean
  specialType?: number
  updateTime?: number
  createTime?: number
  tracks?: Song[]
  trackIds?: Array<{ id: number }>
  highQuality?: boolean
  privacy?: number
  copywriter?: string
}

export interface CommentReplied {
  user?: UserProfile
  beRepliedCommentId?: number
  content?: string
}

export interface Comment {
  commentId: number
  content: string
  time: number
  user: UserProfile
  likedCount: number
  liked?: boolean
  beReplied?: CommentReplied[]
  repliedCount?: number
  ipLocation?: { location?: string; userId?: number }
  showFloorComment?: {
    replyCount?: number
    comments?: Comment[] | null
    showReplyCount?: boolean
  }
}

export interface LyricPayload {
  lrc?: { lyric?: string; version?: number }
  tlyric?: { lyric?: string; version?: number }
  romalrc?: { lyric?: string; version?: number }
  yrc?: { lyric?: string; version?: number }
  ytlrc?: { lyric?: string; version?: number }
  romayrc?: { lyric?: string; version?: number }
  klyric?: { lyric?: string; version?: number }
  pureMusic?: boolean
  code?: number
}

export interface SongUrlItem {
  id: number
  url: string | null
  br?: number
  size?: number
  md5?: string
  code?: number
  expi?: number
  type?: string
  gain?: number
  peak?: number
  fee?: number
  level?: string
  freeTrialInfo?: { start: number; end: number } | null
  freeTrialPrivilege?: { resConsumable?: boolean; userConsumable?: boolean }
  time?: number
}

export interface Mv {
  id: number | string
  name: string
  artistId?: number
  artistName?: string
  artists?: Artist[]
  cover?: string
  picUrl?: string
  duration?: number
  playCount?: number
  subCount?: number
  shareCount?: number
  commentCount?: number
  publishTime?: string
  briefDesc?: string
  desc?: string
}

export interface DjProgram {
  id: number
  name: string
  coverUrl?: string
  mainSong?: Song
  duration?: number
  listenerCount?: number
  commentCount?: number
  description?: string
  createTime?: number
  radio?: DjRadio
}

export interface DjRadio {
  id: number
  name: string
  picUrl?: string
  desc?: string
  programCount?: number
  subCount?: number
  playCount?: number
  category?: string
  dj?: UserProfile
  radioFeeType?: number
  /** 当前登录用户是否已订阅（dj_detail 返回） */
  subscribed?: boolean
  /** 订阅人数（部分接口字段名） */
  subed?: boolean
}

export interface SearchResult<T = Song> {
  songs?: T[]
  songCount?: number
  playlists?: Playlist[]
  playlistCount?: number
  artists?: Artist[]
  artistCount?: number
  albums?: Album[]
  albumCount?: number
  mvs?: Mv[]
  mvCount?: number
  djRadios?: DjRadio[]
  djRadiosCount?: number
  userprofiles?: UserProfile[]
  userprofileCount?: number
  order?: string | string[]
}

/* ------------------------------------------------------------------ */
/* 应用自身模型                                                          */
/* ------------------------------------------------------------------ */

export type PlayMode = 'order' | 'loop' | 'single' | 'shuffle' | 'heart'

export interface QualityOption {
  level: SoundLevel
  label: string
  /** 低于该等级时视为不可用（部分歌曲无无损） */
  desc: string
}

export interface DownloadTask {
  id: string
  songId: number
  name: string
  artist: string
  album?: string
  coverUrl?: string
  /** 0-100，-1 表示未知 */
  progress: number
  /** 已下载字节 */
  receivedBytes: number
  totalBytes: number
  status: 'pending' | 'downloading' | 'done' | 'error' | 'canceled'
  error?: string
  filePath?: string
  /** 下载完成后的本地播放地址（ncmfile://），未完成时为 undefined */
  url?: string
  level: SoundLevel
  /** 字节/秒 */
  speed: number
  createdAt: number
}

export interface LocalTrack {
  /** 由文件绝对路径哈希得到的稳定 id */
  id: number
  path: string
  /** ncmfile:// 播放地址（主进程生成，渲染层直接用） */
  url: string
  name: string
  artist: string
  album: string
  /** 毫秒 */
  duration: number
  size: number
  /** 有封面时为主进程落盘的缓存文件路径 */
  coverPath?: string
  /** 封面播放地址（ncmfile://） */
  coverUrl?: string
  mtime: number
}

export interface AppPaths {
  userData: string
  music: string
  download: string
  cache: string
  localCoverCache: string
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  apiRoot: string
  paths: AppPaths
  dev: boolean
}

export interface Settings {
  /** 播放音质 */
  level: SoundLevel
  /** 音量 0-1 */
  volume: number
  /** 是否静音 */
  muted: boolean
  /** 播放模式 */
  playMode: PlayMode
  /** 桌面歌词开关 */
  desktopLyric: boolean
  /** 桌面歌词锁定（点击穿透） */
  lyricLocked: boolean
  /** 桌面歌词字号 */
  lyricFontSize: number
  /** 桌面歌词透明度 0-1 */
  lyricOpacity: number
  /**
   * 歌词整体偏移（毫秒）。正数 = 歌词提前（觉得歌词慢就调大），负数 = 延后。
   * 当前行判定与逐字读词共用它，保证两者不会互相错位。
   */
  lyricOffset: number
  /** 歌词窗口位置 */
  lyricPosition?: { x: number; y: number; width: number; height: number }
  /** 关闭主窗口时最小化到托盘而不是退出 */
  minimizeToTray: boolean
  /** 开机自启 */
  autoLaunch: boolean
  /** 全局快捷键开关 */
  globalShortcut: boolean
  /** 本地音乐扫描目录 */
  localFolders: string[]
  /** 下载目录（空则用默认） */
  downloadDir: string
  /** 下载音质 */
  downloadLevel: SoundLevel
  /** 下载时是否同时保存歌词（.lrc）与封面（.jpg）附属文件 */
  downloadSaveExtra: boolean
  /** 主窗口尺寸记忆 */
  windowBounds?: { x?: number; y?: number; width: number; height: number }
  /** 迷你模式 */
  /** 记忆的播放队列（跨重启恢复） */
  lastQueue?: {
    songs: Song[]
    index: number
    progress: number
    /** 播放来源（歌单/专辑/…）：心动模式要靠它拿推荐依据，上报也用它当 sourceid */
    context?: { type: string; id?: number; name?: string } | null
    /** 心动模式插入的曲目键（`source:id`），用于重启后仍能标出推荐歌 */
    heartKeys?: string[]
  }
  /** 启动时恢复播放状态 */
  resumeOnStart: boolean
  /** 主题 */
  theme: 'dark' | 'light'
  /** 显示歌词翻译 */
  showTranslation: boolean
  /** 显示歌词音译 */
  showRoman: boolean
  /** 淡入淡出 */
  fadeInOut: boolean
  /** 是否已完成首次引导 */
  onboarded: boolean
}

export interface AuthState {
  loggedIn: boolean
  profile?: UserProfile
  /** 脱敏后的 cookie 摘要，用于界面展示 */
  cookieMasked?: string
  vipType?: number
}

/** 主窗口 → 主进程 → 歌词窗口的播放状态同步载荷 */
export interface PlayerSyncPayload {
  playing: boolean
  songName: string
  artistName: string
  /** 当前歌词行 */
  current: string
  /** 翻译 */
  currentTrans: string
  /** 下一行 */
  next: string
  /** 当前行在整首中的进度 0-1 */
  lineProgress: number
  position: number
  duration: number
}

/** 全局快捷键 / 托盘 → 渲染层的播放控制指令 */
export type PlayerCommand =
  | 'toggle'
  | 'next'
  | 'prev'
  | 'volume-up'
  | 'volume-down'
  | 'toggle-mute'
  | 'toggle-desktop-lyric'
  | 'toggle-like'
  | 'seek-forward'
  | 'seek-backward'
  | 'show-main'
