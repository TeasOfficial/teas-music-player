import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { Settings, UserProfile } from '@shared/types'
import { logger } from './logger'

/** 原子写：先写临时文件再 rename，避免断电/崩溃留下半个 JSON */
function writeJsonAtomic(file: string, data: unknown): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    const raw = fs.readFileSync(file, 'utf-8')
    if (!raw.trim()) return fallback
    return { ...fallback, ...(JSON.parse(raw) as object) } as T
  } catch (error) {
    logger.warn('读取配置文件失败，使用默认值:', file, error)
    return fallback
  }
}

export const DEFAULT_SETTINGS: Settings = {
  level: 'exhigh',
  volume: 0.7,
  muted: false,
  playMode: 'order',
  desktopLyric: false,
  lyricLocked: false,
  lyricFontSize: 28,
  lyricOpacity: 0.9,
  lyricOffset: 0,
  minimizeToTray: true,
  autoLaunch: false,
  globalShortcut: true,
  localFolders: [],
  downloadDir: '',
  downloadLevel: 'exhigh',
  downloadSaveExtra: true,
  resumeOnStart: true,
  theme: 'dark',
  showTranslation: true,
  showRoman: false,
  fadeInOut: true,
  onboarded: false,
}

interface SessionFile {
  cookie: string
  profile: UserProfile | null
  updatedAt: number
}

/** 会话（登录 cookie + 用户资料）本地持久化 */
class SessionStore {
  private file = ''
  private data: SessionFile = { cookie: '', profile: null, updatedAt: 0 }
  private loaded = false

  private ensure(): void {
    if (this.loaded) return
    this.file = path.join(app.getPath('userData'), 'session.json')
    this.data = readJson<SessionFile>(this.file, {
      cookie: '',
      profile: null,
      updatedAt: 0,
    })
    this.loaded = true
  }

  get cookie(): string {
    this.ensure()
    return this.data.cookie
  }

  get profile(): UserProfile | null {
    this.ensure()
    return this.data.profile
  }

  get updatedAt(): number {
    this.ensure()
    return this.data.updatedAt
  }

  save(cookie: string, profile: UserProfile | null): void {
    this.ensure()
    this.data = { cookie, profile, updatedAt: Date.now() }
    writeJsonAtomic(this.file, this.data)
  }

  clear(): void {
    this.ensure()
    this.data = { cookie: '', profile: null, updatedAt: 0 }
    writeJsonAtomic(this.file, this.data)
  }
}

export const session = new SessionStore()

/** 用户设置持久化（带内存缓存与变更订阅） */
class SettingsStore {
  private file = ''
  private data: Settings = { ...DEFAULT_SETTINGS }
  private loaded = false
  private listeners = new Set<(s: Settings) => void>()

  private ensure(): void {
    if (this.loaded) return
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.data = readJson<Settings>(this.file, { ...DEFAULT_SETTINGS })
    this.loaded = true
  }

  all(): Settings {
    this.ensure()
    return { ...this.data }
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    this.ensure()
    return this.data[key]
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
    this.ensure()
    this.data[key] = value
    writeJsonAtomic(this.file, this.data)
    const snapshot = this.all()
    this.listeners.forEach((fn) => {
      try {
        fn(snapshot)
      } catch (error) {
        logger.warn('设置变更回调异常', error)
      }
    })
    return snapshot
  }

  patch(partial: Partial<Settings>): Settings {
    this.ensure()
    this.data = { ...this.data, ...partial }
    writeJsonAtomic(this.file, this.data)
    const snapshot = this.all()
    this.listeners.forEach((fn) => fn(snapshot))
    return snapshot
  }

  reset(): Settings {
    this.ensure()
    this.data = { ...DEFAULT_SETTINGS }
    writeJsonAtomic(this.file, this.data)
    return this.all()
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const settings = new SettingsStore()
