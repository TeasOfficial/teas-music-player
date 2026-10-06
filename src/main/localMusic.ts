import fs from 'node:fs'
import path from 'node:path'
import { dialog } from 'electron'
import type { LocalTrack } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { logger } from './logger'
import { appPaths, ensureDir } from './paths'
import { settings } from './store'
import { sendToMain, windows } from './windows'
import { toLocalUrl } from './protocol'

const AUDIO_EXT = new Set([
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
  '.m4b',
  '.alac',
])

/** 最多下钻的目录层级，防止符号链接成环 */
const MAX_DEPTH = 8

let tracks: LocalTrack[] = []
let loaded = false
let scanning = false

function tracksFile(): string {
  return path.join(appPaths().userData, 'local-tracks.json')
}

function persist(): void {
  try {
    fs.writeFileSync(
      tracksFile(),
      JSON.stringify(
        tracks.map(({ url: _u, coverUrl: _c, ...rest }) => rest),
        null,
        2,
      ),
      'utf-8',
    )
  } catch (error) {
    logger.warn('保存本地音乐库失败:', error)
  }
}

/** 稳定 id：路径的 FNV-1a 32 位哈希 */
function hashPath(input: string): number {
  let hash = 2166136261
  const normalized = input.toLowerCase().replace(/\\/g, '/')
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function hydrate(rest: Omit<LocalTrack, 'url' | 'coverUrl'>): LocalTrack {
  return {
    ...rest,
    url: toLocalUrl(rest.path),
    coverUrl:
      rest.coverPath && fs.existsSync(rest.coverPath)
        ? toLocalUrl(rest.coverPath)
        : undefined,
  }
}

export function loadLocalTracks(): void {
  if (loaded) return
  loaded = true
  try {
    const file = tracksFile()
    if (!fs.existsSync(file)) return
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<
      Omit<LocalTrack, 'url' | 'coverUrl'>
    >
    tracks = raw.map(hydrate)
    logger.info(`恢复本地音乐库 ${tracks.length} 首`)
  } catch (error) {
    logger.warn('读取本地音乐库失败:', error)
    tracks = []
  }
}

export function listLocalTracks(): LocalTrack[] {
  loadLocalTracks()
  return tracks.map((t) => ({ ...t }))
}

/* ------------------------------------------------------------------ */
/* 扫描                                                                */
/* ------------------------------------------------------------------ */

function walk(dir: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    logger.warn('读取目录失败:', dir, error)
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      walk(full, depth + 1, out)
    } else if (
      entry.isFile() &&
      AUDIO_EXT.has(path.extname(entry.name).toLowerCase())
    ) {
      out.push(full)
    }
  }
}

interface ParsedMeta {
  name: string
  artist: string
  album: string
  duration: number
  picture?: { data: Uint8Array; format: string }
}

async function readMetadata(filePath: string): Promise<ParsedMeta> {
  const fallbackName = path.basename(filePath, path.extname(filePath))
  // 文件名常见格式：“艺术家 - 标题”
  const dash = fallbackName.split(' - ')
  const fallback: ParsedMeta = {
    name: dash.length > 1 ? dash.slice(1).join(' - ').trim() : fallbackName,
    artist: dash.length > 1 ? dash[0].trim() : '未知艺术家',
    album: '',
    duration: 0,
  }

  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(filePath, { duration: true })
    const common = meta.common
    const picture = common.picture?.[0]
    return {
      name: common.title?.trim() || fallback.name,
      artist:
        common.artist?.trim() ||
        common.albumartist?.trim() ||
        common.artists?.join('、') ||
        fallback.artist,
      album: common.album?.trim() || '',
      duration: Math.round((meta.format.duration ?? 0) * 1000),
      picture: picture
        ? { data: picture.data, format: picture.format }
        : undefined,
    }
  } catch (error) {
    logger.debug('元数据解析失败，使用文件名兜底:', filePath, error)
    return fallback
  }
}

function coverExt(format: string): string {
  if (/png/i.test(format)) return 'png'
  if (/webp/i.test(format)) return 'webp'
  return 'jpg'
}

