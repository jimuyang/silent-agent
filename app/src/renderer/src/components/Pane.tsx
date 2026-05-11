// [renderer]
// Pane —— 主区里的一个独立 column,一等抽象。
//
// 一个 Pane 拥有:自己的 TabBar(只显示属于本 pane 的 tabs)+ 自己的 TabContent
// (当前 active 的 tab 内容)。在 LayoutTree 里作为叶子节点出现,可以被任意嵌套
// 的 row/column split 切分。
//
// 主 pane(树最左/最上叶子)承载工作区级控件:file tree toggle、新 tab [+]。
// 非主 pane 不显示这些(避免重复)。

import { useRef, useState } from 'react'
import type { TabMeta, PaneMeta } from '@shared/types'
import TabBar from './TabBar'
import BrowserPane from './BrowserPane'
import TerminalPane from './TerminalPane'
import FilePane from './FilePane'
import SilentChat from './SilentChat'
import type { ContextMenuChoice, TabDropPayload } from './TabBar'

/** drag tab 悬停 pane body 4 边缘时的目标区:决定拆出新 pane 的方向 + 位置 */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** 阈值:鼠标距某边 < 25% 视为对应 edge zone;两边都符合时优先垂直边(top/bottom) */
function detectDropZone(rect: DOMRect, clientX: number, clientY: number): DropZone {
  const dx = clientX - rect.left
  const dy = clientY - rect.top
  const fx = dx / rect.width
  const fy = dy / rect.height
  if (fy < 0.25) return 'top'
  if (fy > 0.75) return 'bottom'
  if (fx < 0.25) return 'left'
  if (fx > 0.75) return 'right'
  return 'center'
}

export interface PaneProps {
  pane: PaneMeta
  /** 全部 tabs(组件内部按 pane.tabIds 过滤、保持顺序) */
  allTabs: TabMeta[]
  workspaceId: string
  isPrimary: boolean
  /** drag-drop 进行中:true 时不渲染 BrowserPane,让 native overlay 让位 drag 事件 */
  dragging: boolean
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
  /** drag-drop tab 从别的 pane 拖进来(TabBar drop = center) */
  onTabDrop: (payload: TabDropPayload) => void
  /** drag-drop 落在 pane body 的边缘 → 在该边拆出新 pane 装这个 tab */
  onTabDropSplit: (zone: DropZone, payload: TabDropPayload) => void
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

  // === pane body drag-drop:4 边检测 ===
  // 注:browser tab 在 pane body 上有 WebContentsView 原生 overlay 覆盖,Chromium
  // 会拦截 drag 事件,这套 dropZone 检测对 browser pane 不会触发(用户用右键 / ⊞⊟ 兜底)。
  // silent-chat / terminal / file 是纯 React DOM,完整可用。
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)

  function parseDragPayload(e: React.DragEvent): TabDropPayload | null {
    const raw = e.dataTransfer.getData('application/x-silent-tab')
    if (!raw) return null
    try {
      const p = JSON.parse(raw) as TabDropPayload
      if (
        typeof p.tabId !== 'string' ||
        typeof p.fromPaneId !== 'string' ||
        typeof p.fromWorkspaceId !== 'string'
      )
        return null
      return p
    } catch {
      return null
    }
  }

  function handleBodyDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('application/x-silent-tab')) return
    if (!bodyRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const zone = detectDropZone(
      bodyRef.current.getBoundingClientRect(),
      e.clientX,
      e.clientY,
    )
    if (zone !== dropZone) setDropZone(zone)
  }

  function handleBodyDrop(e: React.DragEvent) {
    const payload = parseDragPayload(e)
    const zone = dropZone
    setDropZone(null)
    if (!payload || !zone) return
    e.preventDefault()
    // 跨 workspace 拖拽拒绝 — 每个 window 严格绑定一个 workspace
    if (payload.fromWorkspaceId !== workspaceId) {
      console.warn('[Pane] reject cross-workspace drop:', payload.fromWorkspaceId, '→', workspaceId)
      return
    }
    if (zone === 'center') {
      // 中间 = 移动到这个 pane(同 TabBar drop;同 pane 内 no-op)
      if (payload.fromPaneId !== pane.id) props.onTabDrop(payload)
    } else {
      // 边缘 = 拆出新 pane 装这个 tab(允许同 pane 拖到自己的边缘 → 等价 ⊞⊟ 按钮)
      props.onTabDropSplit(zone, payload)
    }
  }

  return (
    <div className="pane-column">
      <TabBar
        tabs={tabs}
        activeTabId={pane.activeTabId}
        paneId={pane.id}
        workspaceId={workspaceId}
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
        onTabDrop={props.onTabDrop}
      />
      <div
        className="pane-body"
        ref={bodyRef}
        onDragOver={handleBodyDragOver}
        onDragLeave={() => setDropZone(null)}
        onDrop={handleBodyDrop}
      >
        {/* activeTab 为 null 时通常 reconcile 已经折叠了空 pane,这里 fallback 极少触达 */}
        {activeTab ? (
          <TabContent tab={activeTab} workspaceId={workspaceId} dragging={props.dragging} />
        ) : (
          <div className="pane-empty">
            <div className="pane-empty-text">空 pane(reconcile 折叠中…)</div>
          </div>
        )}
        {dropZone && <div className={`drop-zone-indicator zone-${dropZone}`} />}
      </div>
    </div>
  )
}

/** 通用 tab 内容渲染 — 涵盖所有 tab 类型,各 pane 共用。 */
function TabContent({
  tab,
  workspaceId,
  dragging,
}: {
  tab: TabMeta
  workspaceId: string
  dragging: boolean
}) {
  switch (tab.type) {
    case 'browser':
      // key 让 React 在切到不同 browser tab 时强制 remount,触发 BrowserPane
      // 的 unmount(hideTab)/ mount(setBoundsFor)生命周期。
      // dragging 时不渲染 BrowserPane → unmount 触发 hideTab → WC OFFSCREEN →
      // 把 pane body 让位给 React DOM,drag 事件可正常 fire(否则 native overlay 拦住)。
      if (dragging) {
        return (
          <div className="pane-placeholder">
            <div className="big-icon">🌐</div>
            <div className="title">{tab.title || 'browser'}</div>
            <div className="desc">drag 进行中,松手后恢复</div>
          </div>
        )
      }
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
