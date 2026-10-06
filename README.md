# Teas Music Player —— 薄壳 + 运行时拉取后端 API 的网易云音乐桌面客户端

一个 Electron + React 19 + TypeScript 的网易云音乐桌面客户端。

**本仓库不包含任何后端 API 源码。** 它是一个「薄壳」：首次启动时从 npm 拉取最新的
[`@neteasecloudmusicapienhanced/api`](https://www.npmjs.com/package/@neteasecloudmusicapienhanced/api)，
装到用户数据目录后在 Electron 主进程里 `require` 运行，从而复用上游全部 440+ 个接口。

```
┌──────────────────────────────────────────────────────────────┐
│ 渲染进程 (React)                                              │
│   ├── zustand stores   播放器状态 / 设置 / 登录 / 下载 / 本地  │
│   ├── 音频引擎         HTMLAudioElement 单例（淡入淡出）       │
│   └── pages/*          发现、歌单、搜索、歌手、MV、播客…       │
├──────────────────────────────────────────────────────────────┤
│ preload (contextBridge)  window.ncm.*  ← 类型化 IPC 契约       │
├──────────────────────────────────────────────────────────────┤
│ 主进程 (Node)                                                 │
│   ├── api/fetcher      npm 拉取 + sha512 校验 + 解包 + 装依赖  │
│   ├── api/loader       require(<userData>/api/versions/x)     │
│   ├── api/invoke       并发闸门 / 重试 / Cookie 罐             │
│   ├── download         流式下载 + 进度推送 + 歌词封面旁挂      │
│   ├── localMusic       music-metadata 扫描 + 封面提取          │
│   ├── protocol         ncmfile:// 自定义协议（支持 Range）     │
│   ├── windows/tray/shortcuts                                   │
│   └── store            settings.json / session.json 原子写      │
└──────────────────────────────────────────────────────────────┘
```

![主界面](docs/screenshot-main.png)

## 为什么「壳」与「后端」分开

上游的 `main.js` 本来就是一个库入口（`package.json` 的 `main` 字段指向它），可以直接被 `require`。
把它做成运行时依赖而不是随包分发，收益是：

- **壳很薄**：安装包不含 16MB 源码 + 44MB `node_modules`，也不含 axios/express/jsdom/crypto-js 这一大串依赖；
- **接口能独立升级**：上游每周都在加接口（写作时 npm 上是 4.41.1，449 个接口），壳不必跟着发版；
- **不重复实现**：cookie、代理与 eapi/weapi/xeapi 加密逻辑完全复用上游；
- **不需要另起 HTTP 服务**：省掉一个进程、一个端口和一层网络开销，也没有 CORS 问题。

### 首次启动发生了什么

```
壳启动
 ├─ 本地有可用 API？ → 直接用（<userData>/api/versions/<version>）
 └─ 没有 → 自动装一份（用户无需任何操作）：
      1. 取 npm registry 元数据（含 dist.integrity），只接受 semver 版本号
      2. 下载源码 tarball（约 12.8MB）
      3. sha512 校验，不匹配立即拒绝
      4. 解包（处理 PAX/GNU 长名；拒绝绝对路径与 .. 逃逸）
      5. 装生产依赖，两条路：
         a) 【默认】下载本项目 Release 里的依赖预置包 deps-<version>.tar.gz
            （8.2MB，展开 44MB）直接解包 —— **不需要用户机器上有 npm/Node**
         b) 预置包不可用时回退 `npm install --omit=dev --ignore-scripts`
      6. 结构校验 + require 冒烟 + 接口全部可调用
      7. 就绪，界面开始可用
```

冷启动实测（Windows，节点 24）：

| 路径 | 耗时 | 是否需要用户有 npm |
|---|---|---|
| 预置包（默认） | **约 8 秒** | ❌ 不需要 |
| 回退 npm | 51~85 秒 | ✅ 需要 |

无论走哪条路，失败都会自动回退，两条都不通才报错。进度会实时回报到界面（阶段 + 日志行）。

> 预置包为什么可行：上游 API 的生产依赖实测 **0 个原生模块**（纯 JS），所以一份包跨平台通用；
> 包内不含安装脚本，解包即用。生成方式见 `scripts/build-deps-bundle.mjs`。

### 安全边界

「下载远端代码并在主进程执行」是一条敏感通道，实现在 `src/main/api/fetcher.ts`，
约束都写在代码注释里：只从 registry 给的地址下载、强制完整性校验、`--ignore-scripts`、
拒绝路径逃逸、装完必须自检、版本目录隔离可回滚。详见 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)。

