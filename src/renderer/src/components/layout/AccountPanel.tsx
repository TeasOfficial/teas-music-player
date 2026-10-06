import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from '@/components/ui/Icon'
import { Cover } from '@/components/ui/Primitives'
import { useAppNavigate } from '@/lib/navigation'
import { api } from '@/lib/api'
import { imageUrl } from '@/lib/format'
import { useAuthStore } from '@/store/auth'
import { useSettingsStore } from '@/store/settings'
import { toast } from '@/store/toast'

interface AccountStats {
  follows: number
  followeds: number
  eventCount: number
  level: number
}

interface SigninDetail {
  android?: { code?: number; point?: number }
  web?: { code?: number; point?: number }
  code?: number
}

/** 记录「今天已签到」的本地键。接口没有查询签到状态的入口，只能本地记 */
const SIGNIN_KEY = 'ncm.signin.date'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * VIP 标签。
 * vipType 是位标记：0 无、10 音乐包、11 黑胶VIP、含 100 位为 SVIP。
 */
function vipLabel(vipType: number | undefined): string | null {
  if (!vipType) return null
  if (vipType & 100) return 'SVIP'
  if (vipType & 10) return '黑胶VIP'
  return 'VIP'
}

export interface AccountPanelProps {
  open: boolean
  onClose: () => void
}

/** 标题栏头像展开的个人中心面板 */
export function AccountPanel({ open, onClose }: AccountPanelProps): ReactNode {
  const navigate = useAppNavigate()
  const profile = useAuthStore((state) => state.profile)
  const logout = useAuthStore((state) => state.logout)
  const theme = useSettingsStore((state) => state.settings.theme)
  const update = useSettingsStore((state) => state.update)

  const [stats, setStats] = useState<AccountStats | null>(null)
  const [signedDate, setSignedDate] = useState(
    () => window.localStorage.getItem(SIGNIN_KEY) ?? '',
  )
  const [signing, setSigning] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const uid = profile?.userId ?? 0

  // 打开时才拉关注/粉丝/等级：不打开就不多打这两个请求
  useEffect(() => {
    if (!open || !uid) return
    let cancelled = false
    void (async () => {
      try {
        const [detail, level] = await Promise.all([
          api<{
            profile?: {
              follows?: number
              followeds?: number
              eventCount?: number
            }
          }>('user_detail', { uid }),
          api<{ data?: { level?: number } }>('user_level', {}),
        ])
        if (cancelled) return
        const info = detail.profile ?? {}
        setStats({
          follows: info.follows ?? 0,
          followeds: info.followeds ?? 0,
          eventCount: info.eventCount ?? 0,
          level: level.data?.level ?? 0,
        })
      } catch {
        /* 统计拉不到就不显示，不影响面板其它操作 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, uid])

  // 点击面板外或按 Esc 关闭；点头像本身除外，否则会和「点击切换」互相打架
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.titlebar-avatar')) return
      if (panelRef.current && !panelRef.current.contains(event.target as Node))
        onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  const signedToday = signedDate === todayKey()

  const markSigned = (): void => {
    const key = todayKey()
    window.localStorage.setItem(SIGNIN_KEY, key)
    setSignedDate(key)
  }

  const doSignin = async (): Promise<void> => {
    if (signing || signedToday) return
    setSigning(true)
    try {
      const body = await api<{ data?: SigninDetail } & SigninDetail>(
        'daily_signin',
        {
          type: 0,
        },
      )
      const detail = (body.data ?? body) as SigninDetail
      const code = detail.android?.code ?? detail.web?.code ?? detail.code
      const point = detail.android?.point ?? detail.web?.point ?? 0
      if (code === 200) {
        toast.success(`签到成功，经验 +${point}`)
        markSigned()
      } else if (code === -2) {
        toast.info('今天已经签到过了')
        markSigned()
      } else {
        toast.error('签到失败，请稍后再试')
      }
    } catch (error) {
      toast.fromError(error, '签到失败')
    } finally {
      setSigning(false)
    }
  }

  if (!open || !profile) return null

  const badge = vipLabel(profile.vipType)
  const go = (path: string): void => {
    onClose()
    navigate(path)
  }

  return (
    <div className="account-panel no-drag" ref={panelRef}>
      <div className="account-head">
        <Cover src={imageUrl(profile.avatarUrl, 120)} size={46} round />
        <div className="account-identity">
          <div className="row gap-6">
            <span className="account-name ellipsis">{profile.nickname}</span>
            {badge && <span className="account-vip">{badge}</span>}
          </div>
          <span className="account-sign f-12 muted ellipsis">
            {profile.signature || '这个人很懒，什么都没写'}
          </span>
        </div>
      </div>

      <div className="account-stats">
        {[
          { label: '笔记', value: stats?.eventCount },
          { label: '关注', value: stats?.follows },
          { label: '粉丝', value: stats?.followeds },
          { label: '等级', value: stats ? `Lv.${stats.level}` : undefined },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            className="account-stat"
            onClick={() => go(`/user/${uid}`)}
          >
            <b>{item.value ?? '—'}</b>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="account-signin">
        <div className="account-signin-text">
          <span className="f-13 bold">
            <Icon name="calendar" size={14} /> 每日签到
          </span>
          <span className="f-12 muted">
            {signedToday ? '今天已签到，明天再来' : '签到可得 3 点经验'}
          </span>
        </div>
        <button
          type="button"
          className={clsx('btn', signedToday ? 'btn-ghost' : 'btn-primary')}
          disabled={signing || signedToday}
          onClick={() => void doSignin()}
        >
          {signedToday ? '已签到' : signing ? '签到中…' : '签到'}
        </button>
      </div>

      <div className="account-menu">
        <button
          type="button"
          className="account-item"
          onClick={() => go(`/user/${uid}`)}
        >
          <Icon name="user" size={16} />
          <span>我的主页</span>
          <Icon name="chevron-right" size={14} className="account-item-arrow" />
        </button>
        <button
          type="button"
          className="account-item"
          onClick={() => go('/likes')}
        >
          <Icon name="heart" size={16} />
          <span>我喜欢的音乐</span>
          <Icon name="chevron-right" size={14} className="account-item-arrow" />
        </button>
        <button
          type="button"
          className="account-item"
          onClick={() => go('/local')}
        >
          <Icon name="folder" size={16} />
          <span>本地音乐</span>
          <Icon name="chevron-right" size={14} className="account-item-arrow" />
        </button>

        <div className="account-divider" />

        <button
          type="button"
          className="account-item"
          onClick={() => go('/settings')}
        >
          <Icon name="settings" size={16} />
          <span>个人信息设置</span>
          <Icon name="chevron-right" size={14} className="account-item-arrow" />
        </button>
        <button
          type="button"
          className="account-item"
          onClick={() =>
            void update('theme', theme === 'dark' ? 'light' : 'dark')
          }
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          <span>切换到{theme === 'dark' ? '浅色' : '深色'}主题</span>
          <Icon name="chevron-right" size={14} className="account-item-arrow" />
        </button>

        <div className="account-divider" />

        <button
          type="button"
          className="account-item"
          onClick={() => {
            void logout()
            go('/login')
          }}
        >
          <Icon name="refresh" size={16} />
          <span>切换账号</span>
          <Icon name="chevron-right" size={14} className="account-item-arrow" />
        </button>
        <button
          type="button"
          className="account-item account-item-danger"
          onClick={() => {
            void logout()
            onClose()
          }}
        >
          <Icon name="close" size={16} />
          <span>退出登录</span>
          <Icon name="chevron-right" size={14} className="account-item-arrow" />
        </button>
      </div>
    </div>
  )
}
