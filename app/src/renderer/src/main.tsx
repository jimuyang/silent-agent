import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DetachedTabApp from './DetachedTabApp'
import './styles/global.css'
// [renderer] 必须在 <Editor /> 挂载前完成 Monaco 本地配置,否则默认走 CDN loader,
// 会被 Electron CSP script-src 'self' 挡住导致一直 loading。
import './lib/monaco-setup'

// 判断是否为 detached 模式 — main 在新开 BrowserWindow 时用 ?detached=1&tabId=...&workspaceId=...
// 加载同一 renderer bundle,只是渲染单 tab 内容。
const params = new URLSearchParams(window.location.search)
const isDetached = params.get('detached') === '1'

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (isDetached) {
  const tabId = params.get('tabId') ?? ''
  const workspaceId = params.get('workspaceId') ?? ''
  root.render(
    <React.StrictMode>
      <DetachedTabApp tabId={tabId} workspaceId={workspaceId} />
    </React.StrictMode>,
  )
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
