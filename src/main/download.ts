import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import type { DownloadTask, Song, SongUrlItem, SoundLevel } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { logger } from './logger'
import { appPaths, ensureDir, sanitizeFileName } from './paths'
import { settings } from './store'
import { callApi } from './api/invoke'
import { sendToMain } from './windows'
import { toLocalUrl } from './protocol'

/* ------------------------------------------------------------------ */
/* 任务表（内存）+ 持久化                                               */
/* ------------------------------------------------------------------ */

interface RuntimeTask extends DownloadTask {
  controller?: AbortController
  /** 播放地址，便于失败后重试 */
  url?: string
}

const tasks = new Map<string, RuntimeTask>()
const pending: string[] = []
let activeCount = 0
const MAX_ACTIVE = 2

let persistTimer: NodeJS.Timeout | null = null

function tasksFile(): string {
  return path.join(appPaths().userData, 'downloads.json')
}

function persistNow(): void {
  try {
    const list = [...tasks.values()].map(serialize)
    fs.writeFileSync(tasksFile(), JSON.stringify(list, null, 2), 'utf-8')
  } catch (error) {
    logger.warn('保存下载记录失败:', error)
  }
}

function persistSoon(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 400)
}

export function loadDownloads(): void {
  try {
    const file = tasksFile()
    if (!fs.existsSync(file)) return
    const list = JSON.parse(fs.readFileSync(file, 'utf-8')) as DownloadTask[]
    for (const item of list) {
      // 上次退出时未完成的任务标记为中断
      const status: DownloadTask['status'] =
        item.status === 'downloading' || item.status === 'pending'
          ? 'error'
          : item.status
      tasks.set(item.id, {
        ...item,
        status,
        error:
          status === 'error' && !item.error ? '上次退出时中断' : item.error,
        speed: 0,
        progress: status === 'error' ? item.progress : 100,
      })
    }
    logger.info(`恢复下载记录 ${tasks.size} 条`)
  } catch (error) {
    logger.warn('读取下载记录失败:', error)
  }
}

/** 去掉运行时字段，并在已完成时补上本地播放地址 */
function serialize(task: RuntimeTask): DownloadTask {
  const { controller: _c, url: _u, ...rest } = task
  const playable =
    rest.filePath && fs.existsSync(rest.filePath)
      ? toLocalUrl(rest.filePath)
      : undefined
  return { ...rest, url: playable }
}

function emitProgress(task: RuntimeTask): void {
  sendToMain(IPC_EVENT.DownloadProgress, serialize(task))
}

/* ------------------------------------------------------------------ */
/* 文件名与目录                                                         */
/* ------------------------------------------------------------------ */

const LEVEL_EXT: Partial<Record<SoundLevel, string>> = {
  lossless: 'flac',
  hires: 'flac',
  jymaster: 'flac',
}

function extensionFor(level: SoundLevel, url: string, type?: string): string {
  if (type) return type.toLowerCase() === 'flac' ? 'flac' : type.toLowerCase()
  const fromUrl = path
    .extname(new URL(url).pathname)
    .replace('.', '')
    .toLowerCase()
  if (fromUrl && fromUrl.length <= 5) return fromUrl
  return LEVEL_EXT[level] ?? 'mp3'
}

function artistText(song: Song): string {
  return (
    (song.ar ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .join('、') || '未知艺术家'
  )
}

function baseName(song: Song): string {
  return sanitizeFileName(`${artistText(song)} - ${song.name}`)
}

/** 目标文件路径；同名文件自动加 (1)(2) 后缀，避免互相覆盖 */
function targetPath(song: Song, ext: string): string {
  const dir = ensureDir(settings.get('downloadDir') || appPaths().download)
  const base = baseName(song)
  let candidate = path.join(dir, `${base}.${ext}`)
  let index = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${index}).${ext}`)
    index += 1
  }
  return candidate
}

/* ------------------------------------------------------------------ */
/* 下载实现                                                             */
/* ------------------------------------------------------------------ */

async function resolveUrl(song: Song, level: SoundLevel): Promise<SongUrlItem> {
  const res = await callApi<{ data?: SongUrlItem[] }>('song_url_v1', {
    id: song.id,
    level,
  })
  const item = res.body?.data?.[0]
  if (!res.ok || !item?.url) {
    throw new Error(
      item?.freeTrialInfo
        ? '该歌曲仅提供试听片段，无法下载完整版'
        : '无法获取播放地址（可能无版权）',
    )
  }
  return item
}

async function downloadToFile(
  task: RuntimeTask,
  url: string,
  dest: string,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`)

  const total = Number(res.headers.get('content-length') ?? 0)
  task.totalBytes = total

  const tmp = `${dest}.part`
  const out = fs.createWriteStream(tmp)

  let received = 0
  let lastEmit = 0
  let lastBytes = 0
  let lastTime = Date.now()

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      const buf = Buffer.from(chunk)
      received += buf.length
      if (!out.write(buf)) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      }
      const now = Date.now()
      if (now - lastEmit > 250 || (total > 0 && received >= total)) {
        const elapsed = (now - lastTime) / 1000
        task.speed =
          elapsed > 0 ? Math.round((received - lastBytes) / elapsed) : 0
        lastBytes = received
        lastTime = now
        task.receivedBytes = received
        task.progress =
          total > 0 ? Math.min(99, Math.round((received / total) * 100)) : -1
        lastEmit = now
        if (!task.controller?.signal.aborted) emitProgress(task)
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })
    fs.renameSync(tmp, dest)
  } catch (error) {
    out.destroy()
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* 清理失败忽略 */
    }
    throw error
  }

  task.receivedBytes = received
  task.totalBytes = total || received
  task.progress = 100
}

