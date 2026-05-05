// [renderer]
// Pane —— 主区里的一个独立 column,一等抽象。
//
// 一个 Pane 拥有:自己的 TabBar(只显示属于本 pane 的 tabs)+ 自己的 TabContent
// (当前 active 的 tab 内容)。在 LayoutTree 里作为叶子节点出现,可以被任意嵌套
// 的 row/column split 切分。
//
// 主 pane(树最左/最上叶子)承载工作区级控件:file tree toggle、新 tab [+]。
// 非主 pane 不显示这些(避免重复)。

import type { TabMeta, PaneMeta } from '@shared/types'
import TabBar from './TabBar'
import BrowserPane from './BrowserPane'
import TerminalPane from './TerminalPane'
import FilePane from './FilePane'
import SilentChat from './SilentChat'
import type { ContextMenuChoice } from './TabBar'

export interface PaneProps {
  pane: PaneMeta
  /** 全部 tabs(组件内部按 pane.tabIds 过滤、保持顺序) */
  allTabs: TabMeta[]
  workspaceId: string
  isPrimary: boolean
  fileTreeOpen?: boolean
  onToggleFileTree?: () => void

  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onClosePane: () => void
  onContextMenuAction: (choice: ContextMenuChoice, tabId: string) => void
  onSplitRight: () => void
  onSplitDown: () => void
  onOpenBrowser: (url: string) => Promise<void>
  onOpenTerminal: () => Promise<void>
  onOpenFile: () => Promise<void>
  onNewFile: (filename: string) => Promise<void>
}

export default function Pane(props: PaneProps) {
  const { pane, allTabs, workspaceId } = props

  // 按 pane.tabIds 顺序拿到 TabMeta(过滤掉已被关掉但 panes 还没 reconcile 的 stale id)
  const tabs: TabMeta[] = []
  for (const id of pane.tabIds) {
    const t = allTabs.find((x) => x.id === id)
    if (t) tabs.push(t)
  }

  const activeTab = tabs.find((t) => t.id === pane.activeTabId) ?? null

  return (
    <div className="pane-column">
      <TabBar
        tabs={tabs}
        activeTabId={pane.activeTabId}
        paneId={pane.id}
        showFileTreeToggle={props.isPrimary}
        showNewTabButton={props.isPrimary}
        fileTreeOpen={props.fileTreeOpen}
        onToggleFileTree={props.onToggleFileTree}
        onFocusTab={props.onActivateTab}
        onCloseTab={props.onCloseTab}
        onContextMenuAction={props.onContextMenuAction}
        onOpenBrowser={props.onOpenBrowser}
        onOpenTerminal={props.onOpenTerminal}
        onOpenFile={props.onOpenFile}
        onNewFile={props.onNewFile}
        onSplitRight={props.onSplitRight}
        onSplitDown={props.onSplitDown}
      />
      <div className="pane-body">
        {/* activeTab 为 null 时通常 reconcile 已经折叠了空 pane,这里 fallback 极少触达 */}
        {activeTab ? (
          <TabContent tab={activeTab} workspaceId={workspaceId} />
        ) : (
          <div className="pane-empty">
            <div className="pane-empty-text">空 pane(reconcile 折叠中…)</div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 通用 tab 内容渲染 — 涵盖所有 tab 类型,各 pane 共用。 */
function TabContent({ tab, workspaceId }: { tab: TabMeta; workspaceId: string }) {
  switch (tab.type) {
    case 'browser':
      // key 让 React 在切到不同 browser tab 时强制 remount,触发 BrowserPane
      // 的 unmount(hideTab)/ mount(setBoundsFor)生命周期
      return <BrowserPane key={tab.id} tabId={tab.id} />
    case 'terminal':
      return <TerminalPane tab={tab} />
    case 'file':
      return <FilePane tab={tab} />
    case 'silent-chat':
      return <SilentChat workspaceId={workspaceId} />
    default:
      return null
  }
}
