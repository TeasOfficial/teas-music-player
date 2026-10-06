import type { AuthState, UserProfile } from '@shared/types'
import type { QrCheckResult, QrCreateResult } from '@shared/ipc'
import { logger } from '../logger'
import { session } from '../store'
import { callApi, jar, persistCookie } from './invoke'

const QR_MESSAGES: Record<number, string> = {
  800: '二维码已过期，请点击刷新',
  801: '等待扫码',
  802: '已扫码，请在手机上确认登录',
  803: '登录成功',
}

interface LoginStatusBody {
  data?: {
    code?: number
    account?: { id?: number; vipType?: number } | null
    profile?: UserProfile | null
  }
  code?: number
  account?: { id?: number; vipType?: number } | null
  profile?: UserProfile | null
}

/** 拉取当前登录用户资料；未登录返回 null */
export async function fetchProfile(): Promise<UserProfile | null> {
  const res = await callApi<LoginStatusBody>('login_status', {})
  const data = res.body?.data ?? res.body
  const profile = (data?.profile ?? null) as UserProfile | null
  if (profile && profile.userId) return profile
  return null
}

/** 生成登录二维码 */
export async function qrCreate(): Promise<QrCreateResult> {
  const keyRes = await callApi<{ data?: { unikey?: string } }>(
    'login_qr_key',
    {},
  )
  const key = keyRes.body?.data?.unikey
  if (!keyRes.ok || !key) throw new Error(keyRes.error ?? '获取二维码 key 失败')

  const createRes = await callApi<{
    data?: { qrimg?: string; qrurl?: string }
  }>('login_qr_create', { key, qrimg: true, platform: 'web' })

  const qrimg = createRes.body?.data?.qrimg
  const url = createRes.body?.data?.qrurl ?? ''
  if (!createRes.ok || !qrimg)
    throw new Error(createRes.error ?? '生成二维码失败')
  return { key, qrimg, url }
}

/** 轮询扫码状态；code=803 时写入 cookie 并返回资料 */
export async function qrCheck(key: string): Promise<QrCheckResult> {
  const res = await callApi<{
    code?: number
    cookie?: string
    message?: string
  }>('login_qr_check', { key })
  const code = (res.body?.code ?? 801) as 800 | 801 | 802 | 803

  if (code !== 803) {
    return {
      code,
      message: QR_MESSAGES[code] ?? res.body?.message ?? '未知状态',
    }
  }

  // 二维码接口把 cookie 放在 body.cookie（字符串）
  const cookieStr = res.body?.cookie
  if (typeof cookieStr === 'string' && cookieStr) jar.merge(cookieStr)
  // 少数情况下 cookie 只在响应头里（invoke 已自动合并），这里再兜底判一次
  if (!jar.loggedIn) {
    logger.warn('扫码返回 803 但未拿到 MUSIC_U')
    return { code: 800, message: '登录失败：未获取到登录凭证，请重试' }
  }

  const profile = await fetchProfile()
  if (profile) session.save(jar.toString(), profile)
  else persistCookie()

  return {
    code: 803,
    message: '登录成功',
    cookie: jar.toString(),
    profile: profile ?? undefined,
  }
}

/** 读取登录态；verify=true 时向服务端确认一次 */
export async function getAuthState(verify = false): Promise<AuthState> {
  if (!jar.loggedIn) {
    return { loggedIn: false, cookieMasked: jar.masked() }
  }

  let profile = session.profile
  if (verify || !profile) {
    try {
      profile = await fetchProfile()
      if (profile) session.save(jar.toString(), profile)
    } catch (error) {
      logger.warn('校验登录态失败:', error)
    }
  }

  if (!profile) {
    return { loggedIn: false, cookieMasked: jar.masked() }
  }

  return {
    loggedIn: true,
    profile,
    cookieMasked: jar.masked(),
    vipType: profile.vipType,
  }
}

/** 退出登录：清空 cookie 与会话 */
export async function logout(): Promise<void> {
  try {
    await callApi('logout', {})
  } catch (error) {
    logger.warn('调用 logout 接口失败（忽略）:', error)
  }
  jar.clear()
  session.clear()
}

/** 手动导入 cookie（从浏览器复制） */
export async function importCookie(cookie: string): Promise<AuthState> {
  const cleaned = cookie.trim()
  if (!cleaned) throw new Error('cookie 不能为空')
  jar.merge(cleaned)
  if (!jar.loggedIn) {
    throw new Error(
      'cookie 中缺少 MUSIC_U 字段，请确认复制的是已登录的完整 cookie',
    )
  }
  const profile = await fetchProfile()
  if (!profile) {
    jar.delete('MUSIC_U')
    throw new Error('登录态校验失败，cookie 可能已失效')
  }
  session.save(jar.toString(), profile)
  return {
    loggedIn: true,
    profile,
    cookieMasked: jar.masked(),
    vipType: profile.vipType,
  }
}

/** 用 refresh cookie 续期登录态 */
export async function refreshLogin(): Promise<AuthState> {
  if (!jar.loggedIn) return { loggedIn: false, cookieMasked: jar.masked() }
  try {
    await callApi('login_refresh', {})
  } catch (error) {
    logger.warn('刷新登录态失败:', error)
  }
  return getAuthState(true)
}
