// 生成 NSIS 安装向导所需的图片素材：
//   resources/installerIcon.ico        安装/卸载程序图标（多尺寸，PNG 压缩条目）
//   resources/installerHeader.bmp      安装页顶部横幅（MUI 要求 150x57，24 位 BMP）
//   resources/installerSidebar.bmp     欢迎/完成页左侧大图（MUI 要求 164x314）
//   resources/uninstallerSidebar.bmp   卸载向导左侧大图
//
// NSIS 的 MUI 只认 BMP（不是 PNG），所以这里自己写 BMP 与 ICO 容器；
// 绘制沿用 make-icon.mjs 里那套纯 JS 光栅化，保证和 .exe 图标同一套配色。
// 用法：node scripts/make-installer-assets.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACCENT,
  BG_BOTTOM,
  BG_TOP,
  mix,
  noteCoverage,
  renderIcon,
  roundedCoverage,
} from './make-icon.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const resourcesDir = path.join(projectRoot, 'resources')

/** 横向渐变底 + 右上角红光，跟图标同一套配色 */
function backdrop(x, y, width, height) {
  const t = y / height
  let [r, g, b] = mix(BG_TOP, BG_BOTTOM, t)
  const gx = (x - width * 0.82) / (width * 0.55)
  const gy = (y - height * 0.18) / (height * 0.9)
  const glow = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy))
  if (glow > 0) [r, g, b] = mix([r, g, b], ACCENT, glow * 0.34)
  return [r, g, b]
}

/**
 * 在 (boxX, boxY) 处画一个边长 size 的圆角"品牌块"：深色圆角底 + 白色音符。
 * 就是应用里那个标识的像素版。
 */
function paintMark(canvas, boxX, boxY, size) {
  const radius = size * 0.22
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = boxX + x
      const cy = boxY + y
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue
      const alpha = roundedCoverage(x, y, size, radius)
      if (alpha <= 0.002) continue

      let [r, g, b] = mix([46, 52, 70], [24, 26, 36], y / size)
      const gx = (x - size * 0.78) / (size * 0.5)
      const gy = (y - size * 0.2) / (size * 0.5)
      const glow = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy))
      if (glow > 0) [r, g, b] = mix([r, g, b], ACCENT, glow * 0.4)
      if (noteCoverage(x, y, size)) [r, g, b] = mix([r, g, b], [255, 255, 255], 0.94)

      const i = (cy * canvas.width + cx) * 3
      const a = alpha
      canvas.rgb[i] = Math.round(canvas.rgb[i] * (1 - a) + r * a)
      canvas.rgb[i + 1] = Math.round(canvas.rgb[i + 1] * (1 - a) + g * a)
      canvas.rgb[i + 2] = Math.round(canvas.rgb[i + 2] * (1 - a) + b * a)
    }
  }
}

function createCanvas(width, height) {
  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = backdrop(x, y, width, height)
      const i = (y * width + x) * 3
      rgb[i] = Math.round(r)
      rgb[i + 1] = Math.round(g)
      rgb[i + 2] = Math.round(b)
    }
  }
  return { width, height, rgb }
}

/** 24 位 BMP（行按 4 字节对齐、自下而上、BGR） */
function encodeBmp(canvas) {
  const { width, height, rgb } = canvas
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelSize = rowSize * height
  const headerSize = 54
  const out = Buffer.alloc(headerSize + pixelSize)

  out.write('BM', 0, 'ascii')
  out.writeUInt32LE(headerSize + pixelSize, 2)
  out.writeUInt32LE(headerSize, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(0, 30)
  out.writeUInt32LE(pixelSize, 34)
  out.writeInt32LE(2835, 38)
  out.writeInt32LE(2835, 42)

  for (let y = 0; y < height; y += 1) {
    const srcRow = (height - 1 - y) * width * 3
    const dstRow = headerSize + y * rowSize
    for (let x = 0; x < width; x += 1) {
      const s = srcRow + x * 3
      const d = dstRow + x * 3
      out[d] = rgb[s + 2]
      out[d + 1] = rgb[s + 1]
      out[d + 2] = rgb[s]
    }
  }
  return out
}

/** ICO 容器：每条目直接塞一份 PNG（Vista 起支持），无需自己压缩 */
function encodeIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6 + count * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  let offset = header.length
  pngs.forEach(({ size, data }, index) => {
    const e = 6 + index * 16
    header[e] = size >= 256 ? 0 : size
    header[e + 1] = size >= 256 ? 0 : size
    header[e + 2] = 0
    header[e + 3] = 0
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map((p) => p.data)])
}

fs.mkdirSync(resourcesDir, { recursive: true })

// ---- 图标：多尺寸 ICO ----
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const ico = encodeIco(icoSizes.map((size) => ({ size, data: renderIcon(size) })))
fs.writeFileSync(path.join(resourcesDir, 'installerIcon.ico'), ico)

// ---- 顶部横幅 150x57：左侧品牌块 ----
const header = createCanvas(150, 57)
paintMark(header, 12, 8, 41)
fs.writeFileSync(path.join(resourcesDir, 'installerHeader.bmp'), encodeBmp(header))

// ---- 左侧大图 164x314：居中品牌块 ----
function sidebar(markSize) {
  const canvas = createCanvas(164, 314)
  paintMark(canvas, Math.round((164 - markSize) / 2), 92, markSize)
  // 底部一条细的品牌色横线
  for (let y = 286; y < 289; y += 1) {
    for (let x = 42; x < 122; x += 1) {
      const i = (y * 164 + x) * 3
      const [r, g, b] = mix(ACCENT, [255, 255, 255], 0.15)
      canvas.rgb[i] = Math.round(r)
      canvas.rgb[i + 1] = Math.round(g)
      canvas.rgb[i + 2] = Math.round(b)
    }
  }
  return canvas
}
fs.writeFileSync(path.join(resourcesDir, 'installerSidebar.bmp'), encodeBmp(sidebar(96)))
fs.writeFileSync(
  path.join(resourcesDir, 'uninstallerSidebar.bmp'),
  encodeBmp(sidebar(80)),
)

for (const name of [
  'installerIcon.ico',
  'installerHeader.bmp',
  'installerSidebar.bmp',
  'uninstallerSidebar.bmp',
]) {
  const file = path.join(resourcesDir, name)
  console.log(`[installer-assets] ${name} (${fs.statSync(file).size} B)`)
}
