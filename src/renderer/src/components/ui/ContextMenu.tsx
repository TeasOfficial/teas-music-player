import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  key: string
  label?: ReactNode
  icon?: IconName
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  /** 分隔线（忽略其它字段） */
  divider?: boolean
  /** 勾选态 */
  checked?: boolean
  /** 二级菜单 */
  children?: MenuItem[]
}

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
}

let setMenuState: Dispatch<SetStateAction<MenuState>> | null = null

const CLOSED: MenuState = { open: false, x: 0, y: 0, items: [] }

/** 在指定坐标打开右键菜单（供任意组件调用，无需 Portal 包裹） */
export interface MenuAnchorEvent {
  clientX: number
  clientY: number
  preventDefault?: () => void
}

export function openContextMenu(
  event: MenuAnchorEvent,
  items: MenuItem[],
): void {
  event.preventDefault?.()
  setMenuState?.({ open: true, x: event.clientX, y: event.clientY, items })
}

/** 关闭菜单：先切到「离场」状态播动画，动画结束后再清空内容 */
export function closeContextMenu(): void {
  setMenuState?.((previous) =>
    previous.open ? { ...previous, open: false } : previous,
  )
  window.setTimeout(() => {
    // 期间如果又打开了新菜单就不清，避免把新菜单一起抹掉
    setMenuState?.((previous) => (previous.open ? previous : CLOSED))
  }, 150)
}

/** 以某个元素为锚点打开菜单（用于播放条上的下拉，例如音质、播放模式） */
export function openMenuAtElement(
  element: HTMLElement | null,
  items: MenuItem[],
  placement: 'top' | 'bottom' = 'bottom',
): void {
  if (!element) return
  const rect = element.getBoundingClientRect()
  const estimatedHeight = items.length * 32 + 12
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - 216))
  const y =
    placement === 'top'
      ? Math.max(8, rect.top - estimatedHeight - 6)
      : rect.bottom + 6
  setMenuState?.({ open: true, x, y, items })
}

/** 挂在 App 根部的菜单宿主 */
export function ContextMenuHost(): ReactNode {
  const [state, setState] = useState<MenuState>(CLOSED)
  const [openSub, setOpenSub] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMenuState = setState
    return () => {
      setMenuState = null
    }
  }, [])

  useEffect(() => {
    if (!state.open) return
    const close = (event: Event): void => {
      if (
        ref.current &&
        event.target instanceof Node &&
        ref.current.contains(event.target)
      )
        return
      closeContextMenu()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('mousedown', close, true)
    document.addEventListener('contextmenu', close, true)
    window.addEventListener('blur', closeContextMenu)
    window.addEventListener('resize', closeContextMenu)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('contextmenu', close, true)
      window.removeEventListener('blur', closeContextMenu)
      window.removeEventListener('resize', closeContextMenu)
      document.removeEventListener('keydown', onKey)
    }
  }, [state.open])

  useEffect(() => {
    setOpenSub(null)
  }, [state.x, state.y, state.open])

  if (state.items.length === 0) return null

  // 防止超出视口
  const width = 208
  const estimatedHeight = state.items.length * 32 + 12
  const left = Math.min(state.x, window.innerWidth - width - 8)
  const top = Math.min(
    state.y,
    Math.max(8, window.innerHeight - estimatedHeight - 8),
  )

  return createPortal(
    <div
      ref={ref}
      className="context-menu fade-in"
      style={{ left, top, width }}
    >
      {state.items.map((item) =>
        item.divider ? (
          <div className="context-divider" key={item.key} />
        ) : (
          <div
            key={item.key}
            className={clsx(
              'context-item',
              item.disabled && 'context-item-disabled',
              item.danger && 'context-item-danger',
            )}
            onClick={() => {
              if (item.disabled || item.children?.length) return
              item.onClick?.()
              closeContextMenu()
            }}
            onMouseEnter={() =>
              setOpenSub(item.children?.length ? item.key : null)
            }
          >
            {item.icon ? (
              <Icon name={item.icon} size={15} />
            ) : (
              <span className="context-icon-gap" />
            )}
            <span className="context-label ellipsis">{item.label}</span>
            {item.checked && <Icon name="check" size={14} />}
            {item.children?.length ? (
              <Icon name="chevron-right" size={14} />
            ) : null}

            {item.children?.length && openSub === item.key && (
              <div className="context-menu context-submenu">
                {item.children.map((child) =>
                  child.divider ? (
                    <div className="context-divider" key={child.key} />
                  ) : (
                    <div
                      key={child.key}
                      className={clsx(
                        'context-item',
                        child.disabled && 'context-item-disabled',
                      )}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (child.disabled) return
                        child.onClick?.()
                        closeContextMenu()
                      }}
                    >
                      {child.icon ? (
                        <Icon name={child.icon} size={15} />
                      ) : (
                        <span className="context-icon-gap" />
                      )}
                      <span className="context-label ellipsis">
                        {child.label}
                      </span>
                      {child.checked && <Icon name="check" size={14} />}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>,
    document.body,
  )
}
