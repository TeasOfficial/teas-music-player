import type { MouseEvent, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'

export interface AppLinkProps {
  to: string
  /** 与 NavLink 一致，支持传函数按激活态算类名 */
  className?: string | ((state: { isActive: boolean }) => string)
  title?: string
  onContextMenu?: (event: MouseEvent) => void
  children: ReactNode
}

/**
 * 走统一页面过渡的链接。
 *
 * 为什么不用 NavLink：NavLink 内部自己调 history 导航，绕过了 useAppNavigate，
 * 于是「点侧边栏切歌单」这条最常用的路径享受不到 View Transition。
 * 这里自己接管点击、统一走 useAppNavigate，同时保留真实的 href 便于右键/中键。
 */
export function AppLink({
  to,
  className,
  title,
  onContextMenu,
  children,
}: AppLinkProps): ReactNode {
  const navigate = useAppNavigate()
  const { pathname } = useLocation()

  const isActive =
    pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))
  const resolvedClassName =
    typeof className === 'function' ? className({ isActive }) : className

  return (
    <a
      href={`#${to}`}
      className={resolvedClassName}
      title={title}
      onContextMenu={onContextMenu}
      onClick={(event) => {
        // 交给浏览器处理组合键与中键（新标签/新窗口）
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.button !== 0
        )
          return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
