import type { NcmApiResponse } from '@shared/types'
import { logger } from '../logger'
import { session } from '../store'
import { CookieJar } from './cookies'
import { bootstrapApi, getModules, getStatus } from './loader'

/** 全局 cookie 罐，启动时从本地会话恢复 */
export const jar = new CookieJar(session.cookie)

/** 把当前 cookie 落盘（用户资料沿用内存里的值） */
export function persistCookie(): void {
  session.save(jar.toString(), session.profile)
}

/* ------------------------------------------------------------------ */
/* 并发闸门：网易云对突发请求会限流，UI 首屏经常一次发十几个请求            */
/* ------------------------------------------------------------------ */

const MAX_CONCURRENCY = 8
let running = 0
const waiting: Array<() => void> = []

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENCY) {
    running += 1
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  running += 1
}

function release(): void {
  running -= 1
  const next = waiting.shift()
  if (next) next()
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

/** 业务码是否代表成功 */
function isBusinessOk(body: Record<string, unknown> | undefined): boolean {
  if (!body) return true
  const code = body.code
  if (typeof code !== 'number') return true
  // 200 正常；部分接口返回 800/801 等业务态由调用方自行判断
  return code === 200
}

function errorMessageOf(
  body: Record<string, unknown> | undefined,
  status: number,
): string {
  if (body) {
    const code = body.code
    if (code === 301) return '需要登录后才能使用该功能'
    if (code === 302) return '该资源需要付费或会员权限'
    if (code === 400) return '请求参数有误'
    if (code === 404) return '资源不存在'
    if (code === 405) return '当前环境不支持该操作'
    if (code === 406) return '该歌曲无版权或已下架'
    if (code === 447) return '登录状态失效，请重新登录'
    if (code === 462) return '当前 IP 被限制，请稍后再试'
    if (code === 498) return '账号异常'
    if (code === 502) return '接口繁忙，请稍后重试'
    if (code === 509) return '请求过于频繁，请稍后再试'
    const msg = body.message ?? body.msg
    if (typeof msg === 'string' && msg) return msg
    if (typeof code === 'number') return `接口返回 code=${code}`
  }
  return `请求失败（HTTP ${status}）`
}

/**
 * 调用一个 API 模块。
 * - 自动注入当前 cookie
 * - 自动累积响应里的 Set-Cookie
 * - 网络层失败自动重试 2 次
 */
export async function callApi<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<NcmApiResponse<T>> {
  const st = await bootstrapApi()
  if (!st.ready) {
    return {
      ok: false,
      status: 503,
      body: {} as T,
      error: st.bootstrapError ?? 'API 尚未就绪',
    }
  }

  const modules = getModules()
  const mod = modules?.[name]
  if (!mod) {
    return {
      ok: false,
      status: 404,
      body: {} as T,
      error: `接口不存在：${name}`,
    }
  }

  const cookie = jar.toString()
  const payload: Record<string, unknown> = { ...params }
  if (cookie && payload.cookie === undefined) payload.cookie = cookie

  await acquire()
  try {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await mod(payload)
        if (res && res.cookie) {
          if (jar.applySetCookie(res.cookie)) persistCookie()
        }
        const httpStatus = typeof res?.status === 'number' ? res.status : 200
        const body = (res?.body ?? {}) as Record<string, unknown>
        const ok = httpStatus === 200 && isBusinessOk(body)
        return {
          ok,
          status: httpStatus,
          body: body as T,
          error: ok ? undefined : errorMessageOf(body, httpStatus),
        }
      } catch (error) {
        lastError = error
        if (attempt < 2) {
          await sleep(250 * (attempt + 1))
          continue
        }
      }
    }
    const message =
      lastError instanceof Error ? lastError.message : String(lastError)
    logger.warn(`调用 ${name} 失败:`, message)
    return {
      ok: false,
      status: 500,
      body: {} as T,
      error: normalizeNetworkError(message),
    }
  } finally {
    release()
  }
}

function normalizeNetworkError(message: string): string {
  // 上游有些接口 reject 的是普通对象（如 { status, body: { code, msg } }），
  // 直接 String() 会得到 "[object Object]"，对用户毫无意义
  if (!message || message === '[object Object]')
    return '接口调用失败，请稍后重试'
  if (/timeout|ETIMEDOUT/i.test(message)) return '请求超时，请检查网络后重试'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message))
    return '无法连接网易云服务器，请检查网络或代理'
  if (/ECONNRESET|socket hang up/i.test(message))
    return '连接被重置，请稍后重试'
  if (/certificate|SSL/i.test(message))
    return '证书校验失败，请检查系统时间或代理设置'
  return message || '未知网络错误'
}

/** 便捷方法：只取 body，失败时抛出可读错误 */
export async function apiData<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res = await callApi<T>(name, params)
  if (!res.ok) throw new Error(res.error ?? '请求失败')
  return res.body
}

export { getStatus }
