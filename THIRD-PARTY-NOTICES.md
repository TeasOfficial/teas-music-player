# 第三方组件与出处声明

本仓库（Teas Music Player 桌面薄壳）**不包含**网易云音乐 API 服务端源码。
它在首次启动时从 npm 拉取上游项目并在本地加载运行。相关出处、许可与安全说明如下。

## 1. 上游项目（运行时依赖，从 npm 拉取）

| 项目 | 说明 | 许可 |
|---|---|---|
| [`@neteasecloudmusicapienhanced/api`](https://www.npmjs.com/package/@neteasecloudmusicapienhanced/api) | 网易云音乐第三方 Node.js API（441+ 接口）。本应用的全部音乐接口能力由它提供 | MIT |
| [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) | 上述 npm 包的源码仓库（原作者 MoeFurina，自原版 v4.28.0 起自行维护） | MIT |
| [Binaryify/NeteaseCloudMusicApi](https://github.com/binaryify/NeteaseCloudMusicApi) | 最初的网易云音乐 Node.js API 项目，上面两者的共同基础 | MIT |

### MIT 许可义务的履行方式

MIT 许可要求「在软件的所有副本中保留上述版权声明与许可声明」。因此：

1. 本仓库的 [`LICENSE`](./LICENSE) 逐字保留了上游的版权行 `Copyright (c) 2013-2022 Binaryify` 与 MIT 全文；
2. 安装包（electron-builder `extraResources`）会同时带上 `LICENSE` 与本文件，用户可在安装目录查看；
3. 应用内「设置 → 关于/许可证」指向安装目录下的这两份文件。

## 2. 关于「运行时拉取并执行远端代码」

本应用的设计是：壳（本仓库）与后端 API（上游 npm 包）**分离发布**，壳在首次启动时下载并
在主进程内 `require` 运行上游代码。这确实构成一条「下载远端代码并执行」的通道，
因此我们在实现上做了明确约束（见 `src/main/api/fetcher.ts`）：

- **只从 npm registry 的元数据取地址**：不拼接、不猜测 URL；
- **只接受 semver 形状的版本号**，不接受任意字符串或 tag 表达式；
- **强制完整性校验**：使用 registry 提供的 `dist.integrity`（sha512），不匹配即拒绝解包；
- **绝不执行包内脚本**：依赖安装固定带 `--ignore-scripts`；
- **解包拒绝路径逃逸**：绝对路径与含 `..` 的条目直接丢弃；
- **装完必须自检**：目录结构校验 + `require` 冒烟 + 全部接口可调用，任一不过即整份删除；
- **可回退**：版本按目录隔离（`<userData>/api/versions/<version>`），出问题可删目录重来。

若你对此模型有顾虑，可改用环境变量 `NCM_API_ROOT` 指向你自己审计过的 API 源码副本，
应用会优先使用它、完全不下载（详见 README 的「离线/自备 API」一节）。

## 3. 其它第三方组件

桌面壳自身的直接依赖（均为 MIT 或其兼容许可）：

| 组件 | 用途 | 许可 |
|---|---|---|
| Electron | 桌面运行时 | MIT |
| React / React DOM / React Router | 界面 | MIT |
| zustand | 状态管理 | MIT |
| clsx | 类名拼接 | MIT |
| `@electron-toolkit/utils` / `@electron-toolkit/tsconfig` | Electron 工具与 TS 配置 | MIT |
| music-metadata | 本地音乐元数据与封面解析 | MIT |
| electron-vite / Vite / electron-builder / TypeScript | 构建与打包 | MIT |

上游 API 运行时的依赖（axios、express、crypto-js、node-forge、jsdom、pac-proxy-agent、tunnel 等）
随上游包一起由 npm 安装，其许可与版权声明见各自包内的 LICENSE 文件。

## 4. 免责声明

本项目为第三方客户端，与网易云音乐官方无任何关联，也未获其授权或认可。
接口能力来自社区对公开客户端的逆向实现，仅供学习与技术研究使用。
使用者需自行承担因使用本软件产生的一切后果，并遵守所在地法律法规与网易云音乐的服务条款。
