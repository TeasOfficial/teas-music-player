import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon, type IconName } from './Icon'

/* ------------------------------------------------------------------ */
/* 封面                                                                */
/* ------------------------------------------------------------------ */

export interface CoverProps {
  src?: string
  size?: number | string
  radius?: number | string
  className?: string
  alt?: string
  /** 圆形封面 */
  round?: boolean
  /** 悬停时显示播放按钮 */
  onPlay?: () => void
  /** 是否正在播放（显示跳动图标） */
  playing?: boolean
  /** 右下角附加内容（如播放量） */
  badge?: ReactNode
}

export function Cover({
  src,
  size = 48,
  radius,
  className,
  alt = '',
  round = false,
  onPlay,
  playing = false,
  badge,
}: CoverProps): ReactNode {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  // 百分比尺寸（卡片封面）必须用 aspect-ratio 定高，不能写 height: 100%。
  // 原因：卡片是 grid item，会被拉伸到行高而拥有「确定高度」，
  // 此时 height:100% 会解析成卡片高度而不是图片比例 —— 封面吃掉整张卡的高度并溢出，
  // 下一行的卡片就会盖住溢出的标题文字（表现为标题被截断）。
  const style: CSSProperties =
    typeof size === 'number'
      ? {
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: round
            ? '50%'
            : radius !== undefined
              ? radius
              : undefined,
        }
      : {
          width: size,
          aspectRatio: '1 / 1',
          borderRadius: round
            ? '50%'
            : radius !== undefined
              ? radius
              : undefined,
        }

  return (
    <div
      className={clsx('cover', className, round && 'cover-round')}
      style={style}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-fallback">
          <Icon name="music" size="42%" />
        </div>
      )}
      {playing && (
        <div className="cover-playing">
          <Icon name="wave" size={16} />
        </div>
      )}
      {onPlay && (
        <button
          type="button"
          className="cover-play"
          title="播放"
          onClick={(event) => {
            event.stopPropagation()
            onPlay()
          }}
        >
          <Icon name="play" size={16} />
        </button>
      )}
      {badge && <div className="cover-badge">{badge}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 加载 / 空状态                                                       */
/* ------------------------------------------------------------------ */

export function Spinner({
  size = 20,
  label,
}: {
  size?: number
  label?: string
}): ReactNode {
  return (
    <div className="spinner-wrap">
      <Icon name="loading" size={size} className="spinner" />
      {label && <span className="muted f-12">{label}</span>}
    </div>
  )
}

export function Loading({
  label = '加载中…',
  minHeight = 160,
}: {
  label?: string
  minHeight?: number
}): ReactNode {
  return (
    <div className="center-box" style={{ minHeight }}>
      <Spinner label={label} />
    </div>
  )
}

export interface EmptyProps {
  icon?: IconName
  title: string
  description?: ReactNode
  action?: ReactNode
  minHeight?: number
}

export function Empty({
  icon = 'music',
  title,
  description,
  action,
  minHeight = 200,
}: EmptyProps): ReactNode {
  return (
    <div className="center-box empty" style={{ minHeight }}>
      <Icon name={icon} size={40} className="empty-icon" />
      <div className="f-14 text-2">{title}</div>
      {description && (
        <div className="f-12 muted empty-desc">{description}</div>
      )}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 骨架屏                                                              */
/* ------------------------------------------------------------------ */

export function SkeletonRows({ rows = 8 }: { rows?: number }): ReactNode {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <div
            className="skeleton"
            style={{ width: 40, height: 40, borderRadius: 6 }}
          />
          <div className="skeleton" style={{ width: '38%', height: 12 }} />
          <div className="skeleton" style={{ width: '18%', height: 12 }} />
          <div
            className="skeleton"
            style={{ width: 40, height: 12, marginLeft: 'auto' }}
          />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 8 }: { count?: number }): ReactNode {
  return (
    <div className="grid-cards">
      {Array.from({ length: count }).map((_, index) => (
        <div className="grid-card" key={index}>
          <div
            className="skeleton"
            style={{ width: '100%', aspectRatio: '1', borderRadius: 12 }}
          />
          <div
            className="skeleton"
            style={{ width: '80%', height: 12, marginTop: 10 }}
          />
          <div
            className="skeleton"
            style={{ width: '50%', height: 10, marginTop: 6 }}
          />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 区块标题                                                            */
/* ------------------------------------------------------------------ */

export interface SectionHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  icon?: IconName
  extra?: ReactNode
  onMore?: () => void
}

export function SectionHeader({
  title,
  subtitle,
  icon,
  extra,
  onMore,
}: SectionHeaderProps): ReactNode {
  return (
    <div className="section-header">
      <div className="section-title">
        {icon && <Icon name={icon} size={18} className="section-icon" />}
        <span className="f-20">{title}</span>
        {subtitle && (
          <span className="f-12 muted section-subtitle">{subtitle}</span>
        )}
      </div>
      <div className="row gap-8">
        {extra}
        {onMore && (
          <button type="button" className="text-btn" onClick={onMore}>
            更多 <Icon name="chevron-right" size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 标签页                                                              */
/* ------------------------------------------------------------------ */

export interface TabItem<T extends string | number = string> {
  value: T
  label: ReactNode
}

export interface TabsProps<T extends string | number = string> {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}

export function Tabs<T extends string | number = string>({
  items,
  value,
  onChange,
  className,
}: TabsProps<T>): ReactNode {
  return (
    <div className={clsx('tabs', className)}>
      {items.map((item) => (
        <button
          type="button"
          key={String(item.value)}
          className={clsx('tab', item.value === value && 'tab-active')}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 弹层                                                                */
/* ------------------------------------------------------------------ */

export interface ModalProps {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number | string
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: ModalProps): ReactNode {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <div
      className={clsx('modal-mask', open && 'modal-mask-open')}
      onMouseDown={onClose}
      aria-hidden={!open}
    >
      <div
        className="modal"
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {title && (
          <div className="modal-head">
            <span className="f-16">{title}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              title="关闭"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div className="modal-body scroll-y">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 小部件                                                              */
/* ------------------------------------------------------------------ */

export function IconButton({
  icon,
  title,
  onClick,
  disabled,
  active,
  size = 18,
  className,
}: {
  icon: IconName
  title?: string
  onClick?: (event: React.MouseEvent) => void
  disabled?: boolean
  active?: boolean
  size?: number
  className?: string
}): ReactNode {
  return (
    <button
      type="button"
      className={clsx('icon-btn', active && 'icon-btn-active', className)}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'accent' | 'warn'
}): ReactNode {
  return <span className={clsx('badge', `badge-${tone}`)}>{children}</span>
}

/** 高亮搜索关键词 */
export function Highlight({
  text,
  keyword,
}: {
  text: string
  keyword?: string
}): ReactNode {
  if (!keyword || !keyword.trim()) return <>{text}</>
  const index = text.toLowerCase().indexOf(keyword.toLowerCase())
  if (index === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <em className="hl">{text.slice(index, index + keyword.length)}</em>
      {text.slice(index + keyword.length)}
    </>
  )
}

/**
 * 详情页骨架屏。
 * 用与真实内容同构的占位块替代居中的 spinner：
 * 布局尺寸一致，内容到位时不会发生跳变，观感上只是「填充」而不是「闪一下」。
 */
export function DetailSkeleton({ rows = 8 }: { rows?: number }): ReactNode {
  return (
    <div className="page detail-skeleton">
      <div className="detail-hero detail-hero-skeleton">
        <div
          className="skeleton"
          style={{ width: 196, height: 196, borderRadius: 20, flexShrink: 0 }}
        />
        <div className="detail-info">
          <div
            className="skeleton"
            style={{ width: 62, height: 21, borderRadius: 999 }}
          />
          <div className="skeleton" style={{ width: '42%', height: 30 }} />
          <div className="skeleton" style={{ width: '26%', height: 14 }} />
          <div className="skeleton" style={{ width: '34%', height: 14 }} />
          <div className="skeleton" style={{ width: '54%', height: 12 }} />
          <div className="row gap-8" style={{ marginTop: 4 }}>
            <div
              className="skeleton"
              style={{ width: 116, height: 33, borderRadius: 999 }}
            />
            <div
              className="skeleton"
              style={{ width: 150, height: 33, borderRadius: 999 }}
            />
            <div
              className="skeleton"
              style={{ width: 96, height: 33, borderRadius: 999 }}
            />
          </div>
        </div>
      </div>
      <div
        className="row"
        style={{ justifyContent: 'space-between', margin: '18px 0 10px' }}
      >
        <div className="skeleton" style={{ width: 120, height: 16 }} />
        <div className="skeleton" style={{ width: 48, height: 14 }} />
      </div>
      <SkeletonRows rows={rows} />
    </div>
  )
}
