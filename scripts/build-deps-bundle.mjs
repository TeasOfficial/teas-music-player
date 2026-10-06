// 把一份已装好依赖的 API 目录打成 `deps-<version>.tar.gz`，供发布到 GitHub Release。
//
// 目的：让「薄壳首次启动」不再需要用户机器上的 npm。壳优先下载这个预置包直接解包，
// 只有在拿不到预置包时才退回去调用 npm。
//
// 为什么能这样做：
//   - 上游 API 的生产依赖实测 **0 个原生模块**（纯 JS），因此预置包跨平台通用；
//   - 包内不含任何安装脚本，解包即可用，不会执行第三方代码。
//
// 用法：
//   node scripts/build-deps-bundle.mjs --from "<已装好的 API 目录>"
//   node scripts/build-deps-bundle.mjs --from "<dir>" --out dist-assets
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const outIndex = args.indexOf('--out')
if (fromIndex < 0) {
  console.error(
    '用法: node scripts/build-deps-bundle.mjs --from "<已装好依赖的 API 目录>" [--out dist-assets]',
  )
  process.exit(1)
}
const apiDir = path.resolve(args[fromIndex + 1])
const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(projectRoot, 'dist-assets'))

const fail = (message) => {
  console.error(`[deps-bundle] 失败：${message}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(apiDir, 'node_modules'))) {
  fail(`${apiDir} 下没有 node_modules，请先把这份 API 的依赖装好`)
}
if (!fs.existsSync(path.join(apiDir, 'main.js'))) {
  fail(`${apiDir} 看起来不是一份 API 目录（缺 main.js）`)
}

let version = 'unknown'
try {
  version = JSON.parse(fs.readFileSync(path.join(apiDir, 'package.json'), 'utf-8')).version
} catch {
  fail('读取 package.json 失败，无法确定版本号')
}
if (!/^\d+\.\d+\.\d+/.test(version)) fail(`版本号不可信：${version}`)

fs.mkdirSync(outDir, { recursive: true })
const target = path.join(outDir, `deps-${version}.tar.gz`)

// 用系统 tar：Windows 10+、macOS、Linux 都自带，避免为此引入打包依赖。
// 排除 .bin（npm 生成的 shim，运行时不需要，且含符号链接）
//
// --force-local：Windows 上的 GNU tar 会把 `E:\path` 里的冒号当成「远程主机」，
// 报 `Cannot connect to E:`，必须显式告诉它这是本地路径（bsdtar 会忽略该选项）。
const tarArgs = [
  '--force-local',
  '--exclude=node_modules/.bin',
  '-czf',
  target,
  '-C',
  apiDir,
  'node_modules',
]
const result = spawnSync('tar', tarArgs, { stdio: 'pipe' })
if (result.error || result.status !== 0) {
  fail(
    `tar 执行失败：${result.error?.message ?? String(result.stderr).slice(-300)}`,
  )
}

const sizeMb = (fs.statSync(target).size / 1024 / 1024).toFixed(2)
const listed = spawnSync('tar', ['--force-local', '-tzf', target], {
  encoding: 'utf8',
})
const count = String(listed.stdout || '')
  .trim()
  .split('\n')
  .filter(Boolean).length

console.log(`[deps-bundle] 已生成 ${path.relative(projectRoot, target)}`)
console.log(`[deps-bundle] API 版本 = ${version}｜压缩后 = ${sizeMb} MB｜条目 = ${count}`)
console.log('[deps-bundle] 下一步：把它作为 Release 附件上传')
console.log(
  `  gh release create api-deps-${version} "${target}" --title "API 依赖预置包 ${version}" --notes "供 Teas Music Player 薄壳首次启动直接解包使用（免 npm）"`,
)
