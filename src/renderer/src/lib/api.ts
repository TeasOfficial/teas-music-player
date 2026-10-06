import type { NcmApiResponse } from '@shared/types'
import type { NcmModuleName } from '@shared/moduleNames'

/* ------------------------------------------------------------------ */
/* 轻量请求缓存：列表类接口在页面来回切换时不必重复打网络                  */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  value: unknown
  expireAt: number
}

const cache = new Map<string, CacheEntry>()

/** 默认缓存 60 秒；传 0 表示不缓存 */
export const DEFAULT_TTL = 60_000

function cacheKey(name: string, params: Record<string, unknown>): string {
  const { cookie: _cookie, ...rest } = params
  return `${name}:${JSON.stringify(rest)}`
}

/** 主动失效：传接口名或 `name:` 前缀 */
export function invalidateCache(nameOrPrefix?: string): void {
  if (!nameOrPrefix) {
    cache.clear()
    return
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(nameOrPrefix)) cache.delete(key)
  }
}

/* ------------------------------------------------------------------ */
/* 调用                                                                */
/* ------------------------------------------------------------------ */

export interface CallOptions {
  /** 命中缓存的有效期（毫秒），默认 DEFAULT_TTL */
  ttl?: number
  /** 失败时是否抛出（默认 true） */
  throwOnError?: boolean
}

/** 调用接口，返回带 ok/error 的完整结果，不抛异常 */
export async function callApi<T = unknown>(
  name: NcmModuleName | string,
  params: Record<string, unknown> = {},
): Promise<NcmApiResponse<T>> {
  if (!window.ncm) {
    return {
      ok: false,
      status: 0,
      body: {} as T,
      error: '预加载脚本未注入，请重启应用',
    }
  }
  return window.ncm.api.call<T>(name, params)
}

/** 调用接口并直接拿 body；失败时抛出带可读信息的 Error */
export async function api<T = unknown>(
  name: NcmModuleName | string,
  params: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<T> {
  const res = await callApi<T>(name, params)
  if (!res.ok) {
    const error = new Error(res.error ?? '请求失败')
    if (options.throwOnError === false) return res.body
    throw error
  }
  return res.body
}

/** 带缓存的调用；适合歌单、歌手、专辑等读多写少的接口 */
export async function apiCached<T = unknown>(
  name: NcmModuleName | string,
  params: Record<string, unknown> = {},
  ttl: number = DEFAULT_TTL,
): Promise<T> {
  if (ttl <= 0) return api<T>(name, params)
  const key = cacheKey(name, params)
  const hit = cache.get(key)
  if (hit && hit.expireAt > Date.now()) return hit.value as T
  const value = await api<T>(name, params)
  cache.set(key, { value, expireAt: Date.now() + ttl })
  return value
}

/** 失败时返回 fallback，不打断渲染 */
export async function apiSafe<T>(
  name: NcmModuleName | string,
  params: Record<string, unknown> = {},
  fallback: T,
): Promise<T> {
  try {
    return await api<T>(name, params)
  } catch {
    return fallback
  }
}
