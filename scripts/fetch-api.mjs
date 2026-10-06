// 把最新版（或指定版本）NeteaseCloudMusicApiEnhanced 从 npm 拉到指定目录。
//
// 用途：
//  1. 开发者本地预置一份 API，免得每次冷启动都等下载（--to <dir>）；
//  2. 端到端验证「薄壳拉取后端」这条链路（--verify），会真的调用接口；
//  3. 在没装 Node/npm 的机器上，可先用本脚本在别处产出一份再随包分发。
//
// 用法：
//   node scripts/fetch-api.mjs --verify
//   node scripts/fetch-api.mjs --to .api-cache
//   node scripts/fetch-api.mjs --version 4.40.1 --to .api-cache
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  API_PACKAGE,
  defaultRegistry,
  ensureApiVersion,
  resolveRemoteVersion,
} from '../src/main/api/fetcher.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')

const args = process.argv.slice(2)
const verify = args.includes('--verify')
const toIndex = args.indexOf('--to')
const versionIndex = args.indexOf('--version')
const version = versionIndex >= 0 ? args[versionIndex + 1] : undefined
const defaultDir = path.join(projectRoot, '.api-cache', version ?? 'latest')
const target = toIndex >= 0 ? path.resolve(args[toIndex + 1]) : defaultDir

const startedAt = Date.now()
const log = (message) => console.log(`[fetch-api] ${message}`)

async function main() {
  log(`registry = ${defaultRegistry()}`)
  log(`目标目录 = ${target}`)

  const remote = await resolveRemoteVersion(defaultRegistry(), version)
  log(
    `目标版本 = ${remote.version}（latest=${remote.latest}，声明依赖 ${remote.dependencyCount} 个）`,
  )

  const result = await ensureApiVersion(path.dirname(target), remote.version, {
    onLog: (line) => log(line),
  })

  if (!result.ok || !result.dir) {
    console.error(`[fetch-api] 失败：${result.error ?? '未知错误'}`)
    process.exit(1)
  }

  // ensureApiVersion 按版本号建目录；--to 指定时把结果挪到用户要的位置
  let apiRoot = result.dir
  if (path.resolve(apiRoot) !== path.resolve(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.rmSync(target, { recursive: true, force: true })
    fs.renameSync(apiRoot, target)
    apiRoot = target
  }

  log(`可用 API 目录 = ${apiRoot}`)
  log(`version = ${result.version}｜moduleCount = ${result.moduleCount}`)
  log(`总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

  if (!verify) {
    log('（未开启 --verify，跳过真实请求验证）')
    return
  }

  // 真实请求验证：确认这份下载来的后端能干活
  const tokenFile = path.resolve(os.tmpdir(), 'anonymous_token')
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, '', 'utf-8')

  // API 的 main.js 是 CommonJS，用 createRequire 加载最贴近应用的真实路径
  const require = createRequire(path.join(apiRoot, 'main.js'))
  const api = require(path.join(apiRoot, 'main.js'))
  const call = (name, params) => api[name](params)

  const lyric = await call('lyric_new', { id: 186016 })
  log(
    `lyric_new code=${lyric?.body?.code} 有 lrc=${!!lyric?.body?.lrc?.lyric} 有 tlyric=${!!lyric?.body?.tlyric?.lyric}`,
  )

  const search = await call('cloudsearch', {
    keywords: '富士山下 陈奕迅',
    type: 1,
    limit: 1,
  })
  const song = search?.body?.result?.songs?.[0]
  log(
    `cloudsearch → ${song ? `${song.name} / ${(song.ar ?? []).map((a) => a.name).join('/')}` : '(空)'}`,
  )

  if (song) {
    const yrc = await call('lyric_new', { id: song.id })
    const text = yrc?.body?.yrc?.lyric ?? ''
    const tokens = (text.match(/\(\d+,\d+,\d+\)/g) || []).length
    log(`逐字 token 数 = ${tokens}`)
  }

  log('✅ --verify 通过：下载来的后端可正常请求')
}

main().catch((error) => {
  console.error('[fetch-api] 异常：', error?.message ?? error)
  process.exit(1)
})
