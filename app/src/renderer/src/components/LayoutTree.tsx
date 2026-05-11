// [renderer]
// LayoutTree —— 递归渲染 LayoutNode 树:叶子用 <Pane>,内部 split 节点拆 row/column。
//
// 每个 split 节点自己持有一个 .split-divider(横向 split → vertical 灰线;纵向 split → horizontal 灰线),
// 拖动调本 split 的 ratio。

import { useCallback, useRef } from 'react'
import type { LayoutNode, TabMeta } from '@shared/types'
import Pane from './Pane'
import type { ContextMenuChoice, TabDropPayload } from './TabBar'
import type { DropZone } from './Pane'

export interface LayoutTreeProps {
  node: LayoutNode
  allTabs: TabMeta[]
  workspaceId: string
  /** 在整棵树里,哪个 pane 是主 pane(承载 file tree toggle / [+] 等工作区控件) */
  primaryPaneId: string | null
  /** drag-drop 进行中 — true 时所有 browser tab 暂时卸载,让 native overlay 不挡 drag 事件 */
  dragging: boolean
  fileTreeOpen?: boolean
  onToggleFileTree?: () => void

  // pane 操作
  onActivateTab: (paneId: string, tabId: string) => void
  onCloseTab: (tabId: string) => void
  onClosePane: (paneId: string) => void
  onContextMenuAction: (choice: ContextMenuChoice, tabId: string, paneId: string) => void
  onSplitRight: (paneId: string) => void
  onSplitDown: (paneId: string) => void
  onOpenBrowser: (paneId: string, url: string) => Promise<void>
  onOpenTerminal: (paneId: string) => Promise<void>
  onOpenFile: (paneId: string) => Promise<void>
  onNewFile: (paneId: string, filename: string) => Promise<void>
  /** 跨 pane drag-drop tab → 移到 toPaneId */
  onTabDrop: (toPaneId: string, payload: TabDropPayload) => void
  /** drag-drop tab 到目标 pane 的 4 边 → 在该边拆出新 pane 装这个 tab */
  onTabDropSplit: (toPaneId: string, zone: DropZone, payload: TabDropPayload) => void

  // split 操作
  onSplitRatioChange: (splitId: string, ratio: number) => void
  onSplitRatioCommit: (splitId: string, ratio: number) => void
}

export default function LayoutTree(props: LayoutTreeProps) {
  const { node } = props

  if (node.kind === 'pane') {
    const isPrimary = node.pane.id === props.primaryPaneId
    return (
      <Pane
        pane={node.pane}
        allTabs={props.allTabs}
        workspaceId={props.workspaceId}
        isPrimary={isPrimary}
        dragging={props.dragging}
        fileTreeOpen={props.fileTreeOpen}
        onToggleFileTree={props.onToggleFileTree}
        onActivateTab={(tid) => props.onActivateTab(node.pane.id, tid)}
        onCloseTab={props.onCloseTab}
        onClosePane={() => props.onClosePane(node.pane.id)}
        onContextMenuAction={(choice, tid) =>
          props.onContextMenuAction(choice, tid, node.pane.id)
        }
        onSplitRight={() => props.onSplitRight(node.pane.id)}
        onSplitDown={() => props.onSplitDown(node.pane.id)}
        onOpenBrowser={(url) => props.onOpenBrowser(node.pane.id, url)}
        onOpenTerminal={() => props.onOpenTerminal(node.pane.id)}
        onOpenFile={() => props.onOpenFile(node.pane.id)}
        onNewFile={(name) => props.onNewFile(node.pane.id, name)}
        onTabDrop={(payload) => props.onTabDrop(node.pane.id, payload)}
        onTabDropSplit={(zone, payload) => props.onTabDropSplit(node.pane.id, zone, payload)}
      />
    )
  }

  // split 节点
  return <SplitNode {...props} node={node} />
}

function SplitNode(props: LayoutTreeProps & { node: Extract<LayoutNode, { kind: 'split' }> }) {
  const { node } = props
  const { split, children } = node
  const containerRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const latestRatioRef = useRef(split.ratio)
  latestRatioRef.current = split.ratio

  const isRow = split.direction === 'row'
  const firstPct = `${(split.ratio * 100).toFixed(2)}%`
  const secondPct = `${((1 - split.ratio) * 100).toFixed(2)}%`

  const onDividerDown = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return
      e.preventDefault()
      draggingRef.current = true
      const rect = containerRef.current.getBoundingClientRect()

      const handleMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return
        const raw = isRow
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height
        const clamped = Math.min(0.9, Math.max(0.1, raw))
        props.onSplitRatioChange(split.id, clamped)
      }
      const handleUp = () => {
        if (!draggingRef.current) return
        draggingRef.current = false
        document.removeEventListener('mousemove', handleMove)
        document.removeEventListener('mouseup', handleUp)
        document.body.style.cursor = ''
        props.onSplitRatioCommit(split.id, latestRatioRef.current)
      }
      document.addEventListener('mousemove', handleMove)
      document.addEventListener('mouseup', handleUp)
      document.body.style.cursor = isRow ? 'col-resize' : 'row-resize'
    },
    [isRow, split.id, props],
  )

  const containerClass = isRow ? 'layout-split layout-split-row' : 'layout-split layout-split-col'
  const dividerClass = isRow ? 'split-divider' : 'split-divider split-divider-horizontal'

  // 子树需要传 props,但 onSplitRatioCommit/onSplitRatioChange 等保持顶层引用 — 直接 spread
  const childProps = (childNode: LayoutNode) => ({ ...props, node: childNode })

  return (
    <div className={containerClass} ref={containerRef}>
      <div className="layout-cell" style={{ flexBasis: firstPct }}>
        <LayoutTree {...childProps(children[0])} />
      </div>
      <div className={dividerClass} onMouseDown={onDividerDown} />
      <div className="layout-cell" style={{ flexBasis: secondPct }}>
        <LayoutTree {...childProps(children[1])} />
      </div>
    </div>
  )
}
