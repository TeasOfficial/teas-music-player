// 构建后处理：去掉产物 HTML 里资源标签上的 `crossorigin`。
//
// 为什么必须去掉：
//   打包版通过 `file://` 加载页面，而 Vite 默认会给 <script type="module"> 与
//   <link> 加 `crossorigin`。在 `file://` 下带 crossorigin 的模块脚本会被当成
//   跨域请求拦掉，**JS 完全不执行** —— 表现就是窗口全黑，且主进程日志一切正常
//   （API 加载成功、无 did-fail-load），极难排查。
//   开发模式走 http://localhost 所以不受影响，这也是它只在安装版暴露的原因。
//
// 用后处理而不是改 vite 配置：不依赖 Vite 版本的具体行为，直接对产物生效。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const rendererDir = path.join(projectRoot, 'out', 'renderer')

if (!fs.existsSync(rendererDir)) {
  console.error(`[strip-crossorigin] 未找到构建产物目录：${rendererDir}`)
  process.exit(1)
}

const htmlFiles = fs
  .readdirSync(rendererDir)
  .filter((file) => file.endsWith('.html'))

if (htmlFiles.length === 0) {
  console.error('[strip-crossorigin] 产物里没有 HTML，构建可能未完成')
  process.exit(1)
}

let changed = 0
for (const file of htmlFiles) {
  const full = path.join(rendererDir, file)
  const before = fs.readFileSync(full, 'utf-8')
  // 只处理属性本身，保留其余内容不变
  const after = before.replace(/\s+crossorigin(?=[\s>])/g, '')
  if (after !== before) {
    fs.writeFileSync(full, after, 'utf-8')
    changed += 1
  }
  const left = (after.match(/crossorigin/g) || []).length
  console.log(
    `[strip-crossorigin] ${file}：${left === 0 ? '已清理' : `⚠️ 仍残留 ${left} 处`}`,
  )
}

console.log(`[strip-crossorigin] 处理 ${htmlFiles.length} 个文件，修改 ${changed} 个`)