## 功能

**核心播放闭环**
扫码登录（含 Cookie 导入兜底）、登录态持久化与自动续期、每日推荐、推荐歌单/新歌/视频、
歌单详情（大歌单分页加载 + 歌单内搜索）、搜索（单曲/歌单/歌手/专辑/MV/播客/用户）、播放队列、
音质切换（标准→超清母带 8 档 + 自动降级）、逐字歌词滚动、我喜欢的音乐、最近播放、排行榜。

**播放体验**
桌面歌词独立置顶窗口（字号/透明度/翻译/音译/鼠标穿透锁定）、迷你模式、系统托盘（含托盘菜单）、
全局快捷键与媒体键、顺序/循环/单曲/随机/心动模式、音量与静音、淡入淡出、
跨重启恢复队列与进度、深色/浅色主题、歌词延迟校准。

**社交与互动**
歌曲/歌单/专辑/MV/电台评论（推荐/最新、点赞、回复、发布）、MV 播放与相似推荐、
播客电台（分类、节目列表、订阅）、用户主页（创建/收藏歌单、关注、粉丝）。

**本地与下载**
歌曲下载（进度/速度/取消，可选同时保存 `.lrc` 与封面）、下载管理（打开文件/定位目录）、
本地音乐库扫描（ID3/FLAC 元数据 + 封面提取，增量扫描）、自定义协议直接播放本地无损文件、
云盘歌曲。

## 环境要求

- **运行已打包的程序：不需要任何前置环境**（依赖预置包，见上）
- 从源码开发/打包：Node.js ≥ 20（推荐 22/24）与 npm

## 快速开始

```bash
npm install          # 装桌面端依赖（Electron 已被 npm 拦脚本，见下）
npm run dev          # 开发模式（Vite HMR + Electron）

# 想先手动拉一份后端看看，或做端到端验证：
npm run api:fetch    # 拉到 .api-cache/latest
npm run api:verify   # 拉取 + 真实请求验证（449 接口 + 歌词/搜索）
```

> 本机 npm 会拦截 `electron` / `esbuild` 的安装脚本（npm 11 起默认策略）。
> 若 `node_modules/electron/dist` 缺失，用 `npm install --foreground-scripts`
> 或按需复用它处的运行时（两者版本需一致）。

### 离线 / 无 Node 的机器

壳优先使用 `NCM_API_ROOT` 指向的目录，因此可以完全跳过下载：

```bash
# 1) 在一台能上网且装了 Node 的机器上产出一份自洽的 API
npm run api:fetch -- --to ./api-bundle

# 2) 把它放到目标机器任意位置，然后启动应用时指向它
NCM_API_ROOT=/path/to/api-bundle <启动应用>
```

上游本身也能这样用（`git clone` 后装好依赖即可），只是版本升级要自己维护。
若要让安装包自带一份兜底副本，把上面的目录塞进 `electron-builder.yml` 的
`extraResources` 到 `resources/api`，`loader.ts` 会自动识别。

### 锁定后端版本

`settings.json` 只记录可用版本目录；想固定某个版本，直接保留
`<userData>/api/versions/<version>` 并删除其它版本目录即可（启动时取版本号最大的那个）。

## 打包

```bash
npm run build                     # 只构建到 out/
npm run dist:dir                  # 目录产物（快，用于验证打包流程）
npm run dist                      # 生成安装包（Windows NSIS / macOS DMG / Linux AppImage）
```

