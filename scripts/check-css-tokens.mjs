// 校验 CSS 里引用的自定义属性都有定义。
//
// 为什么需要这个：`var(--x)` 指向未定义变量时，声明会在 computed-value 阶段
// 整条失效并回退到初始值 —— transition 变成 `all 0s`、animation 变成 `none`，
// 而且控制台一声不响。曾经因为漏定义 --ease-out 导致全站动效静默失效。
//
// 用法：node scripts/check-css-tokens.mjs  （已挂在 prebuild / predev 上）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const srcDir = path.join(root, 'src')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(srcDir)
const defined = new Set()
const used = new Map()

for (const file of files.filter((f) => f.endsWith('.css'))) {
  const text = fs.readFileSync(file, 'utf-8')
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1])
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set())
    used.get(m[1]).add(path.relative(root, file))
  }
}

// 组件里注入的变量也算已定义，两种写法都认：
//   内联 style —— --cover-url、--slider-thickness
//   运行时 setProperty —— 例如歌词擦除的 --lp、--lyric-progress
for (const file of files.filter(
  (f) => f.endsWith('.tsx') || f.endsWith('.ts'),
)) {
  const text = fs.readFileSync(file, 'utf-8')
  for (const m of text.matchAll(/['"](--[a-z0-9-]+)['"]\s*:/g))
    defined.add(m[1])
  for (const m of text.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g))
    defined.add(m[1])
}

const missing = [...used.keys()].filter((name) => !defined.has(name)).sort()

if (missing.length === 0) {
  console.log(`[check-css] ✓ ${used.size} 个 CSS 变量引用全部有定义`)
} else {
  console.error('[check-css] ✗ 以下变量被引用但未定义，会让整条声明失效：')
  for (const name of missing) {
    console.error(`           ${name}  <- ${[...used.get(name)].join(', ')}`)
  }
  process.exit(1)
}
