import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { logger } from './logger'

/**
 * 自定义协议 `ncmfile://`：把本地绝对路径交给渲染进程的 <audio>/<img> 使用。
 *
 * 为什么不直接用 file:// —— 渲染进程本身跑在 http://localhost（开发态）或
 * 打包后的 file:// 页面里，直接引用任意 file:// 会被 webSecurity 拦掉。
 * 这里用自定义协议把可访问范围收敛到「主进程明确给出的路径」，并且手动实现
 * Range 请求，保证 <audio> 拖动进度条时能真正 seek。
 */

export const LOCAL_SCHEME = 'ncmfile'

/**
 * 自定义协议里的固定主机名。
 *
 * 为什么必须带主机名：`standard: true` 的协议会像 http 一样折叠多余斜杠，
 * `ncmfile:///D%3A%5C...` 会被解析成「主机名 = D%3A%5C...」再去做 IDNA 编码，
 * 直接抛 ERR_INVALID_URL，导致 <audio>/<img> 全部加载失败。
 * 固定成 `ncmfile://local/<编码路径>` 后主机名合法，后面的才是路径。
 */
const LOCAL_HOST = 'local'

/** 把绝对路径编码成 ncmfile URL */
export function toLocalUrl(absolutePath: string): string {
  return `${LOCAL_SCHEME}://${LOCAL_HOST}/${encodeURIComponent(absolutePath)}`
}

/** 从 ncmfile URL 还原绝对路径；非法 URL 返回 null */
export function fromLocalUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${LOCAL_SCHEME}:`) return null
    if (parsed.host !== LOCAL_HOST) return null
    const raw = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    if (!raw) return null
    return path.normalize(raw)
  } catch {
    return null
  }
}

/** 必须在 app ready 之前调用 */
export function registerLocalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ])
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
  '.ape': 'audio/x-ape',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.lrc': 'text/plain; charset=utf-8',
}

function mimeOf(filePath: string): string {
  return (
    MIME_BY_EXT[path.extname(filePath).toLowerCase()] ??
    'application/octet-stream'
  )
}

interface RangeSpec {
  start: number
  end: number
}

function parseRange(header: string | null, size: number): RangeSpec | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  let start: number
  let end: number
  if (rawStart === '') {
    // bytes=-N 表示最后 N 字节
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    start >= size
  )
    return null
  return { start, end }
}

function nodeStreamToWeb(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

/** app ready 之后调用，注册协议处理函数 */
export function handleLocalScheme(): void {
  protocol.handle(LOCAL_SCHEME, async (request) => {
    const filePath = fromLocalUrl(request.url)
    if (!filePath) {
      return new Response('bad request', { status: 400 })
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error('not a file')
    } catch {
      logger.warn('ncmfile 请求的文件不存在:', filePath)
      return new Response('not found', { status: 404 })
    }

    const mime = mimeOf(filePath)
    const range = parseRange(request.headers.get('range'), stat.size)
    logger.debug(
      `ncmfile 命中 ${path.basename(filePath)} (${stat.size} 字节${range ? `, Range ${range.start}-${range.end}` : ''})`,
    )

    if (!range) {
      const stream = fs.createReadStream(filePath)
      return new Response(nodeStreamToWeb(stream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      })
    }

    const { start, end } = range
    const stream = fs.createReadStream(filePath, { start, end })
    return new Response(nodeStreamToWeb(stream), {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    })
  })
}
