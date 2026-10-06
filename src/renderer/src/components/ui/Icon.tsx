import type { CSSProperties, ReactNode } from 'react'

/**
 * 内置图标集：全部为 24x24 viewBox 的内联 SVG，颜色继承 currentColor，
 * 因此不需要任何图片资源，也不会有额外的网络请求。
 */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function svg(children: ReactNode, filled = false): ReactNode {
  return filled ? (
    <g fill="currentColor" stroke="none">
      {children}
    </g>
  ) : (
    <g {...S}>{children}</g>
  )
}

const ICONS: Record<string, ReactNode> = {
  /* ---- 播放控制 ---- */
  play: svg(<path d="M7 4.5 19.5 12 7 19.5z" />, true),
  pause: svg(
    <>
      <rect x="6.5" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="13.5" y="4.5" width="4" height="15" rx="1.2" />
    </>,
    true,
  ),
  prev: svg(
    <>
      <path d="M18.5 5.5 9 12l9.5 6.5z" />
      <rect x="4.5" y="5" width="2.6" height="14" rx="1.2" />
    </>,
    true,
  ),
  next: svg(
    <>
      <path d="M5.5 5.5 15 12l-9.5 6.5z" />
      <rect x="16.9" y="5" width="2.6" height="14" rx="1.2" />
    </>,
    true,
  ),
  stop: svg(<rect x="6" y="6" width="12" height="12" rx="2" />, true),
  'play-next': svg(
    <>
      <path d="M4 5.5 12 12l-8 6.5z" />
      <path d="M20 5v14" />
      <path d="M17 8.5 20 6l-3-2.5" />
    </>,
  ),

  /* ---- 播放模式 ---- */
  // 顺序播放：起点竖线 + 向右箭头（「顺着往下播」），
  // 不要跟队列的 list（三横线+音符）混用，两者在播放条上会同时出现
  order: svg(
    <>
      <path d="M4.5 6v12" />
      <path d="M8.5 12H19" />
      <path d="M15.8 8.4 19.4 12l-3.6 3.6" />
    </>,
  ),
  list: svg(
    <>
      <path d="M4 7h11M4 12h11M4 17h7" />
      <path d="M18 10.5v7.2" />
      <circle cx="18" cy="18.6" r="2.2" />
    </>,
  ),
  loop: svg(
    <>
      <path d="M4 12a8 8 0 0 1 8-8h5" />
      <path d="M20 12a8 8 0 0 1-8 8H7" />
      <path d="M14.5 1.5 17.5 4l-3 2.5" />
      <path d="M9.5 22.5 6.5 20l3-2.5" />
    </>,
  ),
  single: svg(
    <>
      <path d="M4 12a8 8 0 0 1 8-8h5" />
      <path d="M20 12a8 8 0 0 1-8 8H7" />
      <path d="M14.5 1.5 17.5 4l-3 2.5" />
      <path d="M9.5 22.5 6.5 20l3-2.5" />
      <path d="M12 9.5v5M11 10.6l1-.9" />
    </>,
  ),
  shuffle: svg(
    <>
      <path d="M3 6h4l3 4" />
      <path d="M3 18h4l9-12h5" />
      <path d="M17 18h4" />
      <path d="M18.5 3.5 21 6l-2.5 2.5" />
      <path d="M18.5 15.5 21 18l-2.5 2.5" />
    </>,
  ),

  /* ---- 音量 ---- */
  volume: svg(
    <>
      <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18 6.6a7.6 7.6 0 0 1 0 10.8" />
    </>,
  ),
  'volume-low': svg(
    <>
      <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
    </>,
  ),
  mute: svg(
    <>
      <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" />
      <path d="M16 9.5 21 14.5M21 9.5 16 14.5" />
    </>,
  ),

  /* ---- 收藏/互动 ---- */
  heart: svg(
    <path d="M12 20.3s-7.6-4.6-7.6-9.6A4.4 4.4 0 0 1 12 8.4a4.4 4.4 0 0 1 7.6 2.3c0 5-7.6 9.6-7.6 9.6z" />,
  ),
  'heart-filled': svg(
    <path d="M12 20.6S3.6 15.6 3.6 10.4A5 5 0 0 1 12 7.4a5 5 0 0 1 8.4 3c0 5.2-8.4 10.2-8.4 10.2z" />,
    true,
  ),
  comment: svg(
    <path d="M20 12.5c0 3.9-3.6 7-8 7a9.6 9.6 0 0 1-2.6-.36L5 21l1.1-3.3A6.6 6.6 0 0 1 4 12.5c0-3.9 3.6-7 8-7s8 3.1 8 7z" />,
  ),
  share: svg(
    <>
      <circle cx="18" cy="5.5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="18.5" r="2.6" />
      <path d="M8.4 10.9 15.6 6.6M8.4 13.1l7.2 4.3" />
    </>,
  ),
  download: svg(
    <>
      <path d="M12 3.5v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>,
  ),
  'add-list': svg(
    <>
      <path d="M4 7h10M4 12h10M4 17h6" />
      <path d="M17 12.5v6M14 15.5h6" />
    </>,
  ),
  trash: svg(
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6.5 7l1 12.2h9L17.5 7" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </>,
  ),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  minus: svg(<path d="M5 12h14" />),
  check: svg(<path d="M5 12.5 10 17.5 19 6.5" />),
  x: svg(<path d="M6 6l12 12M18 6 6 18" />),

  /* ---- 导航 ---- */
  music: svg(
    <>
      <path d="M9 18V6.5l10-2v11" />
      <circle cx="6.5" cy="18" r="2.6" />
      <circle cx="16.5" cy="15.5" r="2.6" />
    </>,
  ),
  radio: svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 16.5a6.4 6.4 0 0 0 0-9" />
      <path d="M4.6 4.6a10.4 10.4 0 0 0 0 14.8M19.4 19.4a10.4 10.4 0 0 0 0-14.8" />
    </>,
  ),
  video: svg(
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.4" />
      <path d="M16 11l5-3v8l-5-3z" />
    </>,
  ),
  search: svg(
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M15.6 15.6 20.5 20.5" />
    </>,
  ),
  calendar: svg(
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.4" />
      <path d="M3.5 10h17M8.5 3.5v4M15.5 3.5v4" />
    </>,
  ),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3.2 2" />
    </>,
  ),
  cloud: svg(
    <path d="M7.5 18.5h9.2a3.8 3.8 0 0 0 .5-7.6 5.6 5.6 0 0 0-10.7-1.2A3.9 3.9 0 0 0 7.5 18.5z" />,
  ),
  folder: svg(
    <path d="M3.5 7.4A2 2 0 0 1 5.5 5.4h3.3l2 2.4h7.7a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z" />,
  ),
  'folder-open': svg(
    <>
      <path d="M3.5 7.4A2 2 0 0 1 5.5 5.4h3.3l2 2.4h6.7a2 2 0 0 1 2 2v1" />
      <path d="M3.5 9.8h17.2l-2 7.3a2 2 0 0 1-1.9 1.5H5.5a2 2 0 0 1-2-2z" />
    </>,
  ),
  user: svg(
    <>
      <circle cx="12" cy="8.4" r="3.9" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </>,
  ),
  users: svg(
    <>
      <circle cx="9.5" cy="8.6" r="3.4" />
      <path d="M3.6 19.4a6 6 0 0 1 11.8 0" />
      <path d="M16 5.6a3.4 3.4 0 0 1 0 6.6M17.4 14.2a6 6 0 0 1 3.2 5.2" />
    </>,
  ),
  settings: svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.6a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.17a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-2.94-1.13l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0-1.2-2.87H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.22 6.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 2.87-1.2V2.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0 1.2 2.87H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.21z" />
    </>,
  ),

  /* ---- 窗口控制 ---- */
  // 注意：横线是零面积路径，绝对不能标成 filled=true，否则什么都画不出来
  minimize: svg(<path d="M5 12h14" />),
  maximize: svg(<rect x="5.5" y="5.5" width="13" height="13" rx="1.6" />),
  restore: svg(
    <>
      <rect x="4.5" y="8" width="11" height="11" rx="1.6" />
      <path d="M8.5 5.5h9a1.6 1.6 0 0 1 1.6 1.6v9" />
    </>,
  ),
  close: svg(<path d="M6 6l12 12M18 6 6 18" />),
  pin: svg(
    <>
      <path d="M9.5 3.5h5l-.8 5.2 3.1 3.1H6.2l3.1-3.1z" />
      <path d="M12 11.8V20.5" />
    </>,
  ),
  'pin-off': svg(
    <>
      <path d="M9.5 3.5h5l-.8 5.2 3.1 3.1H6.2l3.1-3.1z" />
      <path d="M12 11.8V20.5" />
      <path d="M4 4l16 16" />
    </>,
  ),

  /* ---- 其它 ---- */
  'chevron-down': svg(<path d="M6 9.5 12 15.5 18 9.5" />),
  'chevron-up': svg(<path d="M6 14.5 12 8.5 18 14.5" />),
  'chevron-left': svg(<path d="M14.5 6 8.5 12l6 6" />),
  'chevron-right': svg(<path d="M9.5 6 15.5 12l-6 6" />),
  more: svg(
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>,
  ),
  refresh: svg(
    <>
      <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5" />
      <path d="M4 12.5a8 8 0 0 0 13.7 5.2L20 15.5" />
      <path d="M4 4.5v4h4M20 19.5v-4h-4" />
    </>,
  ),
  expand: svg(
    <path d="M9 4.5H4.5V9M15 19.5h4.5V15M15 4.5h4.5V9M9 19.5H4.5V15" />,
  ),
  'arrow-down': svg(<path d="M12 4.5v15M6 13.5l6 6 6-6" />),
  'arrow-up': svg(<path d="M12 19.5v-15M6 10.5l6-6 6 6" />),
  sort: svg(
    <path d="M7 5v14M3.5 15 7 18.5 10.5 15M17 19V5M13.5 9 17 5.5 20.5 9" />,
  ),
  mic: svg(
    <>
      <rect x="9" y="3" width="6" height="10.5" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>,
  ),
  disc: svg(
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="2.4" />
    </>,
  ),
  headphones: svg(
    <>
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="2.8" y="13.5" width="4" height="6.5" rx="1.8" />
      <rect x="17.2" y="13.5" width="4" height="6.5" rx="1.8" />
    </>,
  ),
  external: svg(
    <>
      <path d="M13.5 4.5h6v6" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5v4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.5V7.6A1.6 1.6 0 0 1 5.6 6h4" />
    </>,
  ),
  info: svg(
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5.5M12 7.8v.4" />
    </>,
  ),
  image: svg(
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.4" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l4.5-4 3.5 3 3-2.5L20 17.5" />
    </>,
  ),
  sun: svg(
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </>,
  ),
  moon: svg(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />),
  wave: svg(
    <>
      <path d="M3 12h2.5M8 6.5v11M12 8.5v7M16 4.5v15M20.5 10v4" />
    </>,
  ),
  quality: svg(
    <>
      <path d="M4 15.5V8.8M8 15.5v-4M12 15.5V6.5M16 15.5v-3M20 15.5v-6" />
      <path d="M3 19.5h18" />
    </>,
  ),
  loading: svg(<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />),
}

export type IconName = keyof typeof ICONS | string

export interface IconProps {
  name: IconName
  /** 数字为像素，字符串可用百分比（跟随父容器） */
  size?: number | string
  className?: string
  style?: CSSProperties
  /** 线宽微调，小尺寸时更清晰 */
  strokeWidth?: number
}

export function Icon({
  name,
  size = 18,
  className,
  style,
  strokeWidth,
}: IconProps): ReactNode {
  const content = ICONS[name] ?? ICONS.info
  const isSpinner = name === 'loading'
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={[isSpinner ? 'spin' : '', className].filter(Boolean).join(' ')}
      style={{ flexShrink: 0, display: 'block', ...style }}
      strokeWidth={strokeWidth}
      aria-hidden
    >
      {content}
    </svg>
  )
}

export const ICON_NAMES = Object.keys(ICONS)
