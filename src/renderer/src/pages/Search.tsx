import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import type {
  Album,
  Artist,
  DjRadio,
  Mv,
  Playlist,
  SearchResult,
  Song,
  UserProfile,
} from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Cover, Empty, Loading, Tabs } from '@/components/ui/Primitives'
import {
  AlbumCard,
  ArtistCard,
  GridContainer,
  MvCard,
  PlaylistCard,
  RadioCard,
} from '@/components/cards'
import { SongTable } from '@/components/song/SongTable'
import {
  SEARCH_TYPES,
  DEFAULT_SEARCH_TYPE,
  type SearchType,
} from '@/lib/constants'
import { api } from '@/lib/api'
import { formatCount, imageUrl } from '@/lib/format'
import { useAuthStore } from '@/store/auth'

const PAGE_SIZE = 30

interface HotWord {
  first: string
  second?: string
  iconType?: number
}

export default function Search(): ReactNode {
  const navigate = useAppNavigate()
  const [params, setParams] = useSearchParams()
  const loggedIn = useAuthStore((state) => state.loggedIn)

  const keyword = params.get('q') ?? ''
  const rawType = Number(params.get('type') ?? DEFAULT_SEARCH_TYPE)
  const type = (
    SEARCH_TYPES.some((item) => item.value === rawType)
      ? rawType
      : DEFAULT_SEARCH_TYPE
  ) as SearchType

  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hotWords, setHotWords] = useState<HotWord[]>([])

  /* 热搜词（无关键词时展示） */
  useEffect(() => {
    if (keyword) return
    api<{ result?: { hots?: HotWord[] } }>('search_hot', {})
      .then((body) => setHotWords(body.result?.hots ?? []))
      .catch(() => setHotWords([]))
  }, [keyword])

  /* 搜索结果 */
  useEffect(() => {
    if (!keyword.trim()) {
      setResult(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')

    api<{ result?: SearchResult; code?: number }>('cloudsearch', {
      keywords: keyword,
      type,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((body) => {
        if (cancelled) return
        setResult(body.result ?? {})
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResult(null)
        setError(err instanceof Error ? err.message : '搜索失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [keyword, type])

  const changeType = (next: SearchType): void => {
    const nextParams = new URLSearchParams(params)
    nextParams.set('type', String(next))
    setParams(nextParams, { replace: true })
  }

  const total = useMemo(() => {
    if (!result) return 0
    switch (type) {
      case 1:
        return result.songCount ?? 0
      case 1000:
        return result.playlistCount ?? 0
      case 100:
        return result.artistCount ?? 0
      case 10:
        return result.albumCount ?? 0
      case 1004:
        return result.mvCount ?? 0
      case 1009:
        return result.djRadiosCount ?? 0
      case 1002:
        return result.userprofileCount ?? 0
      default:
        return 0
    }
  }, [result, type])

  /* ---------------- 无关键词：热搜 ---------------- */
  if (!keyword.trim()) {
    return (
      <div className="page">
        <h1 className="f-20" style={{ marginBottom: 16 }}>
          热门搜索
        </h1>
        {hotWords.length === 0 ? (
          <Empty
            icon="search"
            title="输入关键词开始搜索"
            description="支持歌曲、歌手、专辑、歌单、视频、播客、用户"
          />
        ) : (
          <div className="filter-row">
            {hotWords.map((word, index) => (
              <button
                type="button"
                key={`${word.first}-${index}`}
                className="chip"
                onClick={() => setParams({ q: word.first, type: String(type) })}
              >
                {index < 3 && <span className="hot-rank">{index + 1}</span>}
                {word.first}
                {word.second && (
                  <span className="muted f-11"> · {word.second}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  /* ---------------- 有关键词 ---------------- */
  return (
    <div className="page">
      <div className="search-head">
        <h1 className="f-20 ellipsis" title={keyword}>
          “{keyword}”
        </h1>
        {!loading && !error && (
          <span className="muted f-12">共 {formatCount(total)} 条结果</span>
        )}
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs
          items={SEARCH_TYPES.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          value={type}
          onChange={(value) => changeType(value as SearchType)}
        />
      </div>

      {loading ? (
        <Loading minHeight={320} label="正在搜索…" />
      ) : error ? (
        <Empty
          icon="info"
          title={error}
          description="请检查网络后重试，或更换关键词"
        />
      ) : (
        <SearchResults
          type={type}
          result={result}
          keyword={keyword}
          loggedIn={loggedIn}
          onOpenPlaylist={(id) => navigate(`/playlist/${id}`)}
        />
      )}
    </div>
  )
}

function SearchResults({
  type,
  result,
  keyword,
  loggedIn,
  onOpenPlaylist,
}: {
  type: SearchType
  result: SearchResult | null
  keyword: string
  loggedIn: boolean
  onOpenPlaylist: (id: number) => void
}): ReactNode {
  const navigate = useAppNavigate()
  if (!result) return <Empty icon="search" title="没有找到相关内容" />

  switch (type) {
    case 1: {
      const songs = (result.songs ?? []) as Song[]
      if (songs.length === 0)
        return <Empty icon="music" title="没有找到相关歌曲" />
      return (
        <SongTable
          songs={songs}
          keyword={keyword}
          context={{ type: 'search', name: `搜索：${keyword}` }}
          showAlbum
        />
      )
    }

    case 1000: {
      const playlists = (result.playlists ?? []) as Playlist[]
      if (playlists.length === 0)
        return <Empty icon="disc" title="没有找到相关歌单" />
      return (
        <GridContainer>
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              onPlay={() => onOpenPlaylist(playlist.id)}
            />
          ))}
        </GridContainer>
      )
    }

    case 100: {
      const artists = (result.artists ?? []) as Artist[]
      if (artists.length === 0)
        return <Empty icon="user" title="没有找到相关歌手" />
      return (
        <GridContainer>
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </GridContainer>
      )
    }

    case 10: {
      const albums = (result.albums ?? []) as Album[]
      if (albums.length === 0)
        return <Empty icon="disc" title="没有找到相关专辑" />
      return (
        <GridContainer>
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </GridContainer>
      )
    }

    case 1004: {
      const mvs = (result.mvs ?? []) as Mv[]
      if (mvs.length === 0)
        return <Empty icon="video" title="没有找到相关视频" />
      return (
        <GridContainer>
          {mvs.map((mv) => (
            <MvCard key={mv.id} mv={mv} />
          ))}
        </GridContainer>
      )
    }

    case 1009: {
      const radios = (result.djRadios ?? []) as DjRadio[]
      if (radios.length === 0)
        return <Empty icon="radio" title="没有找到相关播客" />
      return (
        <GridContainer>
          {radios.map((radio) => (
            <RadioCard key={radio.id} radio={radio} />
          ))}
        </GridContainer>
      )
    }

    case 1002: {
      const users = (result.userprofiles ?? []) as UserProfile[]
      if (users.length === 0)
        return <Empty icon="user" title="没有找到相关用户" />
      return (
        <div className="user-result-list">
          {users.map((user) => (
            <div
              key={user.userId}
              className="user-result hoverable"
              onClick={() => navigate(`/user/${user.userId}`)}
            >
              <Cover src={imageUrl(user.avatarUrl, 120)} size={48} round />
              <div className="col" style={{ minWidth: 0, flex: 1, gap: 3 }}>
                <span className="ellipsis f-14">{user.nickname}</span>
                <span className="ellipsis muted f-12">
                  {user.signature || `粉丝 ${formatCount(user.followeds)}`}
                </span>
              </div>
              <Icon name="chevron-right" size={16} />
            </div>
          ))}
          {!loggedIn && (
            <div className="muted f-12" style={{ padding: '10px 0' }}>
              登录后可以关注用户并查看其动态
            </div>
          )}
        </div>
      )
    }

    default:
      return <Empty icon="search" title="暂不支持该搜索类型" />
  }
}
