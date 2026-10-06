import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useAppNavigate } from '@/lib/navigation'
import type { Playlist, Song, UserProfile } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import {
  Badge,
  Cover,
  DetailSkeleton,
  Empty,
  Loading,
  Tabs,
} from '@/components/ui/Primitives'
import { GridContainer, MiniCard, PlaylistCard } from '@/components/cards'
import { SongTable } from '@/components/song/SongTable'
import { api, apiCached } from '@/lib/api'
import { normalizeSongs } from '@/lib/normalize'
import { useAsync, usePaged } from '@/lib/hooks'
import { formatCount, imageUrl } from '@/lib/format'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'
import './UserDetail.css'

const LIST_PAGE_SIZE = 30

/* ------------------------------------------------------------------ */
/* 响应形状兜底                                                        */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function pickArray<T>(body: unknown, ...keys: string[]): T[] {
  const root = asRecord(body)
  if (!root) return []
  const data = asRecord(root.data)
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as T[]
    if (Array.isArray(data?.[key])) return data[key] as T[]
  }
  return []
}

/** 关注/粉丝接口不返回总数，按整页判断是否还有下一页 */
function toUserPage<T>(
  items: T[],
  offset: number,
  pageSize: number,
): { items: T[]; total: number } {
  const full = items.length >= pageSize
  return { items, total: offset + items.length + (full ? pageSize : 0) }
}

/** user_record 的 allData / weekData 都按「最近在听」处理，取更长的那个 */
function pickRecords(body: unknown): Array<{ song: Song; playCount: number }> {
  const root = asRecord(body) ?? {}
  const list = [root.allData, root.weekData]
    .map((value) => (Array.isArray(value) ? value : []))
    .reduce<unknown[]>(
      (longest, current) =>
        current.length > longest.length ? current : longest,
      [],
    )
  return list
    .map((item) => {
      const record = asRecord(item)
      const song = asRecord(record?.song) ?? record
      if (!song || typeof song.id !== 'number') return null
      return {
        song: song as unknown as Song,
        playCount: record?.playCount as number,
      }
    })
    .filter((item): item is { song: Song; playCount: number } => item !== null)
}

interface SubCount {
  createdPlaylistCount?: number
  subPlaylistCount?: number
  artistCount?: number
  djRadioCount?: number
}

interface UserDetailBody {
  level?: number
  listenSongs?: number
  createDays?: number
  profile?: UserProfile
}

interface UserLevelBody {
  data?: { level?: number; listenSongs?: number; now?: number }
  level?: number
  listenSongs?: number
}

interface FollowUser {
  userId: number
  nickname: string
  avatarUrl?: string
  signature?: string
}

type TabKey = 'created' | 'collected' | 'follows' | 'followeds' | 'record'

/* ------------------------------------------------------------------ */

