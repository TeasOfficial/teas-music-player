import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

/** 是否允许播放动效（尊重系统的「减少动态效果」） */
export function motionEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 带页面过渡的导航。
 *
 * 用 Chromium 的 View Transitions：切换瞬间浏览器会为「内容区」拍下前后两张快照
 * 并做交叉淡入，标题栏/侧边栏/播放条不在快照里，所以它们保持不动——
 * 观感上是「内容换了」而不是「整页闪了一下」。
 *
 * flushSync 是必须的：React 的更新默认是批量异步的，不用它的话浏览器会在
 * React 提交之前就拍下「新」快照，结果两张快照一模一样，过渡等于没做。
 * 外面再等一帧，确保新内容已经完成布局。
 */
/** 兼容 navigate(-1) / navigate(1) 这种历史前进后退写法 */
export function useAppNavigate(): (
  to: To | number,
  options?: NavigateOptions,
) => void {
  const navigate = useNavigate()

  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      const doc = document as ViewTransitionDocument
      if (!doc.startViewTransition || !motionEnabled()) {
        navigate(to as To, options)
        return
      }

      // 过渡期间给 <html> 打个标记：此时内容区由浏览器快照接管，
      // 页面自身的进场动画要关掉，否则会和快照叠加成「淡入两次」
      document.documentElement.dataset.vt = '1'

      // 回调必须是同步的：过渡期间浏览器会暂停渲染，
      // 在回调里 await requestAnimationFrame 会永远等不到回调，
      // 最终以 "Transition was aborted because of timeout in DOM update" 报错收场。
      // flushSync 已经保证 React 在这次同步执行内完成提交，浏览器随后才拍「新」快照。
      const transition = doc.startViewTransition(() => {
        flushSync(() => {
          navigate(to as To, options)
        })
      })

      // 过渡可能因为超时、窗口被遮挡（Electron 会把 occluded 窗口标记为 hidden，
      // Chromium 随即跳过过渡）或用户连续操作而中止。
      // ready 与 finished 都要吞掉拒绝，否则控制台会刷 Uncaught (in promise)。
      void transition.ready.catch(() => undefined)
      void transition.finished
        .catch(() => undefined)
        .finally(() => {
          delete document.documentElement.dataset.vt
        })
    },
    [navigate],
  )
}
