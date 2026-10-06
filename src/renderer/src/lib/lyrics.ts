/**
 * 歌词解析：同时支持普通 LRC 与网易云的逐字 YRC。
 *
 * - LRC：`[mm:ss.xx]文本`，一行可挂多个时间标签
 * - YRC：`[起始毫秒,时长毫秒](字起始,字时长,0)字…`，用于卡拉 OK 式逐字高亮
 */

import type { LyricPayload } from '@shared/types'
import { useSettingsStore } from '@/store/settings'

export interface LyricWord {
  start: number
  duration: number
  text: string
}

export interface LyricLine {
  /** 行起始时间（毫秒） */
  time: number
  /** 行时长（毫秒）；LRC 无此信息时为 0 */
  duration: number
  text: string
  words: LyricWord[]
  /** 翻译 */
  trans: string
  /** 音译 */
  roman: string
}

export interface ParsedLyrics {
  lines: LyricLine[]
  /** 是否包含逐字信息 */
  hasYrc: boolean
  hasTrans: boolean
  hasRoman: boolean
  /** 纯音乐标记 */
  pureMusic: boolean
}

export const EMPTY_LYRICS: ParsedLyrics = {
  lines: [],
  hasYrc: false,
  hasTrans: false,
  hasRoman: false,
  pureMusic: false,
}

interface TimedText {
  time: number
  text: string
}

const LRC_TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
const YRC_HEAD = /^\[(\d+),(\d+)\]/
const YRC_TOKEN = /\((\d+),(\d+),(\d+)\)([^(]*)/g

/**
 * 抠出字符串里的 JSON 块。
 *
 * 网易云部分歌曲的 `lrc.lyric` 是**混合格式**：开头若干 `{"t":…,"c":[…]}` 块
 * 装的是作词/作曲/编曲等 staff 条，后面**直接接着普通 LRC 正文**。这里用花括号
 * 配平扫描（c[].tx 里的 `{`/`}` 会计数，但歌词文本几乎不会出现未配对括号），
 * 避免 JSON 块被后面的 LRC 行解析当成歌词正文。
 */
function extractJsonBlocks(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (text[i] === '}') {
      depth -= 1
      if (depth <= 0) {
        depth = 0
        out.push(text.slice(start, i + 1))
      }
    }
  }
  return out
}

/** 去掉字符串里所有的 JSON 块，剩下的就是普通 LRC 正文 */
function stripJsonBlocks(text: string): string {
  const out: string[] = []
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth -= 1
      else out.push(ch)
      continue
    }
    if (depth === 0) out.push(ch)
  }
  return out.join('')
}

interface JsonCredit {
  time: number
  text: string
}

/**
 * 解析 staff 块。`t = -1` 表示「无时间戳」，这类行只适合放在列表最前面。
 * 文本是 `c[].tx` 的拼接（形如「作词: 」「米果」两段拼成一条）。
 */
function parseJsonCredits(text: string): JsonCredit[] {
  const out: JsonCredit[] = []
  for (const raw of extractJsonBlocks(text)) {
    let parsed: { t?: unknown; c?: Array<{ tx?: unknown }> }
    try {
      parsed = JSON.parse(raw) as { t?: unknown; c?: Array<{ tx?: unknown }> }
    } catch {
      continue
    }
    if (!Array.isArray(parsed.c)) continue
    const plain = parsed.c
      .map((item) => (typeof item?.tx === 'string' ? item.tx : ''))
      .join('')
      .trim()
    if (!plain) continue
    const time = Number(parsed.t)
    out.push({ time: Number.isFinite(time) ? time : -1, text: plain })
  }
  return out
}


/** 解析标准 LRC，按时间升序返回。混合格式里的 JSON 块先剥掉 */
function parseLrc(text: string): TimedText[] {
  const out: TimedText[] = []
  for (const rawLine of stripJsonBlocks(text).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    LRC_TIME.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    while ((match = LRC_TIME.exec(line)) !== null) {
      const minutes = Number(match[1])
      const seconds = Number(match[2].replace(':', '.'))
      stamps.push(Math.round((minutes * 60 + seconds) * 1000))
    }
    if (stamps.length === 0) continue

    const content = line.replace(LRC_TIME, '').trim()
    if (!content) continue
    for (const time of stamps) out.push({ time, text: content })
  }
  return out.sort((a, b) => a.time - b.time)
}

