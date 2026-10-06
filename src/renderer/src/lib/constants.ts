import type { PlayMode, SoundLevel } from '@shared/types'

export interface QualityOption {
  value: SoundLevel
  label: string
  /** 简短说明，展示在音质选择弹层里 */
  desc: string
}

/** 与 API 的 song_url_v1 参数一一对应 */
export const QUALITY_OPTIONS: QualityOption[] = [
  { value: 'standard', label: '标准音质', desc: '128kbps' },
  { value: 'higher', label: '较高音质', desc: '192kbps' },
  { value: 'exhigh', label: '极高音质', desc: '320kbps' },
  { value: 'lossless', label: '无损音质', desc: 'FLAC' },
  { value: 'hires', label: 'Hi-Res', desc: '高解析度' },
  { value: 'jyeffect', label: '高清臻音', desc: '空间音频' },
  { value: 'sky', label: '沉浸环绕声', desc: '全景声' },
  { value: 'jymaster', label: '超清母带', desc: 'Master' },
]

export const QUALITY_LABEL: Record<SoundLevel, string> = QUALITY_OPTIONS.reduce(
  (acc, item) => {
    acc[item.value] = item.label
    return acc
  },
  {} as Record<SoundLevel, string>,
)

export interface PlayModeOption {
  value: PlayMode
  label: string
  icon: string
}

export const PLAY_MODE_OPTIONS: PlayModeOption[] = [
  { value: 'order', label: '顺序播放', icon: 'order' },
  { value: 'loop', label: '列表循环', icon: 'loop' },
  { value: 'single', label: '单曲循环', icon: 'single' },
  { value: 'shuffle', label: '随机播放', icon: 'shuffle' },
  { value: 'heart', label: '心动模式', icon: 'heart' },
]

export const PLAY_MODE_LABEL: Record<PlayMode, string> =
  PLAY_MODE_OPTIONS.reduce(
    (acc, item) => {
      acc[item.value] = item.label
      return acc
    },
    {} as Record<PlayMode, string>,
  )

/** 侧边栏导航 */
export interface NavItem {
  to: string
  label: string
  icon: string
  /** 需要登录才展示 */
  auth?: boolean
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/discover', label: '发现音乐', icon: 'music' },
  { to: '/podcast', label: '播客', icon: 'radio' },
  { to: '/mv', label: '视频', icon: 'video' },
  { to: '/search', label: '搜索', icon: 'search' },
]

export const LIBRARY_NAV: NavItem[] = [
  { to: '/daily', label: '每日推荐', icon: 'calendar', auth: true },
  { to: '/likes', label: '我喜欢的音乐', icon: 'heart', auth: true },
  { to: '/recent', label: '最近播放', icon: 'clock', auth: true },
  { to: '/cloud', label: '我的音乐云盘', icon: 'cloud', auth: true },
  { to: '/local', label: '本地音乐', icon: 'folder' },
  { to: '/downloads', label: '下载管理', icon: 'download' },
]

/** 搜索类型，对应 cloudsearch 的 type 参数 */
export const SEARCH_TYPES = [
  { value: 1, label: '单曲' },
  { value: 1000, label: '歌单' },
  { value: 100, label: '歌手' },
  { value: 10, label: '专辑' },
  { value: 1004, label: 'MV' },
  { value: 1009, label: '播客' },
  { value: 1002, label: '用户' },
] as const

export type SearchType = (typeof SEARCH_TYPES)[number]['value']

export const DEFAULT_SEARCH_TYPE: SearchType = 1

/** 支持的本地音频扩展名（与主进程保持一致） */
export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.wav',
  '.ogg',
  '.opus',
  '.wma',
  '.ape',
  '.aiff',
  '.aif',
]
