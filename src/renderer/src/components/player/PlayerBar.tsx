import { useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { useAppNavigate } from '@/lib/navigation'
import { Icon } from '@/components/ui/Icon'
import { Cover } from '@/components/ui/Primitives'
import { openContextMenu, openMenuAtElement } from '@/components/ui/ContextMenu'
import { ProgressBar, VolumeControl } from './ProgressBar'
import { buildSongMenu } from '@/components/song/songActions'
import {
  PLAY_MODE_LABEL,
  PLAY_MODE_OPTIONS,
  QUALITY_OPTIONS,
} from '@/lib/constants'
import { imageUrl } from '@/lib/format'
import { usePlayerStore, selectCurrentSong } from '@/store/player'
import { useSettingsStore } from '@/store/settings'
import { useAuthStore } from '@/store/auth'

/** 底部播放条 */
export function PlayerBar(): ReactNode {
  const navigate = useAppNavigate()
  const song = usePlayerStore(selectCurrentSong)
  const playing = usePlayerStore((state) => state.playing)
  const status = usePlayerStore((state) => state.status)
  const playMode = usePlayerStore((state) => state.playMode)
  const level = usePlayerStore((state) => state.level)
  const likedIds = usePlayerStore((state) => state.likedIds)
  const toggle = usePlayerStore((state) => state.toggle)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const setPlayMode = usePlayerStore((state) => state.setPlayMode)
  const setLevel = usePlayerStore((state) => state.setLevel)
  const toggleLike = usePlayerStore((state) => state.toggleLike)
  const setShowNowPlaying = usePlayerStore((state) => state.setShowNowPlaying)
  const setShowQueue = usePlayerStore((state) => state.setShowQueue)
  const commentOpen = usePlayerStore((state) => !!state.commentTarget)
  const openCommentsInline = usePlayerStore((state) => state.openCommentsInline)
  const showQueue = usePlayerStore((state) => state.showQueue)
  const desktopLyric = useSettingsStore((state) => state.settings.desktopLyric)
  const updateSetting = useSettingsStore((state) => state.update)
  const loggedIn = useAuthStore((state) => state.loggedIn)

  const modeRef = useRef<HTMLButtonElement>(null)
  const qualityRef = useRef<HTMLButtonElement>(null)

  const liked = !!song && likedIds.includes(song.id)
  const modeOption =
    PLAY_MODE_OPTIONS.find((item) => item.value === playMode) ??
    PLAY_MODE_OPTIONS[0]
  const qualityLabel =
    QUALITY_OPTIONS.find((item) => item.value === level)?.label ?? '音质'

  const openModeMenu = (): void => {
    openMenuAtElement(
      modeRef.current,
      PLAY_MODE_OPTIONS.map((option) => ({
        key: option.value,
        label: option.label,
        icon: option.icon,
        checked: option.value === playMode,
        onClick: () => setPlayMode(option.value),
      })),
      'top',
    )
  }

  const openQualityMenu = (): void => {
    openMenuAtElement(
      qualityRef.current,
      QUALITY_OPTIONS.map((option) => ({
        key: option.value,
        label: `${option.label} · ${option.desc}`,
        checked: option.value === level,
        onClick: () => void setLevel(option.value),
      })),
      'top',
    )
  }

  const toggleDesktopLyric = (): void => {
    void window.ncm.win.setLyric(!desktopLyric)
    void updateSetting('desktopLyric', !desktopLyric)
  }

  return (
    <footer className="player-bar">
      {/* 左：当前歌曲 */}
      <div className="player-song">
        {song ? (
          <>
            <Cover
              // key 让封面在换歌时重新挂载，从而播一次进场动画（图片本身不会自发淡入）
              key={song.id}
              src={imageUrl(song.al?.picUrl, 120)}
              size={56}
              radius={8}
              className="player-cover clickable"
              onPlay={() => setShowNowPlaying(true)}
            />
            <div className="player-song-info">
              <div className="row gap-6">
                <span
                  className="player-song-name ellipsis clickable"
                  title={song.name}
                  onClick={() => setShowNowPlaying(true)}
                >
                  {song.name}
                </span>
                {loggedIn && song.source !== 'local' && (
                  <button
                    type="button"
                    className={clsx('icon-btn', liked && 'song-like-active')}
                    title={liked ? '取消喜欢' : '喜欢'}
                    onClick={() => void toggleLike(song)}
                  >
                    <Icon name={liked ? 'heart-filled' : 'heart'} size={15} />
                  </button>
                )}
              </div>
              <div className="player-song-artist ellipsis">
                {(song.ar ?? []).map((artist, index) => (
                  <span key={`${artist.id}-${index}`}>
                    {index > 0 && <span className="muted"> / </span>}
                    {artist.id ? (
                      <span
                        className="link"
                        onClick={() => navigate(`/artist/${artist.id}`)}
                      >
                        {artist.name}
                      </span>
                    ) : (
                      <span>{artist.name}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="player-song-empty muted">未在播放</div>
        )}
      </div>

      {/* 中：控制 + 进度 */}
      <div className="player-center">
        <div className="player-controls">
          <button
            type="button"
            ref={modeRef}
            className="icon-btn"
            data-tip={`播放模式：${PLAY_MODE_LABEL[playMode]}`}
            aria-label={`播放模式：${PLAY_MODE_LABEL[playMode]}`}
            onClick={openModeMenu}
          >
            <Icon name={modeOption.icon} size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="上一首"
            aria-label="上一首"
            onClick={() => void prev()}
          >
            <Icon name="prev" size={20} />
          </button>
          <button
            type="button"
            className="play-btn"
            data-tip={playing ? '暂停' : '播放'}
            aria-label={playing ? '暂停' : '播放'}
            onClick={toggle}
            disabled={!song}
          >
            {status === 'loading' ? (
              <Icon name="loading" size={20} className="spin" />
            ) : (
              <Icon name={playing ? 'pause' : 'play'} size={22} />
            )}
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="下一首"
            aria-label="下一首"
            onClick={() => void next(false)}
          >
            <Icon name="next" size={20} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="最近播放"
            aria-label="最近播放"
            onClick={() => navigate('/recent')}
          >
            <Icon name="clock" size={18} />
          </button>
        </div>
        <ProgressBar />
      </div>

      {/* 右：音质 / 歌词 / 队列 / 音量 */}
      <div className="player-extra">
        <button
          type="button"
          ref={qualityRef}
          className="text-btn player-quality"
          onClick={openQualityMenu}
        >
          {qualityLabel}
        </button>
        <button
          type="button"
          className={clsx('icon-btn', desktopLyric && 'icon-btn-active')}
          data-tip={desktopLyric ? '关闭桌面歌词' : '打开桌面歌词'}
          aria-label={desktopLyric ? '关闭桌面歌词' : '打开桌面歌词'}
          onClick={toggleDesktopLyric}
        >
          <Icon name="mic" size={17} />
        </button>
        <button
          type="button"
          className={clsx('icon-btn', commentOpen && 'icon-btn-active')}
          data-tip="歌曲评论"
          aria-label="歌曲评论"
          disabled={!song}
          onClick={() => song && openCommentsInline()}
        >
          <Icon name="comment" size={18} />
        </button>
        <button
          type="button"
          className={clsx('icon-btn', showQueue && 'icon-btn-active')}
          data-tip="播放队列"
          aria-label="播放队列"
          onClick={() => setShowQueue(!showQueue)}
        >
          <Icon name="list" size={18} />
        </button>
        {song && (
          <button
            type="button"
            className="icon-btn"
            data-tip="更多操作"
            aria-label="更多操作"
            onClick={(event) =>
              openContextMenu(
                event,
                buildSongMenu({
                  song,
                  navigate: (path) => navigate(path),
                }),
              )
            }
          >
            <Icon name="more" size={18} />
          </button>
        )}
        <VolumeControl />
      </div>
    </footer>
  )
}
