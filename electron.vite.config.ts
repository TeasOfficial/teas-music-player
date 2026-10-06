import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

/**
 * 忽略编辑器/工具「原子写」留下的临时目录（形如 `.Foo.tsx.1234.abcd.tmpdir/Foo.tsx.tmp`）。
 * 不忽略时，文件监听会去 watch 这些瞬时文件，在 Windows 上会以 EBUSY 直接打挂整个 dev 进程。
 */
const watcherIgnore = ['**/node_modules/**', '**/.git/**', '**/*.tmpdir/**']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': shared,
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': shared,
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared,
      },
    },
    plugins: [react()],
    server: {
      watch: { ignored: watcherIgnore },
    },
    build: {
      chunkSizeWarningLimit: 2048,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // 桌面歌词是独立渲染进程（透明置顶窗口），需要单独入口；
          // 迷你模式复用主窗口（换路由 + 改尺寸），因此不需要额外 HTML。
          lyric: resolve(__dirname, 'src/renderer/lyric.html'),
        },
      },
    },
  },
})
