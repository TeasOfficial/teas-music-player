// 生成接口名清单（渲染层调用 API 时的名字提示与拼写校验）。
//
// 薄壳里这份清单是「随仓库提交的静态文件」：壳不再携带 API 源码，
// 所以正常情况下**找不到 module/ 目录，直接跳过**，沿用已提交的清单。
// 需要更新清单时，先拉一份 API 再用 --from 指过去：
//   node scripts/fetch-api.mjs --to .api-cache
//   node scripts/gen-modules.mjs --from .api-cache
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const outFile = path.join(projectRoot, 'src', 'shared', 'moduleNames.ts')

const fromIndex = process.argv.indexOf('--from')
const candidates = [
  fromIndex >= 0 ? path.resolve(process.argv[fromIndex + 1]) : '',
  // 本地联调：壳与 API 源码同仓库时仍可用仓库根
  path.resolve(projectRoot, '..', '..'),
  path.join(projectRoot, '.api-cache'),
].filter(Boolean)

const moduleDir = candidates
  .map((root) => path.join(root, 'module'))
  .find((dir) => fs.existsSync(dir))

if (!moduleDir) {
  if (fs.existsSync(outFile)) {
    const count = (fs.readFileSync(outFile, 'utf-8').match(/^\s*'/gm) || [])
      .length
    console.log(
      `[gen-modules] 未发现 API 源码目录，沿用已提交的清单（${count} 个接口）`,
    )
    process.exit(0)
  }
  console.error(
    '[gen-modules] 既没有 API 源码，也没有已提交的 moduleNames.ts，无法生成',
  )
  process.exit(1)
}

const names = fs
  .readdirSync(moduleDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.replace(/\.js$/i, ''))
  .sort()

const banner = `/**
 * 自动生成，请勿手改。
 * 来源：${path.relative(projectRoot, moduleDir).replace(/\\/g, '/')}（NeteaseCloudMusicApiEnhanced）
 * 生成命令：pnpm gen:modules --from <API 源码目录>
 * 共 ${names.length} 个接口。
 *
 * 注意：壳运行时加载的 API 版本可能比这里新（首次启动会从 npm 拉最新版）。
 * 这份清单只用于类型提示，运行时以实际加载的 API 为准。
 */
`

const body = `export const MODULE_NAMES = [
${names.map((n) => `  '${n}',`).join('\n')}
] as const

export type NcmModuleName = (typeof MODULE_NAMES)[number]

const MODULE_NAME_SET: ReadonlySet<string> = new Set(MODULE_NAMES)

/** 运行时校验接口名是否存在 */
export function isNcmModuleName(name: string): name is NcmModuleName {
  return MODULE_NAME_SET.has(name)
}
`

fs.writeFileSync(outFile, banner + '\n' + body, 'utf-8')
console.log(
  `[gen-modules] 已写入 ${names.length} 个接口名 -> ${path.relative(projectRoot, outFile)}`,
)
