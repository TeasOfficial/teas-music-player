import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useLocation } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import { Icon } from '@/components/ui/Icon'
import { Cover } from '@/components/ui/Primitives'
import { AccountPanel } from './AccountPanel'
import { useAuthStore } from '@/store/auth'
import { imageUrl } from '@/lib/format'

/** 自定义标题栏：拖拽区域 + 前进后退 + 搜索 + 窗口按钮 */
export function TitleBar(): ReactNode {
  const navigate = useAppNavigate()
  const location = useLocation()
  const profile = useAuthStore((state) => state.profile)
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const [query, setQuery] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isMac = window.ncm ? navigator.userAgent.includes('Mac') : false

  useEffect(() => {
    // 切到搜索页时同步关键词
    if (location.pathname === '/search') {
      const params = new URLSearchParams(location.search)
      setQuery(params.get('q') ?? '')
    }
  }, [location.pathname, location.search])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const submit = (): void => {
    const keyword = query.trim()
    if (!keyword) return
    navigate(`/search?q=${encodeURIComponent(keyword)}`)
  }

  return (
    <header className={clsx('titlebar', 'drag', isMac && 'titlebar-mac')}>
      <div className="titlebar-nav no-drag">
        <button
          type="button"
          className="icon-btn"
          title="后退"
          onClick={() => navigate(-1)}
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="前进"
          onClick={() => navigate(1)}
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      <div className="titlebar-search no-drag">
        <Icon name="search" size={15} className="titlebar-search-icon" />
        <input
          ref={inputRef}
          value={query}
          placeholder="搜索歌曲、歌手、歌单…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') inputRef.current?.blur()
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setQuery('')}
            title="清空"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <div className="spacer" />

      <div className="titlebar-right no-drag">
        <button
          type="button"
          className="icon-btn"
          title="设置"
          onClick={() => navigate('/settings')}
        >
          <Icon name="settings" size={16} />
        </button>

        {loggedIn && profile ? (
          <button
            type="button"
            className={clsx(
              'titlebar-avatar',
              accountOpen && 'titlebar-avatar-open',
            )}
            onClick={() => setAccountOpen((value) => !value)}
            title={profile.nickname}
          >
            <Cover src={imageUrl(profile.avatarUrl, 60)} size={28} round />
          </button>
        ) : (
          <button
            type="button"
            className="login-btn"
            onClick={() => navigate('/login')}
          >
            登录
          </button>
        )}
      </div>

      <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />

      {!isMac && (
        <div className="window-controls no-drag">
          <button
            type="button"
            className="window-btn"
            title="最小化"
            onClick={() => void window.ncm.win.minimize()}
          >
            <Icon name="minimize" size={14} />
          </button>
          <button
            type="button"
            className="window-btn"
            title="最大化"
            onClick={() => void window.ncm.win.maximize()}
          >
            <Icon name="maximize" size={13} />
          </button>
          <button
            type="button"
            className="window-btn window-btn-close"
            title="关闭"
            onClick={() => void window.ncm.win.close()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </header>
  )
}