国内网络打包时若 electron-builder 需要下载额外二进制：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist
```

`extraResources` 只带 `LICENSE`、`THIRD-PARTY-NOTICES.md` 与 `resources/`，
**不再分发 API 源码**，所以也不需要为它拆分 `node_modules` 条目了。

## 常用命令

| 命令                | 作用                                        |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | 开发模式（Vite HMR + Electron）             |
| `npm run build`     | 构建到 `out/`                               |
| `npm start`         | 预览构建产物                                |
| `npm run typecheck` | 主进程 + 渲染进程分别做类型检查             |
| `npm run api:fetch` | 拉取后端到 `.api-cache/`                    |
| `npm run api:verify`| 拉取 + 真实请求验证（推荐首次接入时跑一次） |
| `npm run deps:bundle` | 从已装好的 API 目录产出依赖预置包 |
| `npm run gen:modules` | 重新生成接口名清单（需提供 API 源码）     |
| `npm run check:css` | 校验 CSS 变量引用                           |
| `npm run dist`      | 打包安装器                                  |

## 目录结构

```
.
├── src/
│   ├── shared/          主进程与渲染进程共享的类型与 IPC 契约
│   │   ├── types.ts         领域模型 + 设置项
│   │   ├── ipc.ts           通道名 + NcmBridge 接口
│   │   └── moduleNames.ts   接口名清单（随仓库提交，见下）
│   ├── main/            主进程
│   │   ├── api/fetcher.ts   npm 拉取 / 校验 / 解包 / 装依赖
│   │   ├── api/loader.ts    目录解析 + require 加载 + 冷启动拉取
│   │   ├── api/invoke.ts    调用、Cookie 罐、并发闸门、重试
│   │   ├── download.ts      下载管理
│   │   ├── localMusic.ts    本地音乐扫描
│   │   ├── protocol.ts      ncmfile:// 协议（Range 支持，保证 seek 可用）
│   │   ├── windows.ts       主窗口 / 歌词窗口 / 迷你模式
│   │   ├── tray.ts          托盘
│   │   ├── shortcuts.ts     全局快捷键
│   │   ├── store.ts         settings.json / session.json
│   │   └── ipc.ts           全部 IPC handler
│   ├── preload/         contextBridge 暴露 window.ncm
│   └── renderer/
│       ├── index.html       主窗口
│       ├── lyric.html       桌面歌词窗口
│       └── src/             lib / store / components / pages / styles
├── scripts/
│   ├── fetch-api.mjs    拉取后端（可 --verify 做真实请求验证）
│   ├── gen-modules.mjs  生成接口名清单（没有 API 源码时沿用已提交清单）
│   ├── check-css-tokens.mjs
│   └── make-icon.mjs    生成应用图标（纯代码绘制 PNG，无二进制资源依赖）
├── LICENSE                  MIT（逐字保留上游版权声明）
├── THIRD-PARTY-NOTICES.md   第三方组件、出处与安全说明
└── electron-builder.yml
```

`src/shared/moduleNames.ts` 是**随仓库提交的静态清单**（壳不再携带 API 源码，无法在构建时扫描）。
它只用于类型提示与拼写校验，运行时以实际加载的 API 版本为准。
要更新它：`npm run api:fetch -- --to .api-cache` 后 `npm run gen:modules -- --from .api-cache`。

## 快捷键

| 快捷键                 | 作用                      |
| ---------------------- | ------------------------- |
| `空格`                 | 播放 / 暂停               |
| `Esc`                  | 收起全屏播放页 / 播放队列 |
| `Ctrl/Cmd + F`         | 聚焦搜索框                |
| `Ctrl/Cmd + ←/→`       | 后退 / 前进 5 秒          |
| `Ctrl/Cmd + ↑/↓`       | 音量 ±5%                  |
| `Ctrl/Cmd + Enter`     | 在评论框内发送评论        |
| 全局：媒体键           | 播放/暂停、上一首、下一首 |
| 全局：`Ctrl+Alt+Space` | 播放 / 暂停               |
| 全局：`Ctrl+Alt+←/→`   | 上一首 / 下一首           |
| 全局：`Ctrl+Alt+↑/↓`   | 音量 ±5%                  |
| 全局：`Ctrl+Alt+L`     | 喜欢当前歌曲              |
| 全局：`Ctrl+Alt+D`     | 开关桌面歌词              |

全局快捷键可在「设置 → 系统」里整体关闭，被其它程序占用的组合会被自动跳过。

## 数据落盘位置

| 内容                   | 路径                                          |
| ---------------------- | --------------------------------------------- |
| **下载的后端 API**     | `<userData>/api/versions/<version>/`（约 60MB） |
| 设置                   | `<userData>/settings.json`                    |
| 登录 Cookie 与用户资料 | `<userData>/session.json`                     |
| 下载记录               | `<userData>/downloads.json`                   |
| 本地音乐索引           | `<userData>/local-tracks.json`                |
| 本地封面缓存           | `<userData>/local-cover/`                     |
| 日志                   | `<userData>/logs/main.log`                    |
| 下载的歌曲             | 默认 `音乐/Teas Music Player`，可在设置里改   |

`userData` 在 Windows 上是 `%APPDATA%/Teas Music Player`。

> 曾用名为 NCM-Desktop，改名时会在启动阶段做一次性迁移：
> 若新目录不存在而旧目录（`%APPDATA%/NCM-Desktop`）存在，就整体改名过去，
> 因此登录态、设置、本地曲库与播放记录都不会丢。迁移失败时退回「复制」，旧目录保留。

## 实现时踩过的坑（改动相关代码前请先看）

1. **Windows 上不能直接 `spawn('npm.cmd')`**：Node 24 起抛 `EINVAL`（批处理必须经 cmd.exe）；
   用 `shell: true` 虽能跑，但把未转义参数交给 shell（DEP0190，注入面）。
   正确姿势是 `node <npm-cli.js>`，且 Electron 下的路径要额外上溯三层
   （`electron.exe` 在 `node_modules/electron/dist/`，npm 在它的上级 `node_modules/`）。
2. **在 Electron 里用 `process.execPath` 跑子进程，必须带 `ELECTRON_RUN_AS_NODE=1`**，
   否则它会去开窗口而不是执行脚本（冒烟测试曾因此拿到空输出）。
3. **不要自动向上查找同仓库的 API 源码**：那样「冷启动拉取」这条主路径在开发机上
   永远走不到、等于测不到。本仓库用 `NCM_API_DEV_SOURCE` 显式开启本地源码。
4. **自定义协议必须带主机名。** `standard: true` 的协议会像 http 一样折叠多余斜杠，
   `ncmfile:///D%3A%5C...` 会被解析成「主机名 = `D%3A%5C...`」再走 IDNA 编码，
   直接抛 `ERR_INVALID_URL`（`<audio>` 侧报 `Media load rejected by URL safety check`）。
   正确形态是 `ncmfile://local/<encodeURIComponent(绝对路径)>`。
