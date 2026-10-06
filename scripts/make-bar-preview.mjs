// 生成播放条对照页：验证三个图标已可区分、悬浮说明可弹出
// 用法：node scripts/make-bar-preview.mjs 然后浏览器打开生成的 html
import fs from 'node:fs'
import path from 'node:path'

const assets = 'out/renderer/assets'
const pick = (prefix) =>
  fs.readdirSync(assets).find((f) => f.startsWith(prefix) && f.endsWith('.css'))
const globalCss = fs.readFileSync(path.join(assets, pick('global-')), 'utf-8')
const indexCss = fs.readFileSync(path.join(assets, pick('index-')), 'utf-8')

const svg = (body, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

// 与 Icon.tsx 保持一致
const icons = {
  order:
    '<path d="M4.5 6v12"></path><path d="M8.5 12H19"></path><path d="M15.8 8.4 19.4 12l-3.6 3.6"></path>',
  list: '<path d="M4 7h11M4 12h11M4 17h7"></path><path d="M18 10.5v7.2"></path><circle cx="18" cy="18.6" r="2.2"></circle>',
  clock:
    '<circle cx="12" cy="12" r="8.4"></circle><path d="M12 7.2V12l3.2 2"></path>',
  prev: '<path d="M18 6v12M15 12 6 6v12l9-6z"></path>',
  play: '<path d="M8 5.5v13l11-6.5z"></path>',
  next: '<path d="M6 6v12M9 12l9-6v12l-9-6z"></path>',
  mic: '<path d="M12 3v11"></path><circle cx="12" cy="16" r="4"></circle>',
  more: '<circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle>',
  heart:
    '<path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.5-7 9-7 9z"></path>',
}

const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">
<style>${globalCss}</style><style>${indexCss}</style>
<style>body{background:#191b22;padding:120px 40px;display:flex;flex-direction:column;gap:60px}</style>
</head><body>
<div class="player-bar">
  <div class="player-song">
    <div class="cover" style="width:56px;height:56px;background:#444"></div>
    <div class="player-song-info">
      <span class="player-song-name">only my railgun ${svg(icons.heart, 15)}</span>
      <span class="player-song-artist">fripSide</span>
    </div>
  </div>
  <div class="player-center">
    <div class="player-controls">
      <button class="icon-btn" id="tip-mode" data-tip="播放模式：顺序播放">${svg(icons.order, 18)}</button>
      <button class="icon-btn" data-tip="上一首">${svg(icons.prev, 20)}</button>
      <button class="play-btn" data-tip="播放">${svg(icons.play, 22)}</button>
      <button class="icon-btn" data-tip="下一首">${svg(icons.next, 20)}</button>
      <button class="icon-btn" id="tip-recent" data-tip="最近播放">${svg(icons.clock, 18)}</button>
    </div>
  </div>
  <div class="player-extra">
    <button class="text-btn player-quality">超清母带</button>
    <button class="icon-btn" data-tip="打开桌面歌词">${svg(icons.mic, 17)}</button>
    <button class="icon-btn" id="tip-queue" data-tip="播放队列">${svg(icons.list, 18)}</button>
    <button class="icon-btn" data-tip="更多操作">${svg(icons.more, 18)}</button>
  </div>
</div>
</body></html>`

const out = process.argv[2] ?? 'C:/Users/orisn/AppData/Local/Temp/bar-test.html'
fs.writeFileSync(out, html)
console.log('written:', out)
