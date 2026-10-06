import type { DjProgram, Song } from '@shared/types'

/**
 * 网易云同一实体在不同接口里存在两套字段名，还有的把实体包了一层壳。
 * 页面直接用原始返回值就会出现「未知艺术家 / 00:00 / 点了没反应」这类静默故障，
 * 所以所有来自接口的歌曲与节目都要过一遍这里。
 *
 * 两种历史包袱：
 *  1. 包装：`personalized_newsong` 返回 `{ id, name, picUrl, song: {...} }`，
 *     `personalized_djprogram` 返回 `{ ..., program: {...} }`；
 *  2. 新旧字段：老接口用 `artists / album / duration / alias`，
 *     新接口用 `ar / al / dt / alia`。
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function pick<T>(
  source: Record<string, unknown>,
  ...keys: string[]
): T | undefined {
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null) return value as T
  }
  return undefined
}

/** 把任意接口返回的歌曲统一成播放器使用的 Song；无法识别时返回 null */
export function normalizeSong(raw: unknown): Song | null {
  const wrapper = asRecord(raw)
  if (!wrapper) return null

  const inner = asRecord(wrapper.song) ?? asRecord(wrapper.mainSong) ?? wrapper
  const id = pick<number>(inner, 'id')
  const name = pick<string>(inner, 'name')
  if (typeof id !== 'number' || !name) return null

  const artists = pick<Song['ar']>(inner, 'ar', 'artists')
  const album = pick<Song['al']>(inner, 'al', 'album')
  const duration = pick<number>(inner, 'dt', 'duration')
  const alias = pick<string[]>(inner, 'alia', 'alias')

  return {
    ...(inner as unknown as Song),
    id,
    name,
    ar: Array.isArray(artists) ? artists : [],
    al:
      album && typeof album === 'object'
        ? (album as Song['al'])
        : { id: 0, name: '' },
    dt: typeof duration === 'number' ? duration : 0,
    alia: Array.isArray(alias) ? alias : [],
  }
}

/** 批量规范化并剔除无法识别的项 */
export function normalizeSongs(list: unknown): Song[] {
  if (!Array.isArray(list)) return []
  const out: Song[] = []
  for (const item of list) {
    const song = normalizeSong(item)
    if (song) out.push(song)
  }
  return out
}

/** 电台节目：同样是「壳 + 老字段」的组合 */
export function normalizeDjProgram(raw: unknown): DjProgram | null {
  const wrapper = asRecord(raw)
  if (!wrapper) return null

  const inner = asRecord(wrapper.program) ?? wrapper
  const id = pick<number>(inner, 'id')
  const name = pick<string>(inner, 'name')
  if (typeof id !== 'number' || !name) return null

  const mainSong = normalizeSong(inner.mainSong ?? inner.songs ?? inner)

  return {
    ...(inner as unknown as DjProgram),
    id,
    name,
    mainSong: mainSong ?? undefined,
    coverUrl:
      pick<string>(inner, 'coverUrl', 'blurCoverUrl', 'picUrl') ??
      (wrapper.picUrl as string | undefined),
    duration: pick<number>(inner, 'duration') ?? mainSong?.dt ?? 0,
    listenerCount: pick<number>(inner, 'listenerCount', 'playCount') ?? 0,
    description: pick<string>(inner, 'description', 'desc') ?? undefined,
  }
}

export function normalizeDjPrograms(list: unknown): DjProgram[] {
  if (!Array.isArray(list)) return []
  const out: DjProgram[] = []
  for (const item of list) {
    const program = normalizeDjProgram(item)
    if (program) out.push(program)
  }
  return out
}

/** 电台（播客）实体：字段名相对统一，这里只做旧的 subed/subscribed 兜底 */
export function normalizeRadio<
  T extends { subed?: boolean; subscribed?: boolean },
>(raw: T): T {
  if (raw.subed !== undefined && raw.subscribed === undefined) {
    return { ...raw, subscribed: raw.subed }
  }
  return raw
}
