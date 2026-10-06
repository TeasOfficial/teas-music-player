import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * 极简日志：控制台 + 落盘（userData/logs/main.log，超过 2MB 自动轮转一次）。
 * 主进程里没有渲染层的 console，排查问题必须靠文件。
 */
const MAX_LOG_SIZE = 2 * 1024 * 1024

let logFile: string | null = null

function ensureLogFile(): string | null {
  if (logFile) return logFile
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'main.log')
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_SIZE) {
      fs.renameSync(file, path.join(dir, 'main.prev.log'))
    }
    logFile = file
    return logFile
  } catch {
    return null
  }
}

function write(level: string, args: unknown[]): void {
  const time = new Date().toISOString()
  const text = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      }
      return String(a)
    })
    .join(' ')
  const line = `[${time}] [${level}] ${text}`

  if (level === 'ERROR') console.error(line)
  else console.log(line)

  const file = ensureLogFile()
  if (file) {
    try {
      fs.appendFileSync(file, line + '\n', 'utf-8')
    } catch {
      /* 日志写入失败不应影响主流程 */
    }
  }
}

export const logger = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
  debug: (...args: unknown[]) => {
    if (process.env.NCM_DEBUG) write('DEBUG', args)
  },
}
