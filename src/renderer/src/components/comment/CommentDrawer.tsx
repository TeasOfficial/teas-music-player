import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from '@/components/ui/Icon'
import { Empty } from '@/components/ui/Primitives'
import { CommentSection } from './CommentSection'
import { usePlayerStore } from '@/store/player'

function artistsOf(song: { ar?: { name: string }[] } | null): string {
  if (!song?.ar?.length) return ''
  return song.ar.map((item) => item.name).join(' / ')
}

/**
 * 歌曲评论抽屉。
 *
 * 全应用原本只有歌单/专辑/MV/电台有评论入口，歌曲评论（comment_music）虽已支持
 * 却从未接出来 —— 这里补上，并且可以从播放条、歌曲右键菜单、全屏播放页三处打开。
 * 和播放队列占同一个位置，因此两者互斥（见 store 的 openComments / setShowQueue）。
 */
export function CommentDrawer(): ReactNode {
  const target = usePlayerStore((state) => state.commentTarget)
  const closeComments = usePlayerStore((state) => state.closeComments)
  const open = !!target

  return (
    <aside className={clsx('comment-drawer', open && 'comment-drawer-open')}>
      <div className="queue-head">
        <div className="col" style={{ minWidth: 0 }}>
          <span className="f-14 bold ellipsis">
            {target?.name ?? '歌曲评论'}
          </span>
          <span className="f-12 muted ellipsis">{artistsOf(target)}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="关闭"
          onClick={closeComments}
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="comment-drawer-body scroll-y">
        {target && target.source === 'local' ? (
          <Empty icon="comment" title="本地歌曲没有评论" minHeight={160} />
        ) : target ? (
          // key 保证换歌时重新拉取，而不是复用上一首的评论列表
          <CommentSection
            key={target.id}
            type={0}
            id={target.id}
            title="歌曲评论"
            compact
          />
        ) : null}
      </div>
    </aside>
  )
}
