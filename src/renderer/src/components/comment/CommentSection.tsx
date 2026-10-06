import { useCallback, useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useAppNavigate } from '@/lib/navigation'
import type { Comment } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Cover, Empty, Loading } from '@/components/ui/Primitives'
import { Tabs } from '@/components/ui/Primitives'
import { api, invalidateCache } from '@/lib/api'
import { imageUrl, formatRelativeTime } from '@/lib/format'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'

export type CommentResourceType = 0 | 1 | 2 | 3 | 4 | 5

const FETCH_MODULE: Record<CommentResourceType, string> = {
  0: 'comment_music',
  1: 'comment_mv',
  2: 'comment_playlist',
  3: 'comment_album',
  4: 'comment_dj',
  5: 'comment_video',
}

const PAGE_SIZE = 20

interface CommentResponse {
  total?: number
  more?: boolean
  hotComments?: Comment[]
  comments?: Comment[]
}

export interface CommentSectionProps {
  type: CommentResourceType
  id: number
  title?: string
  /** 嵌入歌单/MV 详情时不需要额外外边距 */
  compact?: boolean
}

export function CommentSection({
  type,
  id,
  title = '评论',
  compact = false,
}: CommentSectionProps): ReactNode {
  const navigate = useAppNavigate()
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const profile = useAuthStore((state) => state.profile)
  const [tab, setTab] = useState<'hot' | 'all'>('hot')
  const [hot, setHot] = useState<Comment[]>([])
  const [list, setList] = useState<Comment[]>([])
  const [total, setTotal] = useState(0)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [sending, setSending] = useState(false)

  const load = useCallback(
    async (offset: number, replace: boolean): Promise<void> => {
      if (replace) setLoading(true)
      else setLoadingMore(true)
      try {
        const body = await api<CommentResponse>(FETCH_MODULE[type], {
          id,
          limit: PAGE_SIZE,
          offset,
        })
        setTotal(body.total ?? 0)
        setMore(!!body.more)
        if (replace) {
          setHot(body.hotComments ?? [])
          setList(body.comments ?? [])
        } else {
          setList((previous) => [...previous, ...(body.comments ?? [])])
        }
      } catch (error) {
        if (replace) {
          setHot([])
          setList([])
        }
        toast.fromError(error, '评论加载失败')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [type, id],
  )

  useEffect(() => {
    setTab('hot')
    setReplyTo(null)
    setDraft('')
    void load(0, true)
  }, [load])

  const submit = async (): Promise<void> => {
    if (!loggedIn) {
      toast.info('请先登录后再评论')
      navigate('/login')
      return
    }
    const content = draft.trim()
    if (!content) return
    setSending(true)
    try {
      await api('comment_add', {
        t: replyTo ? 2 : 1,
        type,
        id,
        content,
        commentId: replyTo?.commentId,
      })
      toast.success('评论已发布')
      setDraft('')
      setReplyTo(null)
      invalidateCache(FETCH_MODULE[type])
      await load(0, true)
    } catch (error) {
      toast.fromError(error, '评论发布失败')
    } finally {
      setSending(false)
    }
  }

  const like = async (comment: Comment): Promise<void> => {
    if (!loggedIn) {
      toast.info('请先登录后再点赞')
      return
    }
    const liked = !!comment.liked
    const patch = (items: Comment[]): Comment[] =>
      items.map((item) =>
        item.commentId === comment.commentId
          ? {
              ...item,
              liked: !liked,
              likedCount: item.likedCount + (liked ? -1 : 1),
            }
          : item,
      )
    setHot(patch)
    setList(patch)
    try {
      await api('comment_like', {
        type,
        id,
        cid: comment.commentId,
        t: liked ? 0 : 1,
      })
    } catch (error) {
      setHot((items) =>
        items.map((item) =>
          item.commentId === comment.commentId ? comment : item,
        ),
      )
      setList((items) =>
        items.map((item) =>
          item.commentId === comment.commentId ? comment : item,
        ),
      )
      toast.fromError(error, '点赞失败')
    }
  }

  const shown = tab === 'hot' ? hot : list

  return (
    <section
      className={clsx('comment-section', compact && 'comment-section-compact')}
    >
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <span className="f-16">
          {title}{' '}
          <span className="muted f-12">{total > 0 ? `${total} 条` : ''}</span>
        </span>
        <Tabs
          items={[
            { value: 'hot', label: '推荐' },
            { value: 'all', label: '最新' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as 'hot' | 'all')}
        />
      </div>

      <div className="comment-editor">
        <Cover src={imageUrl(profile?.avatarUrl, 80)} size={40} round />
        <div className="comment-input-wrap">
          <textarea
            className="comment-input"
            value={draft}
            placeholder={
              replyTo
                ? `回复 @${replyTo.user?.nickname ?? ''}：`
                : '说点什么吧…'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter')
                void submit()
            }}
          />
          <div className="comment-editor-actions">
            {replyTo && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setReplyTo(null)}
              >
                取消回复
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={sending || !draft.trim()}
              onClick={() => void submit()}
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <Loading minHeight={140} label="正在加载评论…" />
      ) : shown.length === 0 ? (
        <Empty
          icon="comment"
          title="还没有评论"
          description="来抢沙发吧"
          minHeight={140}
        />
      ) : (
        <>
          {shown.map((comment) => (
            <CommentItem
              key={comment.commentId}
              comment={comment}
              onLike={() => void like(comment)}
              onReply={() => {
                setReplyTo(comment)
                document
                  .querySelector<HTMLTextAreaElement>('.comment-input')
                  ?.focus()
              }}
            />
          ))}

          {tab === 'all' && more && (
            <div
              className="row"
              style={{ justifyContent: 'center', padding: '16px 0' }}
            >
              <button
                type="button"
                className="btn"
                disabled={loadingMore}
                onClick={() => void load(list.length, false)}
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function CommentItem({
  comment,
  onLike,
  onReply,
}: {
  comment: Comment
  onLike: () => void
  onReply: () => void
}): ReactNode {
  const navigate = useAppNavigate()
  const reply = comment.beReplied?.[0]

  return (
    <div className="comment-item">
      <Cover
        src={imageUrl(comment.user?.avatarUrl, 100)}
        size={40}
        round
        className="clickable"
        alt={comment.user?.nickname}
      />
      <div className="comment-main">
        <div className="comment-head">
          <span
            className="comment-nickname clickable"
            onClick={() =>
              comment.user?.userId && navigate(`/user/${comment.user.userId}`)
            }
          >
            {comment.user?.nickname ?? '匿名用户'}
          </span>
          <span className="muted f-11">{formatRelativeTime(comment.time)}</span>
          {comment.ipLocation?.location && (
            <span className="muted f-11">{comment.ipLocation.location}</span>
          )}
        </div>

        <div className="comment-content">{comment.content}</div>

        {reply && (
          <div className="comment-reply">
            <span className="comment-nickname">
              {reply.user?.nickname ?? ''}：
            </span>
            {reply.content}
          </div>
        )}

        <div className="comment-actions">
          <span
            className={clsx(
              'comment-action',
              comment.liked && 'comment-action-active',
            )}
            onClick={onLike}
          >
            <Icon name={comment.liked ? 'heart-filled' : 'heart'} size={14} />
            {comment.likedCount > 0 ? comment.likedCount : ''}
          </span>
          <span className="comment-action" onClick={onReply}>
            <Icon name="comment" size={13} /> 回复
          </span>
          {comment.repliedCount ? (
            <span className="muted f-11">{comment.repliedCount} 条回复</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
