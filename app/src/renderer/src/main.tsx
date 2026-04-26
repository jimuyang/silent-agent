import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
// [renderer] 必须在 <Editor /> 挂载前完成 Monaco 本地配置,否则默认走 CDN loader,
// 会被 Electron CSP script-src 'self' 挡住导致一直 loading。
import './lib/monaco-setup'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