5. **持久化的播放队列要在恢复时重算本地地址。** 队列写进 `settings.json`，
   里面存的 `ncmfile://` 地址会随协议格式变化而失效，所以恢复时统一由
   `window.ncm.app.localUrl(localPath)` 现算（封面同理），不要在渲染层自己拼 URL。
6. **`<audio>` 绝不能设 `crossOrigin='anonymous'`。** 网易云 CDN 不返回
   `Access-Control-Allow-Origin`，带上该属性会直接无法播放。
7. **CI/受限 shell 里若存在 `ELECTRON_RUN_AS_NODE=1`**，Electron 会退化成纯 Node，
   表现为 `Cannot read properties of undefined (reading 'isPackaged')`，
   需要 `env -u ELECTRON_RUN_AS_NODE` 再启动。

8. **tar 长文件名必须处理 PAX 扩展头。** npm 的 tarball 里超过 100 字节的路径由
   `typeflag='x'` 的 PAX 头携带，若只读那 512 字节头里的 name 字段，路径会被**静默截断**
   （例如 `encodings/tables/…` 变成 `encodings/tabl`），写入时撞上先前已建好的同名目录，
   报出极具误导性的 `EISDIR`（看起来像权限或长路径问题，其实是解析器丢了信息）。
   `openTar()` 现在会解析 `x` / `X` / `L` 三种扩展头。

## 已知限制

- **首次启动需要联网**：约 8 秒（源码 12.8MB + 依赖预置包 8.2MB）。
  若依赖预置包不可用则回退 npm（50~90 秒，且需要本机有 npm）。后续启动直接复用已装版本，秒开。
- **上游风控**：接口由网易云官方服务提供，偶发 460/风控/无版权属正常现象；播放地址取不到时
  会自动降级音质，仍失败则提示「无版权或需要会员」。
- **登录**：仅支持扫码与 Cookie 导入，不保存账号密码（上游账号密码登录接口风控较严）。
- **本地文件播放**：通过 `ncmfile://` 自定义协议提供，已实现 Range 请求，因此拖动进度条可真正 seek；
  该协议只暴露主进程明确给出过的路径。
- **下载**：仅下载你有权访问的音频流，不做任何解密或绕过会员限制。
- **云盘上传**：桌面端未实现（涉及分片上传与鉴权，建议在网页版上传后同步过来）。

## 许可

本仓库以 **MIT** 许可发布。

- [`LICENSE`](./LICENSE) 是**逐字未改**的 MIT 原文，保留上游
  `Copyright (c) 2013-2022 Binaryify` 的声明。MIT 要求在所有副本中保留该声明，
  因此这份文件不做任何追加修改（追加会导致 GitHub 无法识别许可类型）。
- [`NOTICE`](./NOTICE) 说明本项目的版权归属与所依据的上游作品。
- [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) 列出运行时拉取的上游包、
  其出处与许可，以及下载执行路径上的安全约束。

三份文件都会随安装包分发（见 `electron-builder.yml` 的 `extraResources`）。

所有音乐内容、接口与商标归网易云音乐所有，本项目与官方无关联，
仅供学习与技术研究使用，请勿用于商业用途。
