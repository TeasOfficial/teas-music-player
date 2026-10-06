/**
 * npm 拉取器：从 npm registry 取一份最新的 NeteaseCloudMusicApiEnhanced，
 * 校验、解包、装生产依赖，产物交给 API 加载器使用。
 *
 * 为什么走 npm 而不是 Git：
 *  1. 免装 Git（Windows 内置 Git 比 API 本体还大，还要处理代理/CRLF）；
 *  2. registry 自带 dist.integrity（sha512），可强校验，Git clone 没有等价物；
 *  3. 国内有大量 npm 镜像，可达性远好于 codeload / raw.githubusercontent；
 *  4. 包的 files 白名单已包含 module/ + util/ + public/ + data/，正好是运行所需全集。
 *
 * 安全边界（这是「下载远端代码并在主进程执行」的通道，必须守住）：
 *  - 只接受 semver 形状的版本号；
 *  - 只从 registry 元数据给出的 dist.tarball 下载；
 *  - sha512 不匹配直接拒绝解包；
 *  - 依赖安装一律 --ignore-scripts（绝不执行包内生命周期脚本）；
 *  - 解包拒绝绝对路径与 `..` 逃逸；
 *  - 装完必须通过结构校验 + require 冒烟，否则整份删除。
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

export const API_PACKAGE = '@neteasecloudmusicapienhanced/api'
export const API_UNIT = 'NeteaseCloudMusicApiEnhanced'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface RemoteVersion {
  version: string
  latest: string
  tarball: string
  integrity: string
  shasum: string
  dependencyCount: number
}

export interface InstallHooks {
  registry?: string
  onLog?: (message: string) => void
  onProgress?: (progress: { phase: string; ratio: number }) => void
}

export interface InstallResult {
  ok: boolean
  version: string
  dir?: string
  moduleCount?: number
  error?: string
  log: string[]
}

/* ------------------------------------------------------------------ */
/* 基础设施                                                            */
/* ------------------------------------------------------------------ */

interface TarEntry {
  full: string
  size: number
  typeFlag: string
  body: Buffer
}

function openTar(buffer: Buffer) {
  let offset = 0
  return {
    next(): TarEntry | null {
      if (offset + 512 > buffer.length) return null
      const header = buffer.subarray(offset, offset + 512)
      if (header.every((byte) => byte === 0)) return null
      const nameRaw = header
        .subarray(0, 100)
        .toString('utf8')
        .replace(/\0.*$/, '')
      const sizeRaw = Number.parseInt(
        header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(),
        8,
      )
      const size = Number.isFinite(sizeRaw) ? sizeRaw : 0
      const typeFlag = String.fromCharCode(header[156] || 0x30)
      const prefix = header
        .subarray(345, 500)
        .toString('utf8')
        .replace(/\0.*$/, '')
      const full = prefix ? `${prefix}/${nameRaw}` : nameRaw
      const body = buffer.subarray(offset + 512, offset + 512 + size)
      offset += 512 + Math.ceil(size / 512) * 512
      return { full, size, typeFlag, body }
    },
  }
}