async function buildTrack(filePath: string): Promise<LocalTrack> {
  const stat = fs.statSync(filePath)
  const meta = await readMetadata(filePath)
  const id = hashPath(filePath)

  let coverPath: string | undefined
  if (meta.picture && meta.picture.data.length > 0) {
    try {
      const dir = ensureDir(appPaths().localCoverCache)
      const ext = coverExt(meta.picture.format)
      coverPath = path.join(dir, `${id}.${ext}`)
      // 文件没变就不重写封面
      if (!fs.existsSync(coverPath)) {
        fs.writeFileSync(coverPath, Buffer.from(meta.picture.data))
      }
    } catch (error) {
      logger.warn('写入封面缓存失败:', error)
      coverPath = undefined
    }
  }

  return hydrate({
    id,
    path: filePath,
    name: meta.name,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    size: stat.size,
    coverPath,
    mtime: stat.mtimeMs,
  })
}

/**
 * 扫描全部已配置目录。已扫描过的文件（路径 + mtime 未变）直接复用缓存，
 * 因此二次扫描非常快。
 */
export async function scanLocalMusic(): Promise<LocalTrack[]> {
  if (scanning) return listLocalTracks()
  loadLocalTracks()
  const folders = settings.get('localFolders')
  if (folders.length === 0) return []

  scanning = true
  try {
    const files: string[] = []
    for (const folder of folders) {
      if (fs.existsSync(folder)) walk(folder, 0, files)
    }
    const unique = [...new Set(files)]
    const cached = new Map(tracks.map((t) => [t.path, t]))
    const result: LocalTrack[] = []
    let added = 0

    for (let i = 0; i < unique.length; i += 1) {
      const filePath = unique[i]
      let stat: fs.Stats
      try {
        stat = fs.statSync(filePath)
      } catch {
        continue
      }
      const existing = cached.get(filePath)
      if (existing && Math.abs(existing.mtime - stat.mtimeMs) < 1) {
        result.push(existing)
      } else {
        try {
          const track = await buildTrack(filePath)
          result.push(track)
          added += 1
        } catch (error) {
          logger.warn('解析音频文件失败:', filePath, error)
        }
      }
      if (i % 5 === 0 || i === unique.length - 1) {
        sendToMain(IPC_EVENT.LocalScanProgress, {
          scanned: i + 1,
          total: unique.length,
          current: path.basename(filePath),
          added,
          done: false,
        })
      }
    }

    tracks = result
    persist()
    sendToMain(IPC_EVENT.LocalScanProgress, {
      scanned: unique.length,
      total: unique.length,
      current: '',
      added,
      done: true,
    })
    sendToMain(IPC_EVENT.LocalScanDone, listLocalTracks())
    logger.info(`本地音乐扫描完成：${result.length} 首（新增/更新 ${added}）`)
    return listLocalTracks()
  } finally {
    scanning = false
  }
}

/* ------------------------------------------------------------------ */
/* 目录管理                                                            */
/* ------------------------------------------------------------------ */

export async function pickLocalFolder(): Promise<string[]> {
  const win = windows.main
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: '选择音乐文件夹',
        properties: ['openDirectory', 'multiSelections'],
      })
    : await dialog.showOpenDialog({
        title: '选择音乐文件夹',
        properties: ['openDirectory', 'multiSelections'],
      })
  if (result.canceled || result.filePaths.length === 0)
    return settings.get('localFolders')

  const current = settings.get('localFolders')
  const merged = [...new Set([...current, ...result.filePaths])]
  settings.set('localFolders', merged)
  return merged
}

export function removeLocalFolder(folder: string): string[] {
  const merged = settings.get('localFolders').filter((f) => f !== folder)
  settings.set('localFolders', merged)
  tracks = tracks.filter((t) => !t.path.startsWith(folder))
  persist()
  return merged
}

export function removeLocalTrack(id: number): void {
  tracks = tracks.filter((t) => t.id !== id)
  persist()
}

export function clearLocalTracks(): void {
  tracks = []
  persist()
}

/** 把歌词写到音频文件旁边（同名 .lrc） */
export function saveLocalLyric(trackId: number, lyric: string): string | null {
  loadLocalTracks()
  const track = tracks.find((t) => t.id === trackId)
  if (!track) return null
  const target = track.path.replace(/\.[^.]+$/, '.lrc')
  try {
    fs.writeFileSync(target, lyric, 'utf-8')
    return target
  } catch (error) {
    logger.warn('写入本地歌词失败:', error)
    return null
  }
}
