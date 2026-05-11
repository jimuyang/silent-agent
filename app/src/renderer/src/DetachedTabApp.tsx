// [renderer · detached window]
// 独立窗口模式:加载同一 bundle,但只渲染单个 tab 的内容,不带 LeftNav / TabBar / 分栏。
//
// 触发路径:main 端用户右键 tab → "在新窗口打开" → manager.detach(tabId) → 起新 BrowserWindow
// 加载 URL `?detached=1&tabId=X&workspaceId=Y` → 这里。
//
// browser tab 的 WebContentsView 已经被 manager.setWindow 迁移到这个 window 的 contentView。
// 我们的 BrowserPane 还是负责 setBoundsFor — main 会把 WC 摆到这个 window 里。
//
// 关窗 = close tab(main 端 detachedWin.on('closed') → manager.close)。

import { useEffect, useState } from 'react'
import type { TabMeta } from '@shared/types'
import { ipc } from './lib/ipc'
import BrowserPane from './components/BrowserPane'
import TerminalPane from './components/TerminalPane'
import FilePane from './components/FilePane'
import SilentChat from './components/SilentChat'

export default function DetachedTabApp({
  tabId,
  workspaceId,
}: {
  tabId: string
  workspaceId: string
}) {
  const [tab, setTab] = useState<TabMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tabId || !workspaceId) {
      setError('missing tabId / workspaceId in URL')
      return
    }
    ipc.tab
      .list(workspaceId)
      .then((tabs) => {
        const t = tabs.find((x) => x.id === tabId)
        if (!t) setError(`tab ${tabId} not found in workspace`)
        else setTab(t)
      })
      .catch((e) => setError((e as Error).message))
  }, [tabId, workspaceId])

  if (error) {
    return (
      <div className="detached-error">
        <div className="big-icon">⚠️</div>
        <div className="title">detached tab error</div>
        <div className="desc">{error}</div>
      </div>
    )
  }

  if (!tab) {
    return (
      <div className="detached-loading">
        <div className="title">加载中…</div>
      </div>
    )
  }

  return (
    <div className="detached-app">
      <div className="detached-titlebar">
        <span className="title">{tab.title || tab.id}</span>
      </div>
      <div className="detached-body">
        {tab.type === 'browser' && <BrowserPane tabId={tab.id} />}
        {tab.type === 'terminal' && <TerminalPane tab={tab} />}
        {tab.type === 'file' && <FilePane tab={tab} />}
        {tab.type === 'silent-chat' && <SilentChat workspaceId={workspaceId} />}
      </div>
    </div>
  )
}
