import { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { IPC_EVENT } from '@shared/ipc'
import type { PlayerSyncPayload, Settings } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import './styles/global.css'
import './styles/lyric.css'

/**
 * 桌面歌词窗口：透明置顶的小窗口，只显示当前/下一句歌词。
 * 播放状态由主窗口通过主进程转发过来，这里不参与播放逻辑。
 */
function DesktopLyric(): ReactNode {
  const [payload, setPayload] = useState<PlayerSyncPayload | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hover, setHover] = useState(false)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    void window.ncm.config.all().then((value) => {
      setSettings(value)
      setLocked(value.lyricLocked)
    })

    const offSync = window.ncm.on<PlayerSyncPayload>(
      IPC_EVENT.PlayerSync,
      setPayload,
    )
    const offConfig = window.ncm.on<Settings>(
      IPC_EVENT.ConfigChanged,
      setSettings,
    )
    const offState = window.ncm.on<{ lyricLocked: boolean }>(
      IPC_EVENT.WinState,
      (state) => setLocked(!!state?.lyricLocked),
    )

    return () => {
      offSync()
      offConfig()
      offState()
    }
  }, [])

  const fontSize = settings?.lyricFontSize ?? 28
  const opacity = settings?.lyricOpacity ?? 0.9
  const showTranslation = settings?.showTranslation ?? true

  const updateSetting = (key: keyof Settings, value: unknown): void => {
    setSettings((previous) =>
      previous ? { ...previous, [key]: value } : previous,
    )
    void window.ncm.config.set(key, value as never)
  }

  const empty = !payload || (!payload.current && !payload.songName)

  return (
    <div
      className="lyric-window"
      style={{ opacity }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="lyric-window-glow" />
      <div className="lyric-window-body drag">
        {empty ? (
          <div className="lyric-window-empty">Teas Music Player · 桌面歌词</div>
        ) : (
          <>
            <div className="lyric-window-current" style={{ fontSize }}>
              {payload?.current || payload?.songName || '—'}
            </div>
            {showTranslation && payload?.currentTrans && (
              <div
                className="lyric-window-trans"
                style={{ fontSize: Math.round(fontSize * 0.6) }}
              >
                {payload.currentTrans}
              </div>
            )}
            {payload?.next && (
              <div
                className="lyric-window-next"
                style={{ fontSize: Math.round(fontSize * 0.5) }}
              >
                {payload.next}
              </div>
            )}
          </>
        )}
      </div>

      {hover && !locked && (
        <div className="lyric-controls no-drag">
          <button
            type="button"
            className="lyric-ctl"
            title="减小字号"
            onClick={() =>
              updateSetting('lyricFontSize', Math.max(16, fontSize - 2))
            }
          >
            <Icon name="minus" size={14} />
          </button>
          <button
            type="button"
            className="lyric-ctl"
            title="增大字号"
            onClick={() =>
              updateSetting('lyricFontSize', Math.min(64, fontSize + 2))
            }
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            type="button"
            className="lyric-ctl"
            title={showTranslation ? '隐藏翻译' : '显示翻译'}
            onClick={() => updateSetting('showTranslation', !showTranslation)}
          >
            <Icon name="comment" size={14} />
          </button>
          <button
            type="button"
            className="lyric-ctl"
            title="降低透明度"
            onClick={() =>
              updateSetting('lyricOpacity', Math.max(0.25, opacity - 0.1))
            }
          >
            <Icon name="moon" size={14} />
          </button>
          <button
            type="button"
            className="lyric-ctl"
            title="提高透明度"
            onClick={() =>
              updateSetting('lyricOpacity', Math.min(1, opacity + 0.1))
            }
          >
            <Icon name="sun" size={14} />
          </button>
          <button
            type="button"
            className={locked ? 'lyric-ctl lyric-ctl-active' : 'lyric-ctl'}
            title={locked ? '解锁（可拖动/交互）' : '锁定（鼠标穿透）'}
            onClick={() => {
              const next = !locked
              setLocked(next)
              void window.ncm.win.setLyricLock(next)
            }}
          >
            <Icon name={locked ? 'pin' : 'pin-off'} size={14} />
          </button>
          <button
            type="button"
            className="lyric-ctl"
            title="关闭桌面歌词"
            onClick={() => {
              void window.ncm.win.setLyric(false)
              void window.ncm.config.set('desktopLyric', false)
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

const container = document.getElementById('root')
if (container) createRoot(container).render(<DesktopLyric />)
