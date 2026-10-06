import { useCallback, useEffect, useRef, useState } from 'react'

/** 异步数据加载：自动处理 loading / error / 竞态 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: { immediate?: boolean; initial?: T } = {},
): {
  data: T | undefined
  loading: boolean
  error: Error | null
  reload: () => void
  setData: (value: T) => void
} {
  const { immediate = true, initial } = options
  const [data, setData] = useState<T | undefined>(initial)
  const [loading, setLoading] = useState(immediate)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)
  const runIdRef = useRef(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    if (!immediate && tick === 0) return
    const runId = ++runIdRef.current
    setLoading(true)
    setError(null)

    loaderRef
      .current()
      .then((result) => {
        if (runId !== runIdRef.current) return
        setData(result)
      })
      .catch((err: unknown) => {
        if (runId !== runIdRef.current) return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (runId !== runIdRef.current) return
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  return { data, loading, error, reload, setData }
}

/** 分页加载：滚动到底部时调用 loadMore */
export function usePaged<T>(
  loader: (offset: number) => Promise<{ items: T[]; total: number }>,
  deps: unknown[],
  pageSize = 30,
): {
  items: T[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => void
  reset: () => void
} {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const offsetRef = useRef(0)
  const runIdRef = useRef(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const load = useCallback(
    async (reset: boolean) => {
      const runId = reset ? ++runIdRef.current : runIdRef.current
      if (reset) {
        offsetRef.current = 0
        setItems([])
        setLoading(true)
      } else {
        setLoadingMore(true)
      }
      setError(null)
      try {
        const offset = reset ? 0 : offsetRef.current
        const result = await loaderRef.current(offset)
        if (runId !== runIdRef.current) return
        offsetRef.current = offset + pageSize
        setItems((prev) => (reset ? result.items : [...prev, ...result.items]))
        setTotal(result.total)
      } catch (err) {
        if (runId !== runIdRef.current) return
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (runId === runIdRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [pageSize],
  )

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const loadMore = useCallback(() => {
    if (loading || loadingMore) return
    void load(false)
  }, [load, loading, loadingMore])

  const reset = useCallback(() => void load(true), [load])

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore: items.length < total,
    loadMore,
    reset,
  }
}

/** setInterval 的 React 封装（delay 为 null 时暂停） */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedRef = useRef(callback)
  savedRef.current = callback

  useEffect(() => {
    if (delay === null) return
    const id = window.setInterval(() => savedRef.current(), delay)
    return () => window.clearInterval(id)
  }, [delay])
}

/** 防抖值 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

/** 元素尺寸监听 */
export function useElementSize<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  { width: number; height: number },
] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}

/** 滚动容器触底检测 */
export function useReachBottom(
  ref: React.RefObject<HTMLElement | null>,
  onReach: () => void,
  enabled = true,
  threshold = 240,
): void {
  const onReachRef = useRef(onReach)
  onReachRef.current = onReach

  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    const handler = (): void => {
      const remain =
        element.scrollHeight - element.scrollTop - element.clientHeight
      if (remain < threshold) onReachRef.current()
    }
    element.addEventListener('scroll', handler, { passive: true })
    return () => element.removeEventListener('scroll', handler)
  }, [ref, enabled, threshold])
}

/** 点击元素外部时触发 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    const listener = (event: MouseEvent): void => {
      const element = ref.current
      if (!element) return
      if (!element.contains(event.target as Node)) handlerRef.current()
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, enabled])
}

/** 组件是否已挂载（避免卸载后 setState） */
export function useMountedRef(): React.RefObject<boolean> {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}
