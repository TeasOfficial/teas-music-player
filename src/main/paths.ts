import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AppPaths } from '@shared/types'
import { settings } from './store'

let cachedPaths: AppPaths | null = null

/** 应用用到的全部落盘目录（惰性创建） */
export function appPaths(): AppPaths {
  if (cachedPaths) return cachedPaths
  const userData = app.getPath('userData')
  const downloadOverride = settings.get('downloadDir')
  const base: AppPaths = {
    userData,
    music: app.getPath('music'),
    download:
      downloadOverride || path.join(app.getPath('music'), 'Teas Music Player'),
    cache: path.join(userData, 'cache'),
    localCoverCache: path.join(userData, 'local-cover'),
  }
  cachedPaths = base
  for (const dir of [base.download, base.cache, base.localCoverCache]) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* 目录创建失败留给具体功能报错 */
    }
  }
  return base
}

/** 用户改了下载目录后需要让缓存失效 */
export function invalidatePaths(): void {
  cachedPaths = null
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 把 Windows/Unix 文件名中的非法字符替换掉 */
export function sanitizeFileName(name: string, maxLength = 120): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
  const trimmed =
    cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
  return trimmed || 'unknown'
}
