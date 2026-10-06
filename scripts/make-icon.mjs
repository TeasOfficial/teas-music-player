// 生成应用图标（免去引入图片资源依赖）：256x256 圆角深色底 + 红色音符。
// 用法：node scripts/make-icon.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const resourcesDir = path.join(projectRoot, 'resources')

/* ---------------- 极简 PNG 编码器 ---------------- */

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1)
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------------- 绘制 ---------------- */

export const BG_TOP = [34, 38, 52]
export const BG_BOTTOM = [16, 18, 26]
export const ACCENT = [236, 65, 65]

export function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

/** 圆角矩形的覆盖率（简易抗锯齿） */
export function roundedCoverage(x, y, size, radius, samples = 4) {
  let hits = 0
  for (let sy = 0; sy < samples; sy += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      const px = x + (sx + 0.5) / samples
      const py = y + (sy + 0.5) / samples
      const cx = Math.min(Math.max(px, radius), size - radius)
      const cy = Math.min(Math.max(py, radius), size - radius)
      const dx = px - cx
      const dy = py - cy
      if (dx * dx + dy * dy <= radius * radius) hits += 1
    }
  }
  return hits / (samples * samples)
}

/** 音符：符头椭圆 + 符干 + 符尾旗 */
export function noteCoverage(px, py, size) {
  const s = size / 256

  // 符头（旋转椭圆）
  const hx = 104 * s
  const hy = 176 * s
  const rx = 34 * s
  const ry = 25 * s
  const angle = -0.38
  const dx = px - hx
  const dy = py - hy
  const ex = dx * Math.cos(angle) - dy * Math.sin(angle)
  const ey = dx * Math.sin(angle) + dy * Math.cos(angle)
  if ((ex * ex) / (rx * rx) + (ey * ey) / (ry * ry) <= 1) return true

  // 符干
  const stemX = 132 * s
  const stemTop = 66 * s
  const stemBottom = 178 * s
  const stemW = 11 * s
  if (
    px >= stemX - stemW / 2 &&
    px <= stemX + stemW / 2 &&
    py >= stemTop &&
    py <= stemBottom
  ) {
    return true
  }

  // 符尾旗（一段贝塞尔近似：用两条圆弧夹出的带）
  const fx = px - stemX
  const fy = py - stemTop
  const outerR = 46 * s
  const innerR = 24 * s
  const dist = Math.sqrt(fx * fx + fy * fy)
  if (dist <= outerR && dist >= innerR && fx >= -6 * s && fy >= -12 * s) {
    const ang = Math.atan2(fy, fx)
    if (ang > -0.35 && ang < 1.5) return true
  }

  return false
}

export function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const bgAlpha = roundedCoverage(x, y, size, size * 0.22)
      const i = (y * size + x) * 4
      if (bgAlpha <= 0.001) {
        rgba[i] = 0
        rgba[i + 1] = 0
        rgba[i + 2] = 0
        rgba[i + 3] = 0
        continue
      }

      const t = y / size
      let [r, g, b] = mix(BG_TOP, BG_BOTTOM, t)

      // 右上角一抹红光
      const gx = (x - size * 0.78) / (size * 0.5)
      const gy = (y - size * 0.2) / (size * 0.5)
      const glow = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy))
      if (glow > 0) {
        ;[r, g, b] = mix([r, g, b], ACCENT, glow * 0.35)
      }

      const note = noteCoverage(x, y, size)
      if (note) {
        ;[r, g, b] = mix([r, g, b], [255, 255, 255], 0.94)
      }

      rgba[i] = Math.round(r)
      rgba[i + 1] = Math.round(g)
      rgba[i + 2] = Math.round(b)
      rgba[i + 3] = Math.round(bgAlpha * 255)
    }
  }
  return encodePng(size, size, rgba)
}

// 只有直接运行本脚本时才生成图标；被别的脚本 import 时不应该有副作用
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(resourcesDir, { recursive: true })
  for (const [name, size] of [
    ['icon.png', 256],
    ['tray.png', 32],
  ]) {
    const file = path.join(resourcesDir, name)
    fs.writeFileSync(file, renderIcon(size))
    console.log(
      `[make-icon] ${name} (${size}x${size}) -> ${path.relative(projectRoot, file)}`,
    )
  }
}
