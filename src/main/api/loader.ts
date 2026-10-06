import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import type { ApiStatus } from '@shared/types'
import { logger } from '../logger'

/** 用 createRequire 拿到「真正的 require」，避免打包器静态分析后把 API 源码打进 bundle */
const nodeRequire = createRequire(
  typeof __filename !== 'undefined'
    ? __filename
    : path.join(process.cwd(), 'index.js'),
)

/** 一个 API 模块：`main.js` 导出的 `name(params) => Promise<{status, body, cookie}>` */
export type ApiModule = (params: Record<string, unknown>) => Promise<{
  status?: number
  body?: Record<string, unknown>
  cookie?: unknown
}>

export type ApiModuleMap = Record<string, ApiModule>

const status: ApiStatus = {
  ready: false,
  apiRoot: '',
  version: 'unknown',
  moduleCount: 0,
  bootstrapping: false,
}

let modules: ApiModuleMap | null = null
let bootstrapPromise: Promise<ApiStatus> | null = null

function isValidApiRoot(dir: string): boolean {
  if (!dir) return false
  try {
    return (
      fs.existsSync(path.join(dir, 'main.js')) &&
      fs.statSync(path.join(dir, 'module')).isDirectory() &&
      fs.existsSync(path.join(dir, 'util', 'config.json'))
    )
  } catch {
    return false
  }
}

/** 已安装的 API 版本放在用户数据目录下（壳仓库不再随包分发 API 源码） */
export function versionsDir(): string {
  return path.join(app.getPath('userData'), 'api', 'versions')
}

/**
 * 选出一个「已经装好」的版本目录：
 * 取版本号最大的那个（semver 数字比较，够用且免依赖）。
 */
export function resolveInstalledApiRoot(): string {
  const dir = versionsDir()
  if (!fs.existsSync(dir)) return ''
  // versions/ 下可能同时躺着 API 本身与多个 <version>/ 子目录，手工放置也要能用
  if (isValidApiRoot(dir)) return dir
  let best = ''
  for (const name of fs.readdirSync(dir)) {
    const candidate = path.join(dir, name)
    if (isValidApiRoot(candidate) && compareVersions(name, best) > 0) {
      best = candidate
    }
  }
  if (best) logger.info('使用已安装的 API 版本:', best)
  return best
}

/** 数字段比较：a > b 返回正数。非数字段按 0 处理，够用于版本目录排序 */
function compareVersions(a: string, b: string): number {
  if (!b) return 1
  const seg = (value: string): number[] =>
    value
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((num) => (Number.isFinite(num) ? num : 0))
  const left = seg(a)
  const right = seg(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 定位 API 源码目录。按优先级尝试：
 *  1. 环境变量 NCM_API_ROOT（指向任意一份 API 源码，也用于测试）
 *  2. 用户数据目录里已安装（下载）的版本 —— 薄壳的主路径
 *  3. 打包后的 resources/api —— 随包兜底副本（若发行版带了的话）
 *  4. 开发态：环境变量 NCM_API_DEV_SOURCE 指向的本地 API 源码（**必须显式开启**）
 *
 * 第 4 条刻意做成显式 opt-in：如果自动向上查找同仓库的 API 源码，
 * 「冷启动拉取」这条主路径在开发机上永远走不到，等于测不到。
 */
export function resolveApiRoot(): string {
  const candidates: string[] = []
  if (process.env.NCM_API_ROOT) candidates.push(process.env.NCM_API_ROOT)
  const installed = resolveInstalledApiRoot()
  if (installed) candidates.push(installed)
  if (process.resourcesPath)
    candidates.push(path.join(process.resourcesPath, 'api'))

  if (process.env.NCM_API_DEV_SOURCE) {
    const dev = path.resolve(process.env.NCM_API_DEV_SOURCE)
    candidates.push(dev, path.join(dev, 'module', '..'))
  }
  // 打包后的 out/main 上溯四级通常是仓库根；仅在显式开启时才算候选
  if (process.env.NCM_API_DEV_SOURCE) {
    candidates.push(path.resolve(__dirname, '..', '..', '..', '..'))
  }

  for (const dir of candidates) {
    const normalized = path.resolve(dir)
    if (isValidApiRoot(normalized)) {
      logger.info('API 源码目录:', normalized)
      return normalized
    }
  }
  logger.warn(
    `本地没有可用的 API 源码目录，将从 npm 拉取。候选: ${JSON.stringify(candidates)}`,
  )
  return ''
}

function ensureAnonymousTokenFile(): void {
  const tokenFile = path.resolve(os.tmpdir(), 'anonymous_token')
  try {
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, '', 'utf-8')
  } catch (error) {
    logger.warn('创建 anonymous_token 失败:', error)
  }
}

/** 从 main.js 的导出里挑出真正的接口模块（以 module/*.js 文件名为准） */
function collectModules(
  ncm: Record<string, unknown>,
  apiRoot: string,
): ApiModuleMap {
  const dir = path.join(apiRoot, 'module')
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/i, ''))

  const map: ApiModuleMap = {}
  for (const name of files) {
    const fn = ncm[name]
    if (typeof fn === 'function') map[name] = fn as ApiModule
  }
  return map
}