async function saveSidecars(song: Song, dest: string): Promise<void> {
  if (!settings.get('downloadSaveExtra')) return
  const dir = path.dirname(dest)
  const base = path.basename(dest, path.extname(dest))

  // 歌词
  try {
    const lyric = await callApi<{
      lrc?: { lyric?: string }
      tlyric?: { lyric?: string }
    }>('lyric_new', { id: song.id })
    const lrc = lyric.body?.lrc?.lyric
    if (lrc) fs.writeFileSync(path.join(dir, `${base}.lrc`), lrc, 'utf-8')
  } catch (error) {
    logger.warn('保存歌词失败:', error)
  }

  // 封面
  const cover = song.al?.picUrl
  if (cover) {
    try {
      const res = await fetch(cover, {})
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        fs.writeFileSync(path.join(dir, `${base}.jpg`), buf)
      }
    } catch (error) {
      logger.warn('保存封面失败:', error)
    }
  }
}

async function run(taskId: string): Promise<void> {
  const task = tasks.get(taskId)
  if (!task || task.status === 'canceled') return

  activeCount += 1
  const controller = new AbortController()
  task.controller = controller
  task.status = 'downloading'
  task.error = undefined
  emitProgress(task)

  try {
    const song = taskSongCache.get(taskId)
    if (!song) throw new Error('内部错误：任务缺少歌曲信息')

    const item = await resolveUrl(song, task.level)
    task.url = item.url ?? undefined
    const ext = extensionFor(task.level, item.url as string, item.type)
    const dest = targetPath(song, ext)

    await downloadToFile(task, item.url as string, dest, controller.signal)
    task.filePath = dest
    task.status = 'done'
    task.speed = 0
    await saveSidecars(song, dest)

    sendToMain(IPC_EVENT.DownloadDone, serialize(task))
  } catch (error) {
    if (controller.signal.aborted) {
      task.status = 'canceled'
      task.error = '已取消'
    } else {
      task.status = 'error'
      task.error = error instanceof Error ? error.message : String(error)
      logger.warn(`下载失败 [${task.name}]:`, task.error)
    }
    task.speed = 0
  } finally {
    task.controller = undefined
    activeCount -= 1
    emitProgress(task)
    persistSoon()
    pump()
  }
}

/** 下载任务对应的歌曲对象（不持久化，重启后已完成任务不需要） */
const taskSongCache = new Map<string, Song>()

function pump(): void {
  while (activeCount < MAX_ACTIVE && pending.length > 0) {
    const id = pending.shift()
    if (!id) break
    const task = tasks.get(id)
    if (!task || task.status === 'canceled') continue
    void run(id)
  }
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                            */
/* ------------------------------------------------------------------ */

export function startDownload(song: Song, level?: SoundLevel): DownloadTask {
  const id = `${song.id}-${Date.now().toString(36)}`
  const task: RuntimeTask = {
    id,
    songId: song.id,
    name: song.name,
    artist: artistText(song),
    album: song.al?.name,
    coverUrl: song.al?.picUrl,
    progress: 0,
    receivedBytes: 0,
    totalBytes: 0,
    status: 'pending',
    level: level ?? settings.get('downloadLevel'),
    speed: 0,
    createdAt: Date.now(),
  }
  tasks.set(id, task)
  taskSongCache.set(id, song)
  pending.push(id)
  persistSoon()
  pump()
  return serialize(task)
}

export function cancelDownload(id: string): void {
  const task = tasks.get(id)
  if (!task) return
  if (task.controller) {
    task.controller.abort()
  } else {
    task.status = 'canceled'
    const idx = pending.indexOf(id)
    if (idx >= 0) pending.splice(idx, 1)
    emitProgress(task)
    persistSoon()
  }
}

export function listDownloads(): DownloadTask[] {
  return [...tasks.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(serialize)
}

export function removeDownload(id: string, deleteFile = false): void {
  const task = tasks.get(id)
  if (!task) return
  if (deleteFile && task.filePath && fs.existsSync(task.filePath)) {
    try {
      fs.unlinkSync(task.filePath)
    } catch (error) {
      logger.warn('删除下载文件失败:', error)
    }
  }
  tasks.delete(id)
  taskSongCache.delete(id)
  persistSoon()
}

export function clearDownloads(deleteFiles = false): void {
  for (const id of [...tasks.keys()]) removeDownload(id, deleteFiles)
  persistNow()
}

export function revealDownload(id: string): void {
  const task = tasks.get(id)
  if (task?.filePath && fs.existsSync(task.filePath))
    shell.showItemInFolder(task.filePath)
}

export async function openDownload(id: string): Promise<void> {
  const task = tasks.get(id)
  if (task?.filePath && fs.existsSync(task.filePath))
    await shell.openPath(task.filePath)
}
