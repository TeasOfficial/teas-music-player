import type { Song, SoundLevel } from '@shared/types'
import { QUALITY_OPTIONS } from '@/lib/constants'
import { usePlayerStore } from '@/store/player'
import { useDownloadStore } from '@/store/download'
import { useAuthStore, requireLogin } from '@/store/auth'
import { toast } from '@/store/toast'
import { invalidateCache } from '@/lib/api'
import type { MenuItem } from '@/components/ui/ContextMenu'

export interface SongMenuOptions {
  song: Song
  /** 覆盖默认的“播放”行为（例如在歌单里播放整个列表） */
  onPlay?: () => void
  /** 队列场景：从播放列表移除 */
  onRemove?: () => void
  removeLabel?: string
  /** 路由跳转（由调用方注入，避免在非组件模块里直接依赖 router） */
  navigate?: (path: string) => void
  /** 是否允许下载（本地音乐不提供） */
  downloadable?: boolean
}

function songLink(song: Song): string {
  return `https://music.163.com/#/song?id=${song.id}`
}

/** 构造歌曲右键菜单（列表、播放条、歌词页共用一套） */
export function buildSongMenu(options: SongMenuOptions): MenuItem[] {
  const {
    song,
    onPlay,
    onRemove,
    removeLabel = '从播放列表移除',
    navigate,
    downloadable = true,
  } = options
  const player = usePlayerStore.getState()
  const downloads = useDownloadStore.getState()
  const loggedIn = useAuthStore.getState().loggedIn
  const isLocal = song.source === 'local'
  const liked = player.isLiked(song.id)

  const items: MenuItem[] = [
    {
      key: 'play',
      label: '立即播放',
      icon: 'play',
      onClick: () => {
        if (onPlay) onPlay()
        else void player.playSong(song)
      },
    },
    {
      key: 'next-up',
      label: '下一首播放',
      icon: 'play-next',
      onClick: () => player.playNextUp(song),
    },
    {
      key: 'add-queue',
      label: '添加到播放列表',
      icon: 'add-list',
      onClick: () => player.addToQueue([song]),
    },
  ]

  if (downloadable && !isLocal) {
    items.push({
      key: 'download',
      label: '下载',
      icon: 'download',
      children: [
        {
          key: 'download-current',
          label: '当前音质',
          onClick: () => void downloads.start(song),
        },
        ...QUALITY_OPTIONS.slice(0, 5).map((option) => ({
          key: `download-${option.value}`,
          label: `${option.label}（${option.desc}）`,
          onClick: () => void downloads.start(song, option.value as SoundLevel),
          checked: false,
        })),
      ],
    })
  }

  if (!isLocal) {
    // 歌曲评论（comment_music）原本没有任何入口，这里补一个
    items.push({
      key: 'comments',
      label: '查看评论',
      icon: 'comment',
      onClick: () => player.openComments(song),
    })
    items.push({
      key: 'like',
      label: liked ? '取消喜欢' : '喜欢',
      icon: liked ? 'heart-filled' : 'heart',
      checked: liked,
      onClick: () => {
        if (!requireLogin()) return
        void player.toggleLike(song)
      },
    })
  }

  const extra: MenuItem[] = []

  if (!isLocal && song.ar?.[0]?.id && navigate) {
    extra.push({
      key: 'goto-artist',
      label: `查看歌手：${song.ar[0].name}`,
      icon: 'user',
      onClick: () => navigate(`/artist/${song.ar?.[0]?.id}`),
    })
  }

  const album = song.al
  if (!isLocal && album?.id && navigate) {
    extra.push({
      key: 'goto-album',
      label: `查看专辑：${album.name}`,
      icon: 'disc',
      onClick: () => navigate(`/album/${album.id}`),
    })
  }

  if (extra.length > 0) {
    items.push({ key: 'divider-1', divider: true }, ...extra)
  }

  const tail: MenuItem[] = []

  if (!isLocal) {
    tail.push({
      key: 'copy-link',
      label: '复制歌曲链接',
      icon: 'share',
      onClick: () => {
        void navigator.clipboard
          .writeText(songLink(song))
          .then(() => toast.success('链接已复制'))
          .catch(() => toast.error('复制失败'))
      },
    })
  }

  if (isLocal && song.localPath) {
    tail.push({
      key: 'reveal-file',
      label: '在文件夹中显示',
      icon: 'folder-open',
      onClick: () => {
        void window.ncm.app.openPath(song.localPath as string)
      },
    })
  }

  if (onRemove) {
    tail.push({
      key: 'remove',
      label: removeLabel,
      icon: 'trash',
      danger: true,
      onClick: onRemove,
    })
  }

  if (tail.length > 0) {
    items.push({ key: 'divider-2', divider: true }, ...tail)
  }

  if (!loggedIn && !isLocal) {
    items.push({
      key: 'divider-3',
      divider: true,
    })
    items.push({
      key: 'login-hint',
      label: '未登录，部分功能受限',
      icon: 'info',
      disabled: true,
    })
  }

  return items
}

/** 批量操作：把多首歌加入播放列表 / 下载 */
export function batchActions(songs: Song[]): MenuItem[] {
  const player = usePlayerStore.getState()
  const downloads = useDownloadStore.getState()
  return [
    {
      key: 'batch-play',
      label: `播放全部（${songs.length}）`,
      icon: 'play',
      onClick: () =>
        void player.playSongs(songs, 0, { type: 'single', name: '批量播放' }),
    },
    {
      key: 'batch-queue',
      label: `添加到播放列表（${songs.length}）`,
      icon: 'add-list',
      onClick: () => player.addToQueue(songs),
    },
    {
      key: 'batch-download',
      label: `下载全部（${songs.length}）`,
      icon: 'download',
      onClick: () => void downloads.startBatch(songs),
    },
  ]
}

/** 收藏成功后清掉可能过期的缓存，供页面刷新列表 */
export function invalidateLikeCaches(): void {
  invalidateCache('likelist')
}