export default function UserDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const navigate = useAppNavigate()
  const uid = Number(id)

  const myId = useAuthStore((state) => state.profile?.userId ?? 0)
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const isSelf = uid > 0 && uid === myId

  const [tab, setTab] = useState<TabKey>('created')

  /* ---------------- 用户详情 ---------------- */

  const {
    data: detail,
    loading,
    error,
    reload,
  } = useAsync<UserDetailBody | null>(async () => {
    if (!Number.isFinite(uid)) throw new Error('用户 ID 不合法')
    const body = await apiCached<UserDetailBody>('user_detail', { uid }, 60_000)
    if (!body?.profile?.userId) throw new Error('用户不存在或已注销')
    return body
  }, [uid])

  useEffect(() => {
    if (error) toast.fromError(error, '用户信息加载失败')
  }, [error])

  // user_level 只对当前登录用户有效，他人主页用 user_detail 自带的 level
  const { data: level } = useAsync<UserLevelBody | null>(async () => {
    if (!isSelf) return null
    return apiCached<UserLevelBody>('user_level', {}, 120_000).catch(() => null)
  }, [isSelf])

  /* ---------------- 歌单 ---------------- */

  const { data: playlists, loading: playlistsLoading } = useAsync<
    Playlist[]
  >(async () => {
    const body = await apiCached<{ playlist?: Playlist[] }>(
      'user_playlist',
      { uid, limit: 100, offset: 0 },
      60_000,
    )
    return body.playlist ?? []
  }, [uid])

  const { data: subCount } = useAsync<SubCount | null>(async () => {
    if (!isSelf) return null
    const body = await apiCached<{ subCount?: SubCount }>(
      'user_subcount',
      {},
      120_000,
    )
    return body.subCount ?? null
  }, [isSelf])

  const allPlaylists = playlists ?? []
  const createdPlaylists = allPlaylists.filter(
    (item) => item.userId === uid && item.specialType !== 5,
  )
  const collectedPlaylists = allPlaylists.filter(
    (item) => item.userId !== uid || item.specialType === 5,
  )

  /* ---------------- 关注 / 粉丝 ---------------- */

  const follows = usePaged<FollowUser>(
    async (offset) => {
      const body = await api<unknown>('user_follows', {
        uid,
        limit: LIST_PAGE_SIZE,
        offset,
      })
      return toUserPage(
        pickArray<FollowUser>(body, 'follow'),
        offset,
        LIST_PAGE_SIZE,
      )
    },
    [uid],
    LIST_PAGE_SIZE,
  )

  const followeds = usePaged<FollowUser>(
    async (offset) => {
      const body = await api<unknown>('user_followeds', {
        uid,
        limit: LIST_PAGE_SIZE,
        offset,
      })
      return toUserPage(
        pickArray<FollowUser>(body, 'followeds'),
        offset,
        LIST_PAGE_SIZE,
      )
    },
    [uid],
    LIST_PAGE_SIZE,
  )

  useEffect(() => {
    if (follows.error) toast.fromError(follows.error, '关注列表加载失败')
  }, [follows.error])

  useEffect(() => {
    if (followeds.error) toast.fromError(followeds.error, '粉丝列表加载失败')
  }, [followeds.error])

  /* ---------------- 最近听歌（仅自己） ---------------- */

  const { data: records, loading: recordsLoading } = useAsync<
    Array<{ song: Song; playCount: number }>
  >(async () => {
    if (!isSelf) return []
    const body = await api<unknown>('user_record', { uid, type: 1 })
    return pickRecords(body)
  }, [isSelf, uid])

  if (loading) return <DetailSkeleton rows={6} />

  if (error || !detail?.profile) {
    return (
      <div className="page">
        <Empty
          icon="user"
          title={error?.message || '用户不存在'}
          description="请检查链接是否正确，或返回上一页"
          action={
            <div className="row gap-8">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/discover')}
              >
                返回发现页
              </button>
              <button type="button" className="btn" onClick={reload}>
                重试
              </button>
            </div>
          }
        />
      </div>
    )
  }

  const profile = detail.profile
  const avatar = imageUrl(profile.avatarUrl, 400)
  const levelValue =
    detail.level ?? level?.data?.level ?? level?.level ?? profile.level
  const listenSongs =
    detail.listenSongs ?? level?.data?.listenSongs ?? level?.listenSongs

  const tabs: Array<{ value: TabKey; label: ReactNode }> = [
    { value: 'created', label: `创建的歌单 ${createdPlaylists.length}` },
    { value: 'collected', label: `收藏的歌单 ${collectedPlaylists.length}` },
    { value: 'follows', label: '关注' },
    { value: 'followeds', label: '粉丝' },
  ]
  if (isSelf) tabs.push({ value: 'record', label: '最近听歌' })

  return (
    <div className="page">
      <div className="user-hero">
        <Cover src={avatar} size={120} round className="user-avatar" />
        <div className="user-intro">
          <div className="row gap-8">
            <span className="user-name">{profile.nickname}</span>
            {levelValue ? <Badge tone="accent">Lv.{levelValue}</Badge> : null}
            {isSelf && <Badge>我自己</Badge>}
          </div>

          <div className="detail-meta">
            <span>ID：{profile.userId}</span>
            {typeof listenSongs === 'number' && listenSongs > 0 && (
              <span>累计听歌 {formatCount(listenSongs)} 首</span>
            )}
            {detail.createDays ? (
              <span>云村 {detail.createDays} 天</span>
            ) : null}
          </div>

          <div
            className={
              profile.signature ? 'user-signature' : 'user-signature muted'
            }
          >
            {profile.signature || '这个人很懒，什么都没写~'}
          </div>

          <div className="stat-row user-stats">
            <span className="stat-item" onClick={() => setTab('follows')}>
              <span className="stat-value">{formatCount(profile.follows)}</span>
              <span className="stat-label">关注</span>
            </span>
            <span className="stat-item" onClick={() => setTab('followeds')}>
              <span className="stat-value">
                {formatCount(profile.followeds)}
              </span>
              <span className="stat-label">粉丝</span>
            </span>
            <span className="stat-item" onClick={() => setTab('created')}>
              <span className="stat-value">
                {profile.playlistCount ??
                  subCount?.createdPlaylistCount ??
                  createdPlaylists.length}
              </span>
              <span className="stat-label">歌单</span>
            </span>
          </div>
        </div>
      </div>

      <Tabs<TabKey>
        className="user-tabs"
        items={tabs}
        value={tab}
        onChange={(value) => setTab(value)}
      />

      {tab === 'created' && (
        <PlaylistGrid
          loading={playlistsLoading}
          playlists={createdPlaylists}
          emptyTitle="还没有创建歌单"
          emptyDesc={isSelf ? '在左侧「我创建的歌单」里可以新建' : undefined}
        />
      )}

      {tab === 'collected' && (
        <PlaylistGrid
          loading={playlistsLoading}
          playlists={collectedPlaylists}
          emptyTitle="还没有收藏歌单"
        />
      )}

      {tab === 'follows' && (
        <UserList
          loggedIn={loggedIn}
          loading={follows.loading}
          loadingMore={follows.loadingMore}
          users={follows.items}
          hasMore={follows.hasMore}
          emptyTitle="还没有关注任何人"
          onLoadMore={follows.loadMore}
        />
      )}

      {tab === 'followeds' && (
        <UserList
          loggedIn={loggedIn}
          loading={followeds.loading}
          loadingMore={followeds.loadingMore}
          users={followeds.items}
          hasMore={followeds.hasMore}
          emptyTitle="还没有粉丝"
          onLoadMore={followeds.loadMore}
        />
      )}

      {tab === 'record' && (
        <>
          {recordsLoading ? (
            <Loading minHeight={220} label="正在加载最近听歌记录…" />
          ) : (records ?? []).length === 0 ? (
            <Empty
              icon="clock"
              title="最近没有听歌记录"
              description="播放过的歌曲会出现在这里（需要保持登录）"
            />
          ) : (
            <SongTable
              songs={normalizeSongs(
                (records ?? []).map((item) => item.song ?? item),
              )}
              context={{
                type: 'single',
                id: uid,
                name: `${profile.nickname} 的最近听歌`,
              }}
              showAlbum={false}
              // 双击播放由 SongTable 处理，单击把播放次数提示给用户
              onRowClick={(_, index) => {
                const count = records?.[index]?.playCount
                toast.info(count ? `播放 ${count} 次` : '暂无播放次数')
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function PlaylistGrid({
  loading,
  playlists,
  emptyTitle,
  emptyDesc,
}: {
  loading: boolean
  playlists: Playlist[]
  emptyTitle: string
  emptyDesc?: string
}): ReactNode {
  if (loading) return <Loading minHeight={240} label="正在加载歌单…" />
  if (playlists.length === 0) {
    return (
      <Empty
        icon="folder"
        title={emptyTitle}
        description={emptyDesc}
        minHeight={220}
      />
    )
  }
  return (
    <GridContainer>
      {playlists.map((playlist) => (
        <PlaylistCard
          key={playlist.id}
          playlist={playlist}
          subtitle={playlist.specialType === 5 ? '我喜欢的音乐' : undefined}
        />
      ))}
    </GridContainer>
  )
}

function UserList({
  loggedIn,
  loading,
  loadingMore,
  users,
  hasMore,
  emptyTitle,
  onLoadMore,
}: {
  loggedIn: boolean
  loading: boolean
  loadingMore: boolean
  users: FollowUser[]
  hasMore: boolean
  emptyTitle: string
  onLoadMore: () => void
}): ReactNode {
  // 关注/粉丝接口需要登录态，未登录时直接给出提示而不是空列表
  if (!loggedIn) {
    return (
      <Empty
        icon="user"
        title="登录后才能查看关注与粉丝"
        description="登录后即可浏览用户关系列表"
        minHeight={220}
      />
    )
  }
  if (loading) return <Loading minHeight={240} label="正在加载用户列表…" />
  if (users.length === 0)
    return <Empty icon="users" title={emptyTitle} minHeight={220} />
  return (
    <>
      <GridContainer className="user-list">
        {users.map((user) => (
          <MiniCard
            key={user.userId}
            round
            cover={imageUrl(user.avatarUrl, 300)}
            title={user.nickname}
            subtitle={user.signature || '这个人很懒，什么都没写~'}
            to={`/user/${user.userId}`}
          />
        ))}
      </GridContainer>
      {hasMore && (
        <div className="row user-more">
          <button
            type="button"
            className="btn"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </>
  )
}
