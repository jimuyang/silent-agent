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
import { useWorkspaces } from './hooks/useWorkspaces'
import { useTabs } from './hooks/useTabs'

export default function App() {
  const { agent } = useAgent()
  const { workspaces, create } = useWorkspaces()
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [fileTreeOpen, setFileTreeOpen] = useState(false)

  // 列表首次加载完 / 当前选中被删 时, 回落到第一条
  useEffect(() => {
    if (workspaces.length === 0) {
      setActiveWorkspaceId(null)
      return
    }
    if (!activeWorkspaceId || !workspaces.find((w) => w.id === activeWorkspaceId)) {
      setActiveWorkspaceId(workspaces[0]!.id)
    }
  }, [workspaces, activeWorkspaceId])

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
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
  } = useTabs(activeWorkspaceId)

  async function handleCreateWorkspace(name: string | undefined) {
    const w = await create({ name })
    setActiveWorkspaceId(w.id)
  }

  // 当前 file tab 的绝对路径(用于文件树高亮)
  const activeFilePath =
    activeTab?.type === 'file' && activeTab.path ? activeTab.path : null

  return (
    <div className="app">
      <div className="titlebar">
        <span className="title">{agent?.name ?? 'Silent Agent'}</span>
        {activeWorkspace && (
          <span className="title-meta">
            › {activeWorkspace.name}
            {activeTab && activeTab.type !== 'silent-chat' && (
              <> › {activeTab.title}</>
            )}
          </span>
        )}
      </div>

      <div className="main">
        <LeftNav
          agent={agent}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          narrow={fileTreeOpen}
          onSelectWorkspace={setActiveWorkspaceId}
          onCreateWorkspace={handleCreateWorkspace}
          onToggleFileTree={() => setFileTreeOpen((x) => !x)}
        />

        {fileTreeOpen && activeWorkspace?.path && (
          <FileTreePanel
            rootPath={activeWorkspace.path}
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
              if (!activeWorkspaceId) return
              const abs = await window.api.file.createInWorkspace(activeWorkspaceId, filename)
              await openFile(abs)
            }}
          />
          <div className="pane-container">
            <ActiveTabPane
              activeTab={activeTab}
              activeWorkspaceId={activeWorkspaceId}
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
  activeWorkspaceId,
}: {
  activeTab: ReturnType<typeof useTabs>['activeTab']
  activeWorkspaceId: string | null
}) {
  const workspaceId = activeWorkspaceId ?? 'no-workspace'

  // A 模式: Silent Chat 独占
  if (!activeTab || activeTab.type === 'silent-chat') {
    return <SilentChat workspaceId={workspaceId} />
  }

  // B 模式: 左工作 tab + 右 Silent Chat 分栏
  return (
    <div className="split">
      <div className="split-left">
        <WorkTabContent tab={activeTab} />
      </div>
      <div className="split-divider" />
      <div className="split-right">
        <SilentChat workspaceId={workspaceId} />
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