/** 与给定可执行文件同级时，npm CLI 的常见位置 */
function npmCliBeside(executable: string): string[] {
  const dir = path.dirname(executable)
  return [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
}

/** PATH 上每个目录里，npm CLI 的常见位置（受 pnpm/volta 影响，npm.cmd 可能只是 shim） */
function npmCliFromPath(): string[] {
  const separator = process.platform === 'win32' ? ';' : ':'
  const entries = (process.env.PATH || '').split(separator).filter(Boolean)
  return entries.flatMap((entry) => [
    path.join(entry, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(entry, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ])
}

function firstExisting(candidates: string[]): string {
  return candidates.find((candidate) => {
    try {
      return !!candidate && fs.existsSync(candidate)
    } catch {
      return false
    }
  }) ?? ''
}

/** 找到 npm 自带的 CLI 入口（.js）。找不到就只能退回 npm.cmd，见 npmSpawnCommand */
export function resolveNpmCli(): string {
  return firstExisting([
    ...(process.env.NPM_CLI ? [process.env.NPM_CLI] : []),
    // Node 运行时：npm 就在 node 同级
    ...npmCliBeside(process.execPath),
    // Electron 运行时：electron.exe 在 node_modules/electron/dist/ 下，
    // 真正的 npm 在它的上级 node_modules/npm
    ...npmCliBeside(path.resolve(path.dirname(process.execPath), '..', '..', '..')),
    // pnpm/volta 等：npm.cmd 只是 shim，真身往往在 PATH 上的某个 node_modules 里
    ...npmCliFromPath(),
  ])
}

/** 找 npm 的可执行入口（.cmd/.exe），仅在上面的 CLI 找不到时使用 */
export function resolveNpm(): string {
  if (process.env.NPM_BIN) return process.env.NPM_BIN
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const beside = path.join(path.dirname(process.execPath), executable)
  return fs.existsSync(beside) ? beside : executable
}

/**
 * 执行依赖安装的进程与参数。
 *
 * Windows 上**不能**直接 spawn `npm.cmd`：Node 24 起会抛 EINVAL
 * （`.cmd` 是批处理，必须经 cmd.exe）；用 `shell: true` 虽然能跑，
 * 但会把未转义的参数交给 shell（DEP0190），是注入面。
 * 因此优先注入 `NPM_CLI` 让 npm 自己以 `node npm-cli.js` 的方式再执行一次
 * （npm 支持这个环境变量，且天然避开 .cmd 问题）；次选自己 spawn CLI；
 * 都拿不到才退回 shell 执行 .cmd。
 */
function npmSpawnCommand(): {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
} {
  const cli = resolveNpmCli()
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  if (cli) {
    return { command: process.execPath, args: [cli], env: { ...baseEnv, NPM_CLI: cli } }
  }
  return { command: resolveNpm(), args: [], env: { ...process.env } }
}

/**
 * 启动子进程并把输出按行回调。
 * 刻意不用 shell: true —— Windows 上 npm 是 .cmd，直接 spawn 更可控，
 * 也避免把未转义的参数交给 shell。
 */
function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {},
  onLine?: (line: string) => void,
): Promise<{ code: number; error?: string; output: string }> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: options.shell ?? false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        code: -1,
        error: error instanceof Error ? error.message : String(error),
        output: '',
      })
      return
    }
    let output = ''
    const pump = (stream: NodeJS.ReadableStream): void => {
      const rl = readline.createInterface({ input: stream })
      rl.on('line', (line: string) => {
        output = `${output}${line}\n`
        if (output.length > 200_000) output = output.slice(-100_000)
        onLine?.(line)
      })
    }
    if (child.stdout) pump(child.stdout)
    if (child.stderr) pump(child.stderr)
    child.on('error', (error) =>
      resolve({ code: -1, error: error.message, output }),
    )
    child.on('close', (code) => resolve({ code: code ?? -1, output }))
  })
}

/* ------------------------------------------------------------------ */
/* registry 交互                                                       */
/* ------------------------------------------------------------------ */

export function defaultRegistry(): string {
  return (
    process.env.NCM_API_REGISTRY ||
    process.env.NPM_CONFIG_REGISTRY ||
    'https://registry.npmjs.org'
  )
}

async function fetchJson(url: string, timeoutMs = 30_000): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 取指定版本（省略则最新）的元数据 */
export async function resolveRemoteVersion(
  registryUrl: string,
  version?: string,
): Promise<RemoteVersion> {
  const url = `${registryUrl.replace(/\/$/, '')}/${API_PACKAGE.replace('/', '%2F')}`
  const meta = await fetchJson(url)
  const target = version || meta['dist-tags']?.latest
  if (!target || !SEMVER.test(String(target))) {
    throw new Error(`registry 返回的版本号不可信：${String(target)}`)
  }
  const info = meta.versions?.[target]
  if (!info?.dist?.tarball) {
    throw new Error(`registry 里没有版本 ${target} 的 tarball 地址`)
  }
  return {
    version: target,
    latest: meta['dist-tags']?.latest ?? target,
    tarball: info.dist.tarball,
    integrity: info.dist.integrity ?? '',
    shasum: info.dist.shasum ?? '',
    dependencyCount: Object.keys(info.dependencies ?? {}).length,
  }
}

/* ------------------------------------------------------------------ */
/* 安装                                                               */
/* ------------------------------------------------------------------ */

