import { useState } from 'react'

export default function PingPill() {
  const [label, setLabel] = useState('ping IPC')

  async function onPing() {
    try {
      // [renderer] window.api.ping() 是 preload 里 contextBridge 暴露的方法,
      // 内部走 ipcRenderer.invoke('ping') → main 侧 ipcMain.handle('ping') 返回结果。
      // 这里用来验证 main↔renderer 的 IPC 通路。
      const res = await window.api.ping()
      setLabel(`pong ✓ ${res.at.slice(11, 19)}`)
    } catch (err) {
      setLabel(`error: ${(err as Error).message}`)
    }
  }

  return (
    <button className="ping-pill" onClick={onPing}>
      {label}
    </button>
  )
}
