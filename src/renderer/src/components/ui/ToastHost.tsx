import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from './Icon'
import { useToastStore } from '@/store/toast'

const ICON_BY_TYPE = {
  info: 'info',
  success: 'check',
  error: 'x',
} as const

/** 全局提示宿主，挂在 App 根部 */
export function ToastHost(): ReactNode {
  const items = useToastStore((state) => state.items)
  const dismiss = useToastStore((state) => state.dismiss)

  if (items.length === 0) return null

  return (
    <div className="toast-host">
      {items.map((item) => (
        <div
          key={item.id}
          className={clsx(
            'toast',
            `toast-${item.type}`,
            item.leaving && 'toast-leaving',
          )}
          onClick={() => dismiss(item.id)}
          role="alert"
        >
          <Icon name={ICON_BY_TYPE[item.type]} size={15} />
          <span className="toast-text">{item.message}</span>
        </div>
      ))}
    </div>
  )
}
