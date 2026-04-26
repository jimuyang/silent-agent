// electron-vite 的配置。Electron 有三套代码要分别构建(main / preload / renderer),
// 这个文件就是告诉 Vite 每一套分别怎么打:
// - main / preload 跑在 Node,externalizeDepsPlugin 保留 require() 而不是打进 bundle
//   (Electron main 能直接访问 node_modules,不需要打包进去)
// - renderer 跑在 Chromium,用标准 Web Vite + React 插件

import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      // 改 src/main/** → 自动重启 Electron(否则要手动 kill dev 进程)
      watch: {},
      rollupOptions: {
        // node-pty 是 native 模块,要走运行时 require,不能被 rollup-commonjs 内联展开。
        // externalizeDepsPlugin 默认会 external dependencies,但 node-pty 由于内部用
        // dynamic require 加载 prebuilds 下的 .node 二进制,需要显式加一遍更保险。
        external: ['node-pty'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // 改 src/preload/** → 自动重载 renderer(preload 是 renderer 起来前注入的)
    build: { watch: {} },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react()],
  },
})