/** 目录是否是一份可用的 API（结构齐全） */
export function isValidApiDir(dir: string): boolean {
  if (!dir || !fs.existsSync(dir)) return false
  try {
    return (
      fs.existsSync(path.join(dir, 'main.js')) &&
      fs.statSync(path.join(dir, 'module')).isDirectory() &&
      fs.existsSync(path.join(dir, 'util', 'config.json')) &&
      fs.existsSync(path.join(dir, 'package.json'))
    )
  } catch {
    return false
  }
}

export function readInstalledVersion(dir: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'),
    )
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 缺依赖会让 require 直接失败，这里做快速自检 */
function missingRuntimeDeps(dir: string, dependencyNames: string[]): string[] {
  const modulesDir = path.join(dir, 'node_modules')
  return dependencyNames.filter((name) => !fs.existsSync(path.join(modulesDir, name)))
}

/**
 * 依赖预置包（GitHub Release 附件）。
 *
 * 上游 API 的生产依赖实测 0 个原生模块（纯 JS），所以可以预打包成一份
 * `deps-<version>.tar.gz` 放在我们自己的 Release 里。壳优先下载它直接解包，
 * **用户机器上就不需要任何 npm/Node**；只有拿不到预置包时才退回去调用 npm。
 *
 * 可用环境变量覆盖（便于自建镜像或在没有 Release 时关闭这条路径）：
 *   NCM_DEPS_BUNDLE_URL   完全自定义的下载地址模板，支持 {version} 占位
 *   NCM_DEPS_BUNDLE_TAG   自定义 Release tag（默认 `api-deps-<version>`）
 *   NCM_DEPS_BUNDLE=0     禁用预置包路径，强制走 npm
 */
export function depsBundleUrl(version: string): string {
  if (process.env.NCM_DEPS_BUNDLE === '0') return ''
  const template = process.env.NCM_DEPS_BUNDLE_URL
  if (template) return template.replace('{version}', version)
  const tag = process.env.NCM_DEPS_BUNDLE_TAG || `api-deps-${version}`
  return `https://github.com/TeasOfficial/teas-music-player/releases/download/${tag}/deps-${version}.tar.gz`
}

/**
 * 下载依赖预置包并解到 `<destDir>/node_modules`。
 * 返回实际解出的文件数；任何一步失败都返回 0（由调用方回退到 npm）。
 */
async function installDepsFromBundle(
  destDir: string,
  version: string,
  onLine?: (line: string) => void,
): Promise<number> {
  const url = depsBundleUrl(version)
  if (!url) return 0
  try {
    onLine?.(`获取依赖预置包 ${url}`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      onLine?.(`预置包不可用（HTTP ${res.status}），将回退 npm`)
      return 0
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    onLine?.(`预置包下载完成 ${(bytes.length / 1024 / 1024).toFixed(2)} MB`)

    const target = path.resolve(destDir)
    const tar = openTar(zlib.gunzipSync(bytes))
    let files = 0
    for (let entry = tar.next(); entry; entry = tar.next()) {
      const relative = entry.full
      // 只接受 node_modules/ 下的条目，并拒绝路径逃逸
      if (!relative.startsWith('node_modules/') || relative.includes('..')) {
        continue
      }
      const absolute = path.join(target, relative)
      if (!absolute.startsWith(target)) continue
      if (entry.typeFlag === '5') {
        fs.mkdirSync(absolute, { recursive: true })
      } else if (entry.typeFlag === '0' || entry.typeFlag === '\0') {
        fs.mkdirSync(path.dirname(absolute), { recursive: true })
        fs.writeFileSync(absolute, entry.body)
        files += 1
      }
    }
    onLine?.(`预置包解出 ${files} 个文件`)
    return files
  } catch (error) {
    onLine?.(
      `预置包处理失败（${error instanceof Error ? error.message : String(error)}），将回退 npm`,
    )
    return 0
  }
}

function declaredDependencies(dir: string): string[] {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'),
    )
    return Object.keys(pkg.dependencies ?? {})
  } catch {
    return []
  }
}

/**
 * 下载并安装指定版本到 `destDir`（调用方保证这是干净目录）。
 */