/**
 * 汇总混合格式里的 staff 条（作词/作曲/编曲/录音工程…）。
 * 只用于「这首响应里没有正文」时兜底展示，见 parseLyrics 里的说明。
 */
function collectStaff(lrcText: string, klyricText: string): JsonCredit[] {
  const seen = new Set<string>()
  const out: JsonCredit[] = []
  for (const source of [lrcText, klyricText]) {
    if (!source) continue
    for (const credit of parseJsonCredits(source)) {
      const key = `${credit.time}|${credit.text}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(credit)
    }
  }
  return out.sort((a, b) => a.time - b.time)
}

interface YrcLine {
  time: number
  duration: number
  words: LyricWord[]
  /** 整句文本；无逐字 token 时只有它可用 */
  text: string
}

/** 解析逐字 YRC */
function parseYrc(text: string): YrcLine[] {
  const out: YrcLine[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const head = YRC_HEAD.exec(line)
    if (!head) continue

    const time = Number(head[1])
    const duration = Number(head[2])
    const body = line.slice(head[0].length)

    const words: LyricWord[] = []
    YRC_TOKEN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = YRC_TOKEN.exec(body)) !== null) {
      words.push({
        start: Number(match[1]),
        duration: Number(match[2]),
        text: match[4] ?? '',
      })
    }

    const plain = words.map((w) => w.text).join('')
    if (words.length === 0) {
      // 有 YRC 头却没有逐字 token（间奏行、纯标点行等）：保留整句文本，
      // 让它走普通 LRC 的整句渲染（不带读词器），而不是整行消失。
      const fallback = body.trim()
      if (!fallback) continue
      out.push({ time, duration, words: [], text: fallback })
      continue
    }
    if (!plain.trim()) continue
    out.push({ time, duration, words, text: plain })
  }
  return out.sort((a, b) => a.time - b.time)
}

/**
 * 把翻译/音译对齐到主歌词行。
 * 数量一致时按序号对齐（最稳），否则按时间戳就近匹配。
 */
function attachTimes(
  times: TimedText[],
  targets: LyricLine[],
  field: 'trans' | 'roman',
): boolean {
  if (times.length === 0 || targets.length === 0) return false

  if (times.length === targets.length) {
    for (let i = 0; i < targets.length; i += 1) {
      if (!targets[i][field]) targets[i][field] = times[i].text
    }
    return true
  }

  const tolerance = 600
  let cursor = 0
  let matched = false
  for (const line of targets) {
    while (cursor + 1 < times.length && times[cursor + 1].time <= line.time)
      cursor += 1
    const candidate = times[cursor]
    if (candidate && Math.abs(candidate.time - line.time) <= tolerance) {
      if (!line[field]) line[field] = candidate.text
      matched = true
    }
  }
  return matched
}

/** 解析 API 返回的歌词结构（lyric_new / lyric / cloud_lyric_get 通用） */
export function parseLyrics(payload?: LyricPayload | null): ParsedLyrics {
  if (!payload) return EMPTY_LYRICS

  const yrcText = payload.yrc?.lyric ?? ''
  const lrcText = payload.lrc?.lyric ?? ''
  const klyricText = payload.klyric?.lyric ?? ''
  const transText = payload.tlyric?.lyric ?? ''
  const romanText = payload.romalrc?.lyric ?? ''

  let lines: LyricLine[] = []
  let hasYrc = false

  if (yrcText && /^\[\d+,\d+\]/m.test(yrcText)) {
    const parsed = parseYrc(yrcText)
    if (parsed.length > 0) {
      hasYrc = true
      lines = parsed.map((item) => ({
        time: item.time,
        duration: item.duration,
        text: item.text,
        words: item.words,
        trans: '',
        roman: '',
      }))
    }
  }

  // 歌词主体只认普通 LRC 正文；staff 块（JSON）不参与主体判定
  const lrcBodies = parseLrc(lrcText)
  if (lines.length === 0 && lrcBodies.length > 0) {
    lines = lrcBodies.map((item) => ({
      time: item.time,
      duration: 0,
      text: item.text,
      words: [],
      trans: '',
      roman: '',
    }))
  }

  // staff 条（作词/作曲/编曲…）只做「没有正文时的兜底内容」。
  // 绝不能混进正文列表：它们的时间戳固定在 0/1/2s，却会被插到列表最前面，
  // 于是 findLineIndex 的二分查找会认定「0~25s 之间一直停在编曲那一行」，
  // 读词器就会卡在 credits 上，直到第一句正文的时间戳才跳过去。
  const staff = collectStaff(lrcText, klyricText)
  if (lines.length === 0 && staff.length > 0) {
    lines = staff.map((credit) => ({
      time: credit.time,
      duration: 0,
      text: credit.text,
      words: [],
      trans: '',
      roman: '',
    }))
  }

  if (lines.length === 0) {
    return { ...EMPTY_LYRICS, pureMusic: !!payload.pureMusic }
  }

  // 补齐缺失的行时长：用下一行起点推算，最后一行给 4 秒兜底
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].duration > 0) continue
    const next = lines[i + 1]
    lines[i].duration = next ? Math.max(0, next.time - lines[i].time) : 4000
  }

  const transTimes = parseLrc(transText)
  const romanTimes = parseLrc(romanText)
  attachTimes(transTimes, lines, 'trans')
  attachTimes(romanTimes, lines, 'roman')

  return {
    lines,
    hasYrc,
    hasTrans: transTimes.length > 0,
    hasRoman: romanTimes.length > 0,
    pureMusic:
      !!payload.pureMusic ||
      (lines.length === 1 && /纯音乐/.test(lines[0].text)),
  }
}

/**
 * 歌词/音频对齐偏移（毫秒）。
 *
 * 网易云下发的 yrc/lrc 时间轴与实际听到的声音之间存在一个**基本恒定**的偏移
 * （官方客户端自己也会做补偿），表现为「读词总是慢/快半拍」。
 * 这里读用户设置，正数代表歌词提前。当前行判定与逐字读词必须共用同一个值，
 * 否则两者会互相对不上。
 */
export function lyricOffsetMs(): number {
  const value = useSettingsStore.getState().settings.lyricOffset
  return Number.isFinite(value) ? value : 0
}

/** 二分查找当前时间对应的歌词行下标；早于第一行时返回 -1 */
export function findLineIndex(lines: LyricLine[], timeMs: number): number {
  if (lines.length === 0) return -1
  if (timeMs < lines[0].time) return -1

  let low = 0
  let high = lines.length - 1
  let result = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= timeMs) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

/** 当前行内的进度 0-1 */
export function lineProgress(
  line: LyricLine | undefined,
  timeMs: number,
): number {
  if (!line) return 0
  const duration = line.duration > 0 ? line.duration : 4000
  const ratio = (timeMs - line.time) / duration
  return Math.max(0, Math.min(1, ratio))
}

/**
 * 连续的逐字进度 0-1（相对整行文本长度）。
 *
 * 旧实现返回整数「已唱完几个字」，
 * 渲染出来是一格一格跳；这里返回小数，可以驱动渐变擦除连续推进。
 *
 * 返回 `null` 表示**这一行没有逐字时间轴**（普通 LRC），调用方必须放弃
 * 逐字高亮并按整句显示。不能回退成「按行时长匀速推进」：LRC 的行时长只是
 * 「到下一句开始」的间隔，用它当读词轴会得到与演唱完全不符的假卡拉 OK。
 */
export function wordProgress(
  line: LyricLine | undefined,
  timeMs: number,
): number | null {
  if (!line || line.words.length === 0) return null
  const total = line.text.length
  if (total === 0) return null

  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

  let done = 0
  for (const word of line.words) {
    if (timeMs >= word.start + word.duration) {
      done += word.text.length
      continue
    }
    if (timeMs >= word.start) {
      const ratio =
        word.duration > 0 ? (timeMs - word.start) / word.duration : 0
      done += word.text.length * clamp01(ratio)
    }
    break
  }
  return clamp01(done / total)
}
