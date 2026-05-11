import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { MAIN_WINDOW_ID } from '@shared/consts'
// [renderer] 必须在 <Editor /> 挂载前完成 Monaco 本地配置,否则默认走 CDN loader,
// 会被 Electron CSP script-src 'self' 挡住导致一直 loading。
import './lib/monaco-setup'

// URL 区分主窗口 vs detached 窗口。detached 窗口由 main.detach 在创建时传入
// `?windowId=<rand>&workspaceId=<id>`,主窗口加载时 URL 没参数(走默认主模式)。
//
// Phase C 起 detached 窗口跟主窗口共用 App 组件 —— 各自渲染自己 WindowLayout.root 的
// LayoutTree,可 split / 多 tab。仅主窗口显示 LeftNav / FileTreePanel。
const params = new URLSearchParams(window.location.search)
const urlWindowId = params.get('windowId')
const urlWorkspaceId = params.get('workspaceId') ?? undefined
const isDetached = urlWindowId !== null && urlWindowId !== MAIN_WINDOW_ID

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <React.StrictMode>
    {isDetached ? (
      <App
        windowId={urlWindowId!}
        isMain={false}
        fixedWorkspaceId={urlWorkspaceId}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
