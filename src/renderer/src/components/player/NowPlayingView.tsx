import { useEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { useAppNavigate } from '@/lib/navigation'
import { Icon } from '@/components/ui/Icon'
import { Cover, Empty } from '@/components/ui/Primitives'
import { openContextMenu, openMenuAtElement } from '@/components/ui/ContextMenu'
import { ProgressBar, VolumeControl } from './ProgressBar'
import { LyricScroller } from './LyricScroller'
import { buildSongMenu } from '@/components/song/songActions'
import {
  PLAY_MODE_LABEL,
  PLAY_MODE_OPTIONS,
  QUALITY_OPTIONS,
} from '@/lib/constants'
import { artistNames, imageUrl } from '@/lib/format'
import { usePlayerStore, selectCurrentSong } from '@/store/player'
import { CommentSection } from '@/components/comment/CommentSection'
import { useAuthStore } from '@/store/auth'
import { useSettingsStore } from '@/store/settings'

/** 全屏「正在播放」页：左封面 + 右歌词 */
export function NowPlayingView(): ReactNode {
  const navigate = useAppNavigate()
  const open = usePlayerStore((state) => state.showNowPlaying)
  const song = usePlayerStore(selectCurrentSong)
  const playing = usePlayerStore((state) => state.playing)
  const status = usePlayerStore((state) => state.status)
  const playMode = usePlayerStore((state) => state.playMode)
  const likedIds = usePlayerStore((state) => state.likedIds)
  const toggle = usePlayerStore((state) => state.toggle)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const setPlayMode = usePlayerStore((state) => state.setPlayMode)
  const toggleLike = usePlayerStore((state) => state.toggleLike)
  const setShowNowPlaying = usePlayerStore((state) => state.setShowNowPlaying)
  const setShowQueue = usePlayerStore((state) => state.setShowQueue)
  const consumeCommentScroll = usePlayerStore(
    (state) => state.consumeCommentScroll,
  )
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const commentsRef = useRef<HTMLDivElement | null>(null)
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const modeRef = useRef<HTMLButtonElement>(null)
  const qualityRef = useRef<HTMLButtonElement>(null)

  // 关闭时不卸载（同上），因此需要记住最后一首歌，退场期间内容才不会变空
  const lastSong = useRef(song)
  if (song) lastSong.current = song
  const shown = song ?? lastSong.current
  if (!shown) return null

  const liked = likedIds.includes(shown.id)
  const modeOption =
    PLAY_MODE_OPTIONS.find((item) => item.value === playMode) ??
    PLAY_MODE_OPTIONS[0]
  const level = usePlayerStore((state) => state.level)
  const setLevel = usePlayerStore((state) => state.setLevel)
  const qualityLabel =
    QUALITY_OPTIONS.find((item) => item.value === level)?.label ?? '音质'
  const desktopLyric = useSettingsStore((state) => state.settings.desktopLyric)
  const updateSetting = useSettingsStore((state) => state.update)
  const cover = imageUrl(shown.al?.picUrl, 600)

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

  // 从评论按钮进来时把外层容器滚到评论区（歌词自身不参与）。
  // 必须重试：评论是异步加载的，刚挂载时内容还没长出来，scrollHeight 等于视口高度，
  // 这时候 scrollTo 会被钳制成 0，等评论渲染完也不会自己补滚。
  useEffect(() => {
    if (!open) return
    if (!consumeCommentScroll()) return

    let raf = 0
    const started = performance.now()
    const tick = (): void => {
      const body = bodyRef.current
      const comments = commentsRef.current
      if (!body || !comments) return
      const target = Math.max(0, comments.offsetTop - 12)
      body.scrollTop = target
      const notThere = Math.abs(body.scrollTop - target) > 4
      if (notThere && performance.now() - started < 2000) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, consumeCommentScroll])

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
    <div className={clsx('now-playing', open && 'now-playing-open')}>
      <div
        className="now-playing-bg"
        style={cover ? { backgroundImage: `url(${cover})` } : undefined}
      />
      <div className="now-playing-mask" />

      <button
        type="button"
        className="icon-btn now-playing-close"
        data-tip="收起"

        aria-label="收起"
        onClick={() => setShowNowPlaying(false)}
      >
        <Icon name="chevron-down" size={22} />
      </button>

      <div className="now-playing-body" ref={bodyRef}>
        <div className="now-playing-stage">
          {/* 左：封面 + 信息 */}
          <div className="now-playing-left">
            <div
              className={clsx(
                'now-playing-disc',
                playing && 'now-playing-disc-spin',
              )}
            >
              <Cover src={cover} size={340} round />
            </div>

            <div className="now-playing-meta">
              <h2 className="now-playing-title ellipsis" title={shown.name}>
                {shown.name}
              </h2>
              <div className="now-playing-artists">
                {(shown.ar ?? []).map((artist, index) => (
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
                {!shown.ar?.length && (
                  <span className="muted">{artistNames(shown.ar)}</span>
                )}
              </div>
              {shown.al?.name && (
                <div className="now-playing-album muted f-12">
                  专辑：
                  {shown.al.id ? (
                    <span
                      className="link"
                      onClick={() => navigate(`/album/${shown.al?.id}`)}
                    >
                      {shown.al.name}
                    </span>
                  ) : (
                    shown.al.name
                  )}
                </div>
              )}
            </div>

            <div className="now-playing-actions">
              {loggedIn && shown.source !== 'local' && (
                <button
                  type="button"
                  className={clsx('icon-btn', liked && 'song-like-active')}
                  data-tip={liked ? '取消喜欢' : '喜欢'}

                  aria-label={liked ? '取消喜欢' : '喜欢'}
                  onClick={() => void toggleLike(shown)}
                >
                  <Icon name={liked ? 'heart-filled' : 'heart'} size={20} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                data-tip="更多操作"

                aria-label="更多操作"
                onClick={(event) =>
                  openContextMenu(
                    event,
                    buildSongMenu({
                      song: shown,
                      navigate: (path) => navigate(path),
                    }),
                  )
                }
              >
                <Icon name="more" size={20} />
              </button>
              <button
                type="button"
                className="icon-btn"
                data-tip="歌曲评论"

                aria-label="歌曲评论"
                onClick={() => {
                  // 评论在封面那一列的下方，滚外层容器（歌词自己滚自己的）
                  const body = bodyRef.current
                  const comments = commentsRef.current
                  if (body && comments) {
                    body.scrollTo({
                      top: Math.max(0, comments.offsetTop - 12),
                      behavior: 'smooth',
                    })
                  }
                }}
              >
                <Icon name="comment" size={20} />
              </button>
              <button
                type="button"
                className="icon-btn"
                data-tip="播放队列"

                aria-label="播放队列"
                onClick={() => setShowQueue(true)}
              >
                <Icon name="list" size={20} />
              </button>
            </div>
          </div>

          {/* 右：歌词自己滚动 */}
          <div className="now-playing-right">
            <LyricScroller className="now-playing-lyric" />
          </div>
        </div>

        {/* 评论区在封面那一列的下方，属于外层滚动。
            滚轮在歌词区域滚的是歌词，滚轮在封面/空白处才是滚到这里（对齐官方客户端） */}
        <div className="now-playing-comments" ref={commentsRef}>
          {shown.source === 'local' ? (
            <Empty icon="comment" title="本地歌曲没有评论" minHeight={120} />
          ) : (
            <CommentSection
              key={shown.id}
              type={0}
              id={shown.id}
              title="全部评论"
              compact
            />
          )}
        </div>
      </div>

      {/* 底部控制 */}
      <div className="now-playing-controls">
        <div className="row gap-8">
          <button
            type="button"
            ref={modeRef}
            className="icon-btn"
            data-tip={`播放模式：${PLAY_MODE_LABEL[playMode]}`}

            aria-label={PLAY_MODE_LABEL[playMode]}
            onClick={openModeMenu}
          >
            <Icon name={modeOption.icon} size={19} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="上一首"

            aria-label="上一首"
            onClick={() => void prev()}
          >
            <Icon name="prev" size={22} />
          </button>
          <button
            type="button"
            className="play-btn play-btn-large"
            data-tip={playing ? '暂停' : '播放'}

            aria-label={playing ? '暂停' : '播放'}
            onClick={toggle}
          >
            {status === 'loading' ? (
              <Icon name="loading" size={24} className="spin" />
            ) : (
              <Icon name={playing ? 'pause' : 'play'} size={26} />
            )}
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="下一首"

            aria-label="下一首"
            onClick={() => void next(false)}
          >
            <Icon name="next" size={22} />
          </button>
        </div>

        <div className="now-playing-progress">
          <ProgressBar />
        </div>

        {/* 实用工具组：让底部这条 dock 填满，也省得回播放条上找 */}
        <div className="row gap-8">
          <button
            type="button"
            ref={qualityRef}
            className="player-quality"
            data-tip="播放音质"

            aria-label="播放音质"
            onClick={openQualityMenu}
          >
            {qualityLabel}
          </button>
          <button
            type="button"
            className={desktopLyric ? 'icon-btn icon-btn-active' : 'icon-btn'}
            data-tip={desktopLyric ? '关闭桌面歌词' : '打开桌面歌词'}

            aria-label={desktopLyric ? '关闭桌面歌词' : '打开桌面歌词'}
            onClick={toggleDesktopLyric}
          >
            <Icon name="mic" size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="播放队列"

            aria-label="播放队列"
            onClick={() => {
              setShowNowPlaying(false)
              setShowQueue(true)
            }}
          >
            <Icon name="list" size={19} />
          </button>
          <VolumeControl />
        </div>
      </div>
    </div>
  )
}
