import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from './logger'

/**
 * 应用名：决定窗口默认标题、托盘名，以及最关键的 —— userData 目录
 * （Windows 上是 `%APPDATA%/Teas Music Player`）。
 */
export const APP_NAME = 'Teas Music Player'

/** 改名前的旧应用名，用于一次性迁移用户数据 */
const LEGACY_APP_NAME = 'NCM-Desktop'

/**
 * 迁移完成标记。
 * 不能拿「新目录里有没有数据文件」当判断依据 —— electron-store 等模块
 * 会立刻写出一份空白 settings.json，看起来就像已经有数据了。
 * 用一次性标记最明确：迁移过就不再重复。
 */
const MIGRATED_MARKER = '.migrated-from-ncm-desktop'

app.setName(APP_NAME)

/**
 * 把旧的 userData 迁到新目录。
 *
 * 应用名一改，`app.getPath('userData')` 就指向新目录；不迁移的话，
 * 登录态、设置、本地曲库、播放记录都会「消失」（其实是留在旧目录里）。
 *
 * 逐个条目复制、跳过新目录里已存在的条目：Chromium 提前建好的缓存目录留着用，
 * 而 session.json / settings.json / local-tracks.json 这些只会存在于旧目录，
 * 会被正常带过来。旧目录一律保留，不做删除。
 */
function migrateLegacyUserData(): void {
  try {
    const target = app.getPath('userData')
    const marker = path.join(target, MIGRATED_MARKER)
    if (fs.existsSync(marker)) return

    const legacy = path.join(app.getPath('appData'), LEGACY_APP_NAME)
    if (!fs.existsSync(legacy)) return

    let copied = 0
    for (const entry of fs.readdirSync(legacy)) {
      const from = path.join(legacy, entry)
      const to = path.join(target, entry)
      if (fs.existsSync(to)) continue
      fs.cpSync(from, to, { recursive: true })
      copied += 1
    }
    fs.writeFileSync(marker, new Date().toISOString())
    logger.info(
      `[migrate] 已从 ${LEGACY_APP_NAME} 迁移 ${copied} 项用户数据到 ${APP_NAME}`,
    )
  } catch (error) {
    logger.warn(
      `[migrate] 用户数据迁移失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 这段代码必须早于任何会触碰 userData 的模块执行。
 *
 * electron-store（`./store`）等单例在**模块加载时**就解析了 userData 路径，
 * 一旦它们在迁移之前被导入，新目录会先被创建出来，迁移就会被静默跳过。
 * 所以本模块在 index.ts 里是第一条 import，不要移动它的位置。
 */
migrateLegacyUserData()
