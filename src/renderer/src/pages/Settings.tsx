import { useEffect, useState, type ReactNode } from 'react'
import { useAppNavigate } from '@/lib/navigation'
import type { AppInfo, Settings, SoundLevel } from '@shared/types'
import { Icon } from '@/components/ui/Icon'
import { Cover } from '@/components/ui/Primitives'
import { QUALITY_OPTIONS } from '@/lib/constants'
import { formatBytes, imageUrl } from '@/lib/format'
import { useSettingsStore } from '@/store/settings'
import { useLocalStore } from '@/store/local'
import { useDownloadStore } from '@/store/download'
import { useAuthStore } from '@/store/auth'
import { toast } from '@/store/toast'

export default function SettingsPage(): ReactNode {
  const navigate = useAppNavigate()
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const reset = useSettingsStore((state) => state.reset)

  const folders = useLocalStore((state) => state.folders)
  const trackCount = useLocalStore((state) => state.tracks.length)
  const scanning = useLocalStore((state) => state.scanning)
  const scan = useLocalStore((state) => state.scan)
  const pickFolder = useLocalStore((state) => state.pickFolder)
  const removeFolder = useLocalStore((state) => state.removeFolder)
  const clearLocal = useLocalStore((state) => state.clear)

  const tasks = useDownloadStore((state) => state.tasks)
  const clearDownloads = useDownloadStore((state) => state.clear)

  const profile = useAuthStore((state) => state.profile)
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const logout = useAuthStore((state) => state.logout)

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [cacheSize, setCacheSize] = useState(0)

  useEffect(() => {
    void window.ncm.app.info().then(setAppInfo)
    void window.ncm.app.cacheSize().then((size) => setCacheSize(size.bytes))
  }, [])

  const selectDownloadDir = async (): Promise<void> => {
    const dir = await window.ncm.app.selectFolder()
    if (!dir) return
    await update('downloadDir', dir)
    toast.success('下载目录已更新')
  }

  const clearCache = async (): Promise<void> => {
    await window.ncm.app.clearCache()
    const size = await window.ncm.app.cacheSize()
    setCacheSize(size.bytes)
    toast.success('缓存已清理')
  }

  const toggleDesktopLyric = async (open: boolean): Promise<void> => {
    await update('desktopLyric', open)
    await window.ncm.win.setLyric(open)
  }

  return (
    <div className="page page-narrow">
      <h1 className="f-24" style={{ marginBottom: 6 }}>
        设置
      </h1>
      <p className="muted f-12" style={{ marginBottom: 22 }}>
        所有设置都会立即生效并保存在本机
      </p>

      {/* 账号 */}
      <section className="settings-section">
        <div className="settings-section-title">账号</div>
        {loggedIn && profile ? (
          <div className="row gap-12" style={{ padding: '10px 0' }}>
            <Cover src={imageUrl(profile.avatarUrl, 120)} size={52} round />
            <div className="col gap-4">
              <span className="f-14 bold">{profile.nickname}</span>
              <span className="f-12 muted">
                用户 ID {profile.userId} · 关注 {profile.follows ?? 0} · 粉丝{' '}
                {profile.followeds ?? 0}
              </span>
            </div>
            <div className="spacer" />
            <button
              type="button"
              className="btn"
              onClick={() => navigate(`/user/${profile.userId}`)}
            >
              我的主页
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void logout()}
            >
              退出登录
            </button>
          </div>
        ) : (
          <div className="row" style={{ padding: '10px 0', gap: 12 }}>
            <span className="f-12 muted">
              未登录，登录后可使用歌单同步、每日推荐、收藏等功能
            </span>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/login')}
            >
              去登录
            </button>
          </div>
        )}
      </section>

      {/* 播放 */}
      <section className="settings-section">
        <div className="settings-section-title">播放</div>

        <Row
          title="在线播放音质"
          desc="音质越高流量与缓存占用越大；歌曲不支持时会自动降级"
        >
          <select
            className="select"
            value={settings.level}
            onChange={(event) =>
              void update('level', event.target.value as SoundLevel)
            }
          >
            {QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（{option.desc}）
              </option>
            ))}
          </select>
        </Row>

        <Row title="淡入淡出" desc="切歌与暂停时平滑调整音量">
          <Switch
            checked={settings.fadeInOut}
            onChange={(value) => void update('fadeInOut', value)}
          />
        </Row>

        <Row
          title="启动时恢复上次播放"
          desc="打开应用后恢复到上次退出时的歌曲与进度"
        >
          <Switch
            checked={settings.resumeOnStart}
            onChange={(value) => void update('resumeOnStart', value)}
          />
        </Row>

        <Row title="默认播放模式">
          <select
            className="select"
            value={settings.playMode}
            onChange={(event) =>
              void update(
                'playMode',
                event.target.value as Settings['playMode'],
              )
            }
          >
            <option value="order">顺序播放</option>
            <option value="loop">列表循环</option>
            <option value="single">单曲循环</option>
            <option value="shuffle">随机播放</option>
            <option value="heart">心动模式</option>
          </select>
        </Row>
      </section>

      {/* 桌面歌词 */}
      <section className="settings-section">
        <div className="settings-section-title">桌面歌词</div>

        <Row title="开启桌面歌词" desc="在独立置顶窗口中显示当前歌词">
          <Switch
            checked={settings.desktopLyric}
            onChange={(value) => void toggleDesktopLyric(value)}
          />
        </Row>

        <Row
          title="锁定桌面歌词（鼠标穿透）"
          desc="锁定后无法拖动，也不会挡住下方窗口的点击"
        >
          <Switch
            checked={settings.lyricLocked}
            onChange={(value) => {
              void update('lyricLocked', value)
              void window.ncm.win.setLyricLock(value)
            }}
          />
        </Row>

        <Row
          title="歌词字号"
          desc={`当前 ${settings.lyricFontSize}px，也可以在歌词窗口上悬浮调整`}
        >
          <input
            type="range"
            min={16}
            max={56}
            step={2}
            value={settings.lyricFontSize}
            onChange={(event) =>
              void update('lyricFontSize', Number(event.target.value))
            }
            style={{ width: 180 }}
          />
        </Row>

        <Row
          title="歌词透明度"
          desc={`当前 ${Math.round(settings.lyricOpacity * 100)}%`}
        >
          <input
            type="range"
            min={25}
            max={100}
            step={5}
            value={Math.round(settings.lyricOpacity * 100)}
            onChange={(event) =>
              void update('lyricOpacity', Number(event.target.value) / 100)
            }
            style={{ width: 180 }}
          />
        </Row>

        <Row
          title="歌词延迟校准"
          desc={`${settings.lyricOffset > 0 ? '歌词提前' : settings.lyricOffset < 0 ? '歌词延后' : '不偏移'} ${Math.abs(settings.lyricOffset)}ms · 觉得读词慢半拍就往右调`}
        >
          <input
            type="range"
            min={-1000}
            max={1000}
            step={20}
            value={settings.lyricOffset}
            onChange={(event) =>
              void update('lyricOffset', Number(event.target.value))
            }
            style={{ width: 180 }}
          />
          <button
            type="button"
            className="text-btn"
            onClick={() => void update('lyricOffset', 0)}
          >
            归零
          </button>
        </Row>

        <Row title="显示歌词翻译">
          <Switch
            checked={settings.showTranslation}
            onChange={(value) => void update('showTranslation', value)}
          />
        </Row>

        <Row title="显示歌词音译">
          <Switch
            checked={settings.showRoman}
            onChange={(value) => void update('showRoman', value)}
          />
        </Row>
      </section>

      {/* 外观 */}
      <section className="settings-section">
        <div className="settings-section-title">外观</div>
        <Row title="主题">
          <select
            className="select"
            value={settings.theme}
            onChange={(event) =>
              void update('theme', event.target.value as Settings['theme'])
            }
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </Row>
      </section>

      {/* 本地音乐 */}
      <section className="settings-section">
        <div className="settings-section-title">本地音乐</div>
        <Row
          title="音乐文件夹"
          desc={`已扫描 ${trackCount} 首歌曲，文件夹内新增文件需重新扫描`}
        >
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void pickFolder()}
          >
            <Icon name="folder-open" size={14} /> 添加文件夹
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={scanning}
            onClick={() => void scan()}
          >
            <Icon
              name={scanning ? 'loading' : 'refresh'}
              size={14}
              className={scanning ? 'spin' : undefined}
            />
            {scanning ? '扫描中…' : '重新扫描'}
          </button>
        </Row>

        {folders.length > 0 && (
          <div className="folder-list">
            {folders.map((folder) => (
              <div className="folder-item" key={folder}>
                <Icon name="folder" size={15} />
                <span className="ellipsis" title={folder}>
                  {folder}
                </span>
                <div className="spacer" />
                <button
                  type="button"
                  className="icon-btn"
                  title="移除该文件夹"
                  onClick={() => void removeFolder(folder)}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <Row
          title="清空本地音乐库"
          desc="只清除应用内的索引，不会删除硬盘上的音乐文件"
        >
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={trackCount === 0}
            onClick={() => void clearLocal()}
          >
            清空索引
          </button>
        </Row>
      </section>

      {/* 下载 */}
      <section className="settings-section">
        <div className="settings-section-title">下载</div>

        <Row title="下载音质">
          <select
            className="select"
            value={settings.downloadLevel}
            onChange={(event) =>
              void update('downloadLevel', event.target.value as SoundLevel)
            }
          >
            {QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（{option.desc}）
              </option>
            ))}
          </select>
        </Row>

        <Row
          title="下载目录"
          desc={settings.downloadDir || '默认：音乐/Teas Music Player'}
        >
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void selectDownloadDir()}
          >
            选择目录
          </button>
          {settings.downloadDir && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void update('downloadDir', '')}
            >
              恢复默认
            </button>
          )}
        </Row>

        <Row
          title="同时保存歌词与封面"
          desc="在音频文件旁生成同名 .lrc 与 .jpg"
        >
          <Switch
            checked={settings.downloadSaveExtra}
            onChange={(value) => void update('downloadSaveExtra', value)}
          />
        </Row>

        <Row title="下载记录" desc={`当前 ${tasks.length} 条记录`}>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={tasks.length === 0}
            onClick={() => void clearDownloads(false)}
          >
            清空记录
          </button>
        </Row>
      </section>

      {/* 系统 */}
      <section className="settings-section">
        <div className="settings-section-title">系统</div>

        <Row
          title="关闭主窗口时最小化到托盘"
          desc="关闭后应用继续在后台播放，可从托盘图标重新打开"
        >
          <Switch
            checked={settings.minimizeToTray}
            onChange={(value) => void update('minimizeToTray', value)}
          />
        </Row>

        <Row title="开机自动启动" desc="以最小化方式随系统启动">
          <Switch
            checked={settings.autoLaunch}
            onChange={(value) => {
              void update('autoLaunch', value)
              void window.ncm.app.setAutoLaunch(value)
            }}
          />
        </Row>

        <Row
          title="全局快捷键"
          desc="空格播放/暂停 · Ctrl+Alt+←/→ 切歌 · Ctrl+Alt+↑/↓ 音量 · 支持媒体键"
        >
          <Switch
            checked={settings.globalShortcut}
            onChange={(value) => {
              void update('globalShortcut', value)
              void window.ncm.app.setShortcuts(value)
            }}
          />
        </Row>

        <Row
          title="清理缓存"
          desc={`封面与音频缓存：${formatBytes(cacheSize)}`}
        >
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void clearCache()}
          >
            清理缓存
          </button>
        </Row>
      </section>

      {/* 关于 */}
      <section className="settings-section">
        <div className="settings-section-title">关于</div>
        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-key">应用版本</span>
            <span>v{appInfo?.version ?? '—'}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">运行环境</span>
            <span>
              Electron {appInfo?.electron ?? '—'} · Chromium{' '}
              {appInfo?.chrome ?? '—'} · Node {appInfo?.node ?? '—'}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-key">API 源码</span>
            <span className="ellipsis" title={appInfo?.apiRoot}>
              {appInfo?.apiRoot ?? '—'}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-key">数据目录</span>
            <span className="ellipsis" title={appInfo?.paths.userData}>
              {appInfo?.paths.userData ?? '—'}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-key">下载目录</span>
            <span className="ellipsis" title={appInfo?.paths.download}>
              {appInfo?.paths.download ?? '—'}
            </span>
          </div>
        </div>

        <div className="row gap-8" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              appInfo && void window.ncm.app.openPath(appInfo.paths.userData)
            }
          >
            <Icon name="folder-open" size={14} /> 打开数据目录
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              appInfo && void window.ncm.app.openPath(appInfo.paths.download)
            }
          >
            <Icon name="download" size={14} /> 打开下载目录
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => void reset()}
          >
            恢复默认设置
          </button>
        </div>
      </section>
    </div>
  )
}

function Row({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span className="settings-label-title">{title}</span>
        {desc && <span className="settings-label-desc">{desc}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  )
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={checked ? 'switch switch-on' : 'switch'}
      onClick={() => onChange(!checked)}
    />
  )
}
