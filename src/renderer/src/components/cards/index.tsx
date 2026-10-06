import type { ReactNode } from 'react'
import clsx from 'clsx'
import { useAppNavigate } from '@/lib/navigation'
import type { Album, Artist, DjRadio, Mv, Playlist } from '@shared/types'
import { Cover } from '@/components/ui/Primitives'
import { Icon } from '@/components/ui/Icon'
import { formatCount, imageUrl } from '@/lib/format'

export function GridContainer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return <div className={clsx('grid-cards', className)}>{children}</div>
}

function CardShell({
  to,
  children,
  className,
  onDoubleClick,
}: {
  to?: string
  children: ReactNode
  className?: string
  onDoubleClick?: () => void
}): ReactNode {
  const navigate = useAppNavigate()
  return (
    <div
      className={clsx('grid-card', className)}
      onClick={() => to && navigate(to)}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  )
}

function PlayCount({ count }: { count?: number }): ReactNode {
  if (!count) return null
  return (
    <span className="play-count">
      <Icon name="headphones" size={12} />
      {formatCount(count)}
    </span>
  )
}

/* ------------------------------------------------------------------ */

export function PlaylistCard({
  playlist,
  onPlay,
  subtitle,
}: {
  playlist: Playlist
  onPlay?: () => void
  subtitle?: ReactNode
}): ReactNode {
  return (
    <CardShell
      to={`/playlist/${playlist.id}`}
      onDoubleClick={onPlay}
      className="grid-card-playlist"
    >
      <Cover
        src={imageUrl(playlist.coverImgUrl ?? playlist.picUrl, 400)}
        size="100%"
        radius={12}
        onPlay={onPlay}
        badge={<PlayCount count={playlist.playCount} />}
      />
      <div className="grid-card-title clamp-2">{playlist.name}</div>
      <div className="grid-card-sub ellipsis muted f-12">
        {subtitle ??
          (playlist.creator?.nickname ? `by ${playlist.creator.nickname}` : '')}
      </div>
    </CardShell>
  )
}

export function AlbumCard({
  album,
  onPlay,
}: {
  album: Album
  onPlay?: () => void
}): ReactNode {
  const artist = album.artists?.[0] ?? album.artist
  return (
    <CardShell to={`/album/${album.id}`} onDoubleClick={onPlay}>
      <Cover
        src={imageUrl(album.picUrl ?? album.coverImgUrl, 400)}
        size="100%"
        radius={12}
        onPlay={onPlay}
      />
      <div className="grid-card-title clamp-2">{album.name}</div>
      <div className="grid-card-sub ellipsis muted f-12">
        {artist?.name ?? ''}
      </div>
    </CardShell>
  )
}

export function ArtistCard({
  artist,
  onPlay,
}: {
  artist: Artist
  onPlay?: () => void
}): ReactNode {
  return (
    <CardShell to={`/artist/${artist.id}`} onDoubleClick={onPlay}>
      <Cover
        src={imageUrl(artist.picUrl ?? artist.img1v1Url, 400)}
        size="100%"
        round
        onPlay={onPlay}
      />
      <div className="grid-card-title ellipsis">{artist.name}</div>
      <div className="grid-card-sub ellipsis muted f-12">
        {artist.alias?.[0] ??
          (artist.albumSize ? `${artist.albumSize} 张专辑` : '')}
      </div>
    </CardShell>
  )
}

export function MvCard({
  mv,
  onPlay,
}: {
  mv: Mv
  onPlay?: () => void
}): ReactNode {
  return (
    <CardShell to={`/mv/${mv.id}`} onDoubleClick={onPlay}>
      <Cover
        src={imageUrl(mv.cover ?? mv.picUrl, 400)}
        size="100%"
        radius={12}
        onPlay={onPlay}
        badge={<PlayCount count={mv.playCount} />}
      />
      <div className="grid-card-title clamp-2">{mv.name}</div>
      <div className="grid-card-sub ellipsis muted f-12">
        {mv.artistName ?? ''}
      </div>
    </CardShell>
  )
}

export function RadioCard({ radio }: { radio: DjRadio }): ReactNode {
  return (
    <CardShell to={`/podcast/${radio.id}`}>
      <Cover
        src={imageUrl(radio.picUrl, 400)}
        size="100%"
        radius={12}
        badge={<PlayCount count={radio.playCount} />}
      />
      <div className="grid-card-title clamp-2">{radio.name}</div>
      <div className="grid-card-sub ellipsis muted f-12">
        {radio.dj?.nickname ?? radio.category ?? ''}
      </div>
    </CardShell>
  )
}

/** 通用小卡片（用于歌手简介、MV 列表等自定义布局） */
export function MiniCard({
  cover,
  title,
  subtitle,
  to,
  round,
  badge,
  onPlay,
}: {
  cover?: string
  title: ReactNode
  subtitle?: ReactNode
  to?: string
  round?: boolean
  badge?: ReactNode
  onPlay?: () => void
}): ReactNode {
  return (
    <CardShell to={to} onDoubleClick={onPlay}>
      <Cover
        src={cover}
        size="100%"
        radius={12}
        round={round}
        badge={badge}
        onPlay={onPlay}
      />
      <div className="grid-card-title clamp-2">{title}</div>
      <div className="grid-card-sub ellipsis muted f-12">{subtitle}</div>
    </CardShell>
  )
}