export async function installApiVersion(
  destDir: string,
  remote: RemoteVersion,
  hooks: InstallHooks = {},
): Promise<InstallResult> {
  const log: string[] = []
  const note = (message: string): void => {
    log.push(message)
    hooks.onLog?.(message)
  }
  const tmpTar = `${destDir}.tgz`

  try {
    // 1) 下载
    note(`下载 ${remote.tarball}`)
    const startedAt = Date.now()
    const res = await fetch(remote.tarball)
    if (!res.ok) throw new Error(`tarball 下载失败 HTTP ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(path.dirname(destDir), { recursive: true })
    fs.writeFileSync(tmpTar, bytes)
    note(
      `下载完成 ${(bytes.length / 1024 / 1024).toFixed(2)} MB，耗时 ${Date.now() - startedAt}ms`,
    )

    // 2) 校验
    if (remote.integrity) {
      const [algorithm, expected] = String(remote.integrity).split('-', 2)
      const actual = crypto
        .createHash(algorithm)
        .update(bytes)
        .digest(algorithm === 'sha512' ? 'base64' : 'hex')
      const ok = actual === expected
      note(`integrity(${algorithm}) 校验${ok ? '通过' : '不匹配'}`)
      if (!ok) throw new Error('tarball 完整性校验失败，已拒绝安装')
    } else if (remote.shasum) {
      const actual = crypto.createHash('sha1').update(bytes).digest('hex')
      const ok = actual === remote.shasum
      note(`shasum 校验${ok ? '通过' : '不匹配'}`)
      if (!ok) throw new Error('tarball shasum 校验失败，已拒绝安装')
    } else {
      note('⚠️ registry 未提供 integrity/shasum，已跳过校验')
    }

    // 3) 解包（npm 包内路径前缀是 package/）
    fs.rmSync(destDir, { recursive: true, force: true })
    fs.mkdirSync(destDir, { recursive: true })
    const root = path.resolve(destDir)
    const tar = openTar(zlib.gunzipSync(bytes))
    let files = 0
    for (let entry = tar.next(); entry; entry = tar.next()) {
      const relative = entry.full.replace(/^package\//, '')
      if (!relative || relative.includes('..') || path.isAbsolute(relative)) {
        continue
      }
      const target = path.join(root, relative)
      if (!target.startsWith(root)) continue
      if (entry.typeFlag === '5') {
        fs.mkdirSync(target, { recursive: true })
      } else if (entry.typeFlag === '0' || entry.typeFlag === '\0') {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, entry.body)
        files += 1
      }
    }
    note(`解包 ${files} 个文件`)

    if (!isValidApiDir(destDir)) {
      throw new Error('解包后的目录不完整（缺 main.js / module / util/config.json）')
    }

    // 4) 依赖：优先用预置包（用户机器无需 npm），不行才回退 npm
    const dependencyNames = declaredDependencies(destDir)
    let missing = missingRuntimeDeps(destDir, dependencyNames)
    if (missing.length > 0) {
      note(`缺少 ${missing.length} 个生产依赖，先尝试预置包（免 npm）`)
      hooks.onProgress?.({ phase: 'deps-bundle', ratio: 0.4 })
      const extracted = await installDepsFromBundle(
        destDir,
        remote.version,
        (line) => hooks.onLog?.(line),
      )
      if (extracted > 0) {
        missing = missingRuntimeDeps(destDir, dependencyNames)
        if (missing.length === 0) {
          note('预置包已满足全部依赖，跳过 npm')
          hooks.onProgress?.({ phase: 'deps-bundle', ratio: 0.7 })
        } else {
          note(`预置包后仍缺 ${missing.length} 个依赖，继续用 npm 补齐`)
        }
      }
    }

    if (missing.length > 0) {
      const npmCommand = npmSpawnCommand()
      note(
        `安装 ${missing.length} 个生产依赖（npm --omit=dev --ignore-scripts）` +
          `｜命令=${path.basename(npmCommand.command)}${npmCommand.args.length ? ` ${npmCommand.args.join(' ')}` : '（无 CLI，退回命令名）'}`,
      )
      hooks.onProgress?.({ phase: 'install', ratio: 0.5 })
      const installArgs = [
        ...npmCommand.args,
        'install',
        '--omit=dev',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
      ]
      let result = await run(
        npmCommand.command,
        installArgs,
        { cwd: destDir, env: npmCommand.env },
        (line) => hooks.onLog?.(line),
      )

      // 兜底：CLI 路线不可用时（例如找不到 npm-cli.js，spawn .cmd 报 EINVAL），
      // 退回经 cmd.exe 执行 npm.cmd。参数是我们自己拼的常量，不含用户输入。
      if (result.code !== 0 && result.error && npmCommand.args.length > 0) {
        const fallback = resolveNpm()
        note(`CLI 路线失败（${result.error}），改用 ${path.basename(fallback)} 重试`)
        result = await run(
          fallback,
          installArgs.slice(npmCommand.args.length),
          {
            cwd: destDir,
            env: process.env,
            shell: process.platform === 'win32',
          },
          (line) => hooks.onLog?.(line),
        )
      }

      if (result.code !== 0) {
        const detail = String(result.error || result.output)
          .trim()
          .slice(-400)
        throw new Error(
          `依赖安装失败（退出码 ${result.code}${result.error ? `，${result.error}` : ''}）：${detail || '无输出'}`,
        )
      }
      const stillMissing = missingRuntimeDeps(destDir, dependencyNames)
      if (stillMissing.length > 0) {
        throw new Error(`依赖仍缺失：${stillMissing.slice(0, 6).join(', ')}`)
      }
      note('依赖安装完成')
    } else {
      note('依赖已齐备，跳过安装')
    }

    // 5) 冒烟：真的 require 一次并数接口
    //    注意 process.execPath 在 Electron 里是 electron.exe，必须带
    //    ELECTRON_RUN_AS_NODE=1 才会当普通 Node 用，否则它会去开窗口。
    note('冒烟测试：require main.js 并统计接口')
    hooks.onProgress?.({ phase: 'verify', ratio: 0.9 })
    const smoke = await run(
      process.execPath,
      [
        '-e',
        `const m=require(${JSON.stringify(path.join(destDir, 'main.js').replace(/\\/g, '/'))});
const fs=require('fs');
const dir=${JSON.stringify(path.join(destDir, 'module').replace(/\\/g, '/'))};
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js'));
const bad=files.map(f=>f.replace(/\\.js$/,'')).filter(n=>typeof m[n]!=='function');
process.stdout.write('OK '+files.length+' '+bad.length+' '+(typeof m.serveNcmApi));`,
      ],
      { cwd: destDir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    )
    const marker = /OK (\d+) (\d+) (\w+)/.exec(smoke.output)
    if (!marker) {
      throw new Error(
        `冒烟测试失败：${
          String(smoke.error || smoke.output).trim().slice(-300) || '无输出'
        }`,
      )
    }
    const total = Number(marker[1])
    const notCallable = Number(marker[2])
    if (notCallable > 0) {
      throw new Error(`${notCallable} 个接口无法调用，拒绝启用该版本`)
    }
    note(`冒烟通过：${total} 个接口全部可调用`)

    fs.rmSync(tmpTar, { force: true })
    hooks.onProgress?.({ phase: 'done', ratio: 1 })
    return { ok: true, version: remote.version, dir: destDir, moduleCount: total, log }
  } catch (error) {
    fs.rmSync(destDir, { recursive: true, force: true })
    fs.rmSync(tmpTar, { force: true })
    const message = error instanceof Error ? error.message : String(error)
    note(`安装失败：${message}`)
    return { ok: false, version: remote.version, error: message, log }
  }
}

/**
 * 一步到位：确保 `versionsDir/<version>` 可用（已装且完整则复用）。
 */
export async function ensureApiVersion(
  versionsDir: string,
  version: string | undefined,
  hooks: InstallHooks = {},
): Promise<InstallResult> {
  let remote: RemoteVersion
  try {
    remote = await resolveRemoteVersion(
      hooks.registry || defaultRegistry(),
      version,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    hooks.onLog?.(`取版本元数据失败：${message}`)
    return { ok: false, version: version ?? 'latest', error: message, log: [] }
  }

  const target = path.join(versionsDir, remote.version)
  if (
    isValidApiDir(target) &&
    missingRuntimeDeps(target, declaredDependencies(target)).length === 0
  ) {
    hooks.onLog?.(`已存在可用版本 ${remote.version}，直接复用`)
    return {
      ok: true,
      version: remote.version,
      dir: target,
      moduleCount: 0,
      log: [],
    }
  }
  if (isValidApiDir(target)) {
    hooks.onLog?.(`已存在的 ${remote.version} 依赖不全，重新安装`)
  }

  return installApiVersion(target, remote, hooks)
}
