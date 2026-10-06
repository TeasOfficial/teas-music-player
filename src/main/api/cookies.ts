/**
 * Cookie 罐：把 API 返回的 Set-Cookie 累积成一条 cookie 字符串，
 * 后续每次调用都带上，从而实现“登录一次，全局生效”。
 */
export class CookieJar {
  private map = new Map<string, string>()

  constructor(initial?: string) {
    if (initial) this.merge(initial)
  }

  /** 合并 `k=v; k2=v2` 形式的 cookie 字符串 */
  merge(raw: string): void {
    if (!raw) return
    for (const pair of raw.split(';')) {
      const idx = pair.indexOf('=')
      if (idx <= 0) continue
      const key = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (key) this.map.set(key, value)
    }
  }

  /**
   * 处理 API 层返回的 `cookie` 字段。
   * 既可能是 string[]（axios Set-Cookie 数组），也可能是单个字符串。
   */
  applySetCookie(input: unknown): boolean {
    const before = this.map.size + this.toString()
    if (typeof input === 'string') {
      this.merge(input)
    } else if (Array.isArray(input)) {
      for (const item of input) {
        if (typeof item !== 'string') continue
        // 只取 `name=value`，丢弃 Path/Expires/HttpOnly 等属性
        const firstSegment = item.split(';')[0]
        this.merge(firstSegment)
      }
    }
    return before !== this.map.size + this.toString()
  }

  get(key: string): string | undefined {
    return this.map.get(key)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }

  /** 是否持有登录态（网易云用 MUSIC_U 标识登录用户） */
  get loggedIn(): boolean {
    return this.map.has('MUSIC_U')
  }

  toString(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  /** 用于界面展示的脱敏摘要 */
  masked(): string {
    const keys = [...this.map.keys()]
    const musicU = this.map.get('MUSIC_U')
    return [
      musicU
        ? `MUSIC_U=${musicU.slice(0, 4)}***${musicU.slice(-4)}`
        : 'MUSIC_U=-',
      `${keys.length} 项`,
    ].join(' · ')
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.map)
  }
}
