import { useEffect, useMemo, useState } from 'react'
import LeftNav from './components/LeftNav'
import TabBar from './components/TabBar'
import BrowserPane from './components/BrowserPane'
import TerminalPane from './components/TerminalPane'
import FilePane from './components/FilePane'
import FileTreePanel from './components/FileTreePanel'
import SilentChat from './components/SilentChat'
import PingPill from './components/PingPill'
import { useAgent } from './hooks/useAgent'
import { useSessions } from './hooks/useSessions'
import { useTabs } from './hooks/useTabs'

export default function App() {
  const { agent } = useAgent()
  const { sessions, create } = useSessions()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [fileTreeOpen, setFileTreeOpen] = useState(false)

  // 列表首次加载完 / 当前选中被删 时, 回落到第一条
  useEffect(() => {
    if (sessions.length === 0) {
      setActiveSessionId(null)
      return
    }
    if (!activeSessionId || !sessions.find((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0]!.id)
    }
  }, [sessions, activeSessionId])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )

  const {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    openBrowser,
    openTerminal,
    openFile,
    close: closeTab,
  } = useTabs(activeSessionId)

  async function handleCreateSession(name: string | undefined) {
    const s = await create({ type: 'chat', name })
    setActiveSessionId(s.id)
  }

  // 当前 file tab 的绝对路径(用于文件树高亮)
  const activeFilePath =
    activeTab?.type === 'file' && activeTab.path ? activeTab.path : null

  return (
    <div className="app">
      <div className="titlebar">
        <span className="title">{agent?.name ?? 'Silent Agent'}</span>
        {activeSession && (
          <span className="title-meta">
            › {activeSession.name}
            {activeTab && activeTab.type !== 'silent-chat' && (
              <> › {activeTab.title}</>
            )}
          </span>
        )}
      </div>

      <div className="main">
        <LeftNav
          agent={agent}
          sessions={sessions}
          activeSessionId={activeSessionId}
          narrow={fileTreeOpen}
          onSelectSession={setActiveSessionId}
          onCreateSession={handleCreateSession}
          onToggleFileTree={() => setFileTreeOpen((x) => !x)}
        />

        {fileTreeOpen && activeSession?.path && (
          <FileTreePanel
            rootPath={activeSession.path}
            activeFilePath={activeFilePath}
            onOpenFile={async (abs) => {
              await openFile(abs)
            }}
          />
        )}

        <main className="center">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            fileTreeOpen={fileTreeOpen}
            onToggleFileTree={() => setFileTreeOpen((x) => !x)}
            onFocusTab={setActiveTabId}
            onCloseTab={closeTab}
            onOpenBrowser={async (url) => {
              await openBrowser(url)
            }}
            onOpenTerminal={async () => {
              await openTerminal()
            }}
            onOpenFile={async () => {
              const path = await window.api.file.pickOpen()
              if (path) await openFile(path)
            }}
            onNewFile={async (filename) => {
              if (!activeSessionId) return
              const abs = await window.api.file.createInSession(activeSessionId, filename)
              await openFile(abs)
            }}
          />
          <div className="pane-container">
            <ActiveTabPane
              activeTab={activeTab}
              activeSessionId={activeSessionId}
            />
          </div>
        </main>
      </div>

      <PingPill />
    </div>
  )
}

/**
 * 主区渲染。两种模式:
 *   A) activeTab 是 silent-chat(或空) — Silent Chat 独占全宽
 *   B) activeTab 是 browser/terminal/file — 左边放该 tab 内容,右边自动分栏出 Silent Chat
 */
function ActiveTabPane({
  activeTab,
  activeSessionId,
}: {
  activeTab: ReturnType<typeof useTabs>['activeTab']
  activeSessionId: string | null
}) {
  const sessionId = activeSessionId ?? 'no-session'

  // A 模式: Silent Chat 独占
  if (!activeTab || activeTab.type === 'silent-chat') {
    return <SilentChat sessionId={sessionId} />
  }

  // B 模式: 左工作 tab + 右 Silent Chat 分栏
  return (
    <div className="split">
      <div className="split-left">
        <WorkTabContent tab={activeTab} />
      </div>
      <div className="split-divider" />
      <div className="split-right">
        <SilentChat sessionId={sessionId} />
      </div>
    </div>
  )
}

function WorkTabContent({ tab }: { tab: import('@shared/types').TabMeta }) {
  switch (tab.type) {
    case 'browser':
      return <BrowserPane />
    case 'terminal':
      return <TerminalPane tab={tab} />
    case 'file':
      return <FilePane tab={tab} />
    default:
      return null
  }
}
