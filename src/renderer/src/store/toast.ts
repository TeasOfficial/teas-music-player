import { create } from 'zustand'
import type { ToastPayload } from '@shared/ipc'

interface ToastItem extends ToastPayload {
  id: number
  /** 正在播退场动画，播完才真正从列表移除 */
  leaving?: boolean
}

interface ToastState {
  items: ToastItem[]
  push: (payload: ToastPayload) => void
  dismiss: (id: number) => void
}

/** 同时最多显示几条，超出后丢弃最旧的 */
const MAX_VISIBLE = 3

let seed = 0
const timers = new Map<number, number>()

/** 退场动画时长，需与 CSS 里的 .toast-leaving 保持一致 */
const LEAVE_MS = 200

function markLeaving(id: number): void {
  useToastStore.setState((state) => ({
    items: state.items.map((item) =>
      item.id === id ? { ...item, leaving: true } : item,
    ),
  }))
}

function remove(id: number): void {
  useToastStore.setState((state) => ({
    items: state.items.filter((item) => item.id !== id),
  }))
}

function scheduleDismiss(id: number, duration: number): void {
  const existing = timers.get(id)
  if (existing !== undefined) window.clearTimeout(existing)
  timers.set(
    id,
    window.setTimeout(() => {
      // 先标记退场，等动画播完再移除，否则 toast 会「啪」地消失
      markLeaving(id)
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id)
          remove(id)
        }, LEAVE_MS),
      )
    }, duration),
  )
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],

  push: (payload) => {
    const duration = payload.type === 'error' ? 5200 : 3200
    const { items } = useToastStore.getState()

    // 同一条消息重复出现时（例如连续几首歌因同一原因失败）只给它续命，
    // 不再叠一层——否则一次批量失败会糊满整个窗口。
    const duplicate = items.find(
      (item) => item.type === payload.type && item.message === payload.message,
    )
    if (duplicate) {
      scheduleDismiss(duplicate.id, duration)
      return
    }

    seed += 1
    const item: ToastItem = { ...payload, id: seed }
    set({ items: [...items, item].slice(-MAX_VISIBLE) })
    scheduleDismiss(item.id, duration)
  },

  dismiss: (id) => {
    const timer = timers.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.delete(id)
    }
    markLeaving(id)
    window.setTimeout(() => remove(id), LEAVE_MS)
  },
}))

/** 命令式调用，非组件代码（store / 事件回调）里也能弹提示 */
export const toast = {
  info: (message: string): void =>
    useToastStore.getState().push({ type: 'info', message }),
  success: (message: string): void =>
    useToastStore.getState().push({ type: 'success', message }),
  error: (message: string): void =>
    useToastStore.getState().push({ type: 'error', message }),
  /** 把异常转成提示 */
  fromError: (error: unknown, fallback = '操作失败'): void => {
    const message =
      error instanceof Error && error.message ? error.message : fallback
    useToastStore.getState().push({ type: 'error', message })
  },
}
