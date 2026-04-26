/// <reference types="vite/client" />

// [renderer] 声明 preload 暴露到 window 上的两个对象的 TS 类型,
// 让组件里 window.api.ping() 能有类型补全和检查。
// 运行时值由 src/preload/index.ts 在每个 renderer 启动时注入。

import type { ElectronAPI } from '@electron-toolkit/preload'
import type { SilentAgentAPI } from '../../preload/index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SilentAgentAPI
  }
}