/**
 * 确保本地有一份可用的 API：没有就从 npm 拉一份最新版。
 *
 * 这是薄壳的「首次启动」主路径——壳本身不带 API 源码。
 * 拉取期间会通过 onProgress 回调汇报阶段，供主进程转发给界面显示。
 */
let ensurePromise: Promise<{
  ok: boolean
  apiRoot: string
  version?: string
  moduleCount?: number
  error?: string
}> | null = null

export function ensureApiReady(
  onProgress?: (progress: {
    phase: string
    message: string
    ratio: number
  }) => void,
): Promise<{
  ok: boolean
  apiRoot: string
  version?: string
  moduleCount?: number
  error?: string
}> {
  const existing = resolveInstalledApiRoot()
  if (existing) {
    return Promise.resolve({ ok: true, apiRoot: existing })
  }
  if (ensurePromise) return ensurePromise

  ensurePromise = (async () => {
    const report = (message: string, ratio: number): void => {
      logger.info(`[API 拉取] ${message}`)
      onProgress?.({ phase: 'fetch', message, ratio })
    }
    try {
      // 延迟 require：避免在「已带 API」的正常启动路径上加载网络相关代码
      const { ensureApiVersion, defaultRegistry } = await import('./fetcher')
      report(`从 ${defaultRegistry()} 获取最新版本信息`, 0.05)
      const result = await ensureApiVersion(versionsDir(), undefined, {
        onLog: (line) => onProgress?.({ phase: 'fetch', message: line, ratio: 0.3 }),
        onProgress: (progress) =>
          onProgress?.({
            phase: progress.phase,
            message: progress.phase,
            ratio: progress.ratio,
          }),
      })
      if (!result.ok || !result.dir) {
        return { ok: false, apiRoot: '', error: result.error ?? 'API 拉取失败' }
      }
      report(`已安装 ${result.version}`, 1)
      // 让 resolveApiRoot 立即看到新装版本
      const resolved = resolveApiRoot()
      return {
        ok: true,
        apiRoot: resolved || result.dir,
        version: result.version,
        moduleCount: result.moduleCount,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('API 拉取失败:', error)
      return { ok: false, apiRoot: '', error: message }
    } finally {
      ensurePromise = null
    }
  })()

  return ensurePromise
}

/**
 * 启动引导（幂等）：准备匿名 token → 刷新配置 → 加载 main.js。
 * 与仓库根 app.js 的启动顺序保持一致。
 */
export function bootstrapApi(force = false): Promise<ApiStatus> {
  if (bootstrapPromise && !force) return bootstrapPromise
  if (force) {
    bootstrapPromise = null
    modules = null
    status.ready = false
  }

  status.bootstrapping = true
  bootstrapPromise = (async (): Promise<ApiStatus> => {
    try {
      let apiRoot = resolveApiRoot()
      // 本地没有就现场拉一份（薄壳的冷启动路径）
      if (!apiRoot) {
        status.bootstrapError = '本地没有 API，正在从 npm 拉取…'
        const fetched = await ensureApiReady()
        if (!fetched.ok) {
          status.ready = false
          status.bootstrapError = fetched.error ?? 'API 拉取失败'
          return status
        }
        apiRoot = fetched.apiRoot
      }
      status.apiRoot = apiRoot
      if (!apiRoot) {
        status.bootstrapError = 'API 目录不可用'
        return status
      }

      ensureAnonymousTokenFile()

      // 1) 刷新匿名 token / xeapi 公钥 / neapi key
      const startedAt = Date.now()
      try {
        const generateConfig = nodeRequire(
          path.join(apiRoot, 'generateConfig.js'),
        ) as () => Promise<void>
        await generateConfig()
        logger.info(`generateConfig 完成，耗时 ${Date.now() - startedAt}ms`)
      } catch (error) {
        // 上游在部分网络环境下会抛错，但不影响主要接口可用
        logger.warn('generateConfig 失败（忽略）:', error)
      }

      // 2) 读取版本号
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(apiRoot, 'package.json'), 'utf-8'),
        ) as {
          version?: string
        }
        status.version = pkg.version ?? 'unknown'
      } catch {
        status.version = 'unknown'
      }

      // 3) 加载 main.js（内部会 require 全部 4xx 个 module）
      const loadStart = Date.now()
      const ncm = nodeRequire(path.join(apiRoot, 'main.js')) as Record<
        string,
        unknown
      >
      modules = collectModules(ncm, apiRoot)
      status.moduleCount = Object.keys(modules).length
      status.ready = true
      status.bootstrapError = undefined
      logger.info(
        `API 加载完成：v${status.version}，${status.moduleCount} 个接口，耗时 ${Date.now() - loadStart}ms`,
      )
    } catch (error) {
      status.ready = false
      status.bootstrapError =
        error instanceof Error ? error.message : String(error)
      logger.error('API 引导失败:', error)
    } finally {
      status.bootstrapping = false
    }
    return status
  })()

  return bootstrapPromise
}

export function getStatus(): ApiStatus {
  return { ...status }
}

export function getModules(): ApiModuleMap | null {
  return modules
}

export function getModuleNames(): string[] {
  return modules ? Object.keys(modules) : []
}
