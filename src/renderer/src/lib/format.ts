/** 毫秒 → mm:ss（超过一小时显示 h:mm:ss） */
export function formatDuration(ms?: number): string {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return '00:00'
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

/** 秒 → mm:ss */
export function formatSeconds(seconds?: number): string {
  return formatDuration((seconds ?? 0) * 1000)
}

/** 播放量/评论数：1.2万 / 3.4亿 */
export function formatCount(count?: number): string {
  if (!count || count <= 0) return '0'
  if (count < 10_000) return String(count)
  if (count < 100_000_000) {
    const value = count / 10_000
    return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}万`
  }
  return `${(count / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`
}

/** 时间戳 → YYYY-MM-DD */
export function formatDate(timestamp?: number | string): string {
  if (!timestamp) return ''
  const date =
    typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 相对时间：刚刚 / 5 分钟前 / 昨天 / 2024-01-01 */
export function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 2 * 86_400_000) return '昨天'
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return formatDate(timestamp)
}

/** 字节 → 人类可读 */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

/** 字节/秒 → 人类可读速度 */
export function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** 拼接图片地址并指定尺寸（网易云 CDN 支持 ?param=WxH） */
export function imageUrl(url?: string, size = 200): string | undefined {
  if (!url) return undefined
  if (url.startsWith('ncmfile://') || url.startsWith('data:')) return url
  // 部分老接口仍返回 http 封面，而渲染层 CSP 只放行 https，这里统一升级协议
  const normalized = url.replace(/^http:\/\//i, 'https://')
  const base = normalized.split('?')[0]
  return `${base}?param=${size}y${size}`
}

/** 歌手列表 → 「A / B」 */
export function artistNames(artists?: Array<{ name?: string }>): string {
  if (!artists || artists.length === 0) return '未知艺术家'
  return (
    artists
      .map((a) => a?.name ?? '')
      .filter(Boolean)
      .join(' / ') || '未知艺术家'
  )
}

/** 截断长文本 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
