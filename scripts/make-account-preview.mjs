// 生成个人中心面板的静态预览：用真实构建 CSS 复现应用外壳结构，
// 用来排查「组件在 DOM 里但看不见」这类层叠/布局问题。
// 用法：node scripts/make-account-preview.mjs [输出路径]
import fs from 'node:fs'
import path from 'node:path'

const assets = 'out/renderer/assets'
const pick = (prefix) =>
  fs.readdirSync(assets).find((f) => f.startsWith(prefix) && f.endsWith('.css'))
const globalCss = fs.readFileSync(path.join(assets, pick('global-')), 'utf-8')
const indexCss = fs.readFileSync(path.join(assets, pick('index-')), 'utf-8')

const svg = (body, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

const icons = {
  user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"></path>',
  heart:
    '<path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.5-7 9-7 9z"></path>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  settings:
    '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path>',
  sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4 4.2 19.8M19.8 4.2l-1.4 1.4"></path>',
  refresh:
    '<path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 3v5h-5"></path>',
  close: '<path d="M6 6l12 12M18 6 6 18"></path>',
  chevron: '<path d="m9 5 7 7-7 7"></path>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 11h18"></path>',
  search:
    '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
  chevronLeft: '<path d="m15 5-7 7 7 7"></path>',
}

const menuItem = (icon, label) => `
  <button type="button" class="account-item">
    ${svg(icon, 16)}
    <span>${label}</span>
    <span class="account-item-arrow">${svg(icons.chevron, 14)}</span>
  </button>`

const panel = `
<div class="account-panel no-drag">
  <div class="account-head">
    <div class="cover cover-round" style="width:46px;height:46px;background:linear-gradient(135deg,#7d5cff,#3b8cff)"></div>
    <div class="account-identity">
      <div class="row gap-6">
        <span class="account-name ellipsis">圹夜Yasushi</span>
        <span class="account-vip">SVIP</span>
      </div>
      <span class="account-sign f-12 muted ellipsis">快乐就好。</span>
    </div>
  </div>

  <div class="account-stats">
    <button type="button" class="account-stat"><b>19</b><span>笔记</span></button>
    <button type="button" class="account-stat"><b>11</b><span>关注</span></button>
    <button type="button" class="account-stat"><b>82</b><span>粉丝</span></button>
    <button type="button" class="account-stat"><b>Lv.10</b><span>等级</span></button>
  </div>

  <div class="account-signin">
    <div class="account-signin-text">
      <span class="f-13 bold">${svg(icons.calendar, 14)} 每日签到</span>
      <span class="f-12 muted">签到可得 3 点经验</span>
    </div>
    <button type="button" class="btn btn-primary">签到</button>
  </div>

  <div class="account-menu">
    ${menuItem(icons.user, '我的主页')}
    ${menuItem(icons.heart, '我喜欢的音乐')}
    ${menuItem(icons.folder, '本地音乐')}
    <div class="account-divider"></div>
    ${menuItem(icons.settings, '个人信息设置')}
    ${menuItem(icons.sun, '切换到浅色主题')}
    <div class="account-divider"></div>
    ${menuItem(icons.refresh, '切换账号')}
    <button type="button" class="account-item account-item-danger">
      ${svg(icons.close, 16)}
      <span>退出登录</span>
      <span class="account-item-arrow">${svg(icons.chevron, 14)}</span>
    </button>
  </div>
</div>`

const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">
<style>${globalCss}</style><style>${indexCss}</style>
</head><body>
<div class="app-shell">
  <div class="aurora"><div class="aurora-base"></div><div class="aurora-cover"></div><div class="aurora-veil"></div></div>
  <header class="titlebar drag">
    <div class="titlebar-nav no-drag">
      <button class="icon-btn">${svg(icons.chevronLeft, 18)}</button>
      <button class="icon-btn">${svg(icons.chevron, 18)}</button>
    </div>
    <div class="titlebar-search no-drag">
      <span class="titlebar-search-icon">${svg(icons.search, 15)}</span>
      <input placeholder="搜索歌曲、歌手、歌单…" />
    </div>
    <div class="spacer"></div>
    <div class="titlebar-right no-drag">
      <button class="icon-btn">${svg(icons.refresh, 16)}</button>
      <button class="icon-btn">${svg(icons.settings, 16)}</button>
      <button class="titlebar-avatar titlebar-avatar-open">
        <div class="cover cover-round" style="width:28px;height:28px;background:linear-gradient(135deg,#7d5cff,#3b8cff)"></div>
      </button>
    </div>
    ${panel}
    <div class="window-controls no-drag">
      <button class="window-btn">—</button>
      <button class="window-btn">▢</button>
      <button class="window-btn window-btn-close">✕</button>
    </div>
  </header>
  <div class="app-body">
    <aside class="sidebar"><nav class="sidebar-nav"><a class="sidebar-link sidebar-link-active">发现音乐</a><a class="sidebar-link">播客</a></nav></aside>
    <main class="app-main scroll-y"><div class="page"><h1 class="f-24">页面内容</h1><p class="muted">用于观察面板是否被内容层遮住</p></div></main>
  </div>
  <footer class="player-bar"><div class="player-song"><div class="cover" style="width:56px;height:56px;background:#444"></div><div class="player-song-info"><span class="player-song-name">测试歌曲</span><span class="player-song-artist">测试歌手</span></div></div></footer>
</div>
</body></html>`

const out =
  process.argv[2] ?? 'C:/Users/orisn/AppData/Local/Temp/account-preview.html'
fs.writeFileSync(out, html)
console.log('written:', out)
