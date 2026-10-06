import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import { Icon } from '@/components/ui/Icon'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'

type QrStatus = 800 | 801 | 802 | 803

const STATUS_TEXT: Record<QrStatus, string> = {
  800: '二维码已过期',
  801: '请使用网易云音乐 App 扫码',
  802: '已扫码，请在手机上确认登录',
  803: '登录成功，正在进入…',
}

export default function Login(): ReactNode {
  const navigate = useAppNavigate()
  const applyProfile = useAuthStore((state) => state.applyProfile)
  const importCookie = useAuthStore((state) => state.importCookie)
  const loggedIn = useAuthStore((state) => state.loggedIn)

  const [mode, setMode] = useState<'qr' | 'cookie'>('qr')
  const [qrimg, setQrimg] = useState('')
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<QrStatus>(801)
  const [loading, setLoading] = useState(true)
  const [cookieDraft, setCookieDraft] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const pollRef = useRef<number | null>(null)
  const stoppedRef = useRef(false)

  const stopPolling = useCallback((): void => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const refreshQr = useCallback(async (): Promise<void> => {
    stopPolling()
    setLoading(true)
    setError('')
    try {
      const result = await window.ncm.auth.qrCreate()
      setQrimg(result.qrimg)
      setKey(result.key)
      setStatus(801)
    } catch (err) {
      setError(err instanceof Error ? err.message : '二维码获取失败')
    } finally {
      setLoading(false)
    }
  }, [stopPolling])

  useEffect(() => {
    if (loggedIn) {
      navigate('/discover', { replace: true })
      return
    }
    void refreshQr()
    return () => stopPolling()
  }, [loggedIn, navigate, refreshQr, stopPolling])

  useEffect(() => {
    if (!key || mode !== 'qr') return
    stoppedRef.current = false

    pollRef.current = window.setInterval(() => {
      if (stoppedRef.current) return
      void window.ncm.auth
        .qrCheck(key)
        .then((result) => {
          setStatus(result.code)
          if (result.code === 803) {
            stoppedRef.current = true
            stopPolling()
            if (result.profile) applyProfile(result.profile)
            toast.success('登录成功')
            navigate('/discover', { replace: true })
          } else if (result.code === 800) {
            stoppedRef.current = true
            stopPolling()
          }
        })
        .catch(() => {
          /* 网络抖动时继续轮询 */
        })
    }, 2000)

    return () => stopPolling()
  }, [key, mode, applyProfile, navigate, stopPolling])

  const submitCookie = async (): Promise<void> => {
    if (!cookieDraft.trim()) return
    setImporting(true)
    setError('')
    try {
      await importCookie(cookieDraft.trim())
      navigate('/discover', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="col gap-4" style={{ alignItems: 'center' }}>
          <Icon name="music" size={30} />
          <span className="f-16">登录网易云账号</span>
          <span className="f-12 muted">登录后可同步歌单、每日推荐与收藏</span>
        </div>

        <div className="tabs">
          <button
            type="button"
            className={mode === 'qr' ? 'tab tab-active' : 'tab'}
            onClick={() => setMode('qr')}
          >
            扫码登录
          </button>
          <button
            type="button"
            className={mode === 'cookie' ? 'tab tab-active' : 'tab'}
            onClick={() => setMode('cookie')}
          >
            Cookie 登录
          </button>
        </div>

        {mode === 'qr' ? (
          <>
            <div className="qr-box">
              {loading ? (
                <Icon name="loading" size={26} className="spin" />
              ) : qrimg ? (
                <img src={qrimg} alt="登录二维码" />
              ) : (
                <span className="muted f-12">二维码加载失败</span>
              )}
              {(status === 800 || (!loading && !qrimg)) && (
                <div className="qr-overlay" onClick={() => void refreshQr()}>
                  <Icon name="refresh" size={22} />
                  <span>点击刷新二维码</span>
                </div>
              )}
            </div>

            <div className="f-12 text-2">
              {loading ? '正在生成二维码…' : STATUS_TEXT[status]}
            </div>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void refreshQr()}
            >
              <Icon name="refresh" size={14} /> 刷新二维码
            </button>
          </>
        ) : (
          <div className="col gap-8" style={{ width: '100%' }}>
            <textarea
              className="comment-input"
              style={{ minHeight: 110 }}
              placeholder="粘贴浏览器中的完整 Cookie（必须包含 MUSIC_U=…）"
              value={cookieDraft}
              onChange={(event) => setCookieDraft(event.target.value)}
            />
            <div
              className="f-11 muted"
              style={{ textAlign: 'left', lineHeight: 1.7 }}
            >
              获取方式：浏览器登录 music.163.com → 开发者工具 → Application →
              Cookies → 复制全部键值对。Cookie 仅保存在本机 userData 目录。
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={importing || !cookieDraft.trim()}
              onClick={() => void submitCookie()}
            >
              {importing ? '正在校验…' : '导入并登录'}
            </button>
          </div>
        )}

        {error && (
          <div className="f-12" style={{ color: 'var(--accent)' }}>
            {error}
          </div>
        )}

        <div className="f-11 muted">
          登录信息只保存在本机，不会上传到任何第三方服务器
        </div>
      </div>
    </div>
  )
}
