// [shared · 纯函数 · 无 React / Electron 依赖]
// LayoutNode 树的不可变 mutator + reconcile 工具。renderer 和 main 都能用 —— main 在
// manager.detach 里需要做原子的 layout 修改(避开 renderer-main 并发 read-modify-write race)。

import type { LayoutNode, PaneMeta, SplitMeta, TabMeta } from './types'
import { SILENT_CHAT_TAB_ID } from './consts'

// ============ id 生成 ============

let __idCounter = 0
function rid(prefix: string): string {
  // 用计数器 + 时间戳前缀;简单稳定不重复(同 session 内)
  __idCounter += 1
  return `${prefix}-${Date.now().toString(36)}${__idCounter.toString(36)}`
}

export function newPaneId(): string {
  return rid('pane')
}

export function newSplitId(): string {
  return rid('split')
}

// ============ 默认派生 ============

/** 从一组 tabs 派生默认 layout 树:有 silent-chat 就拆 row split,否则单 pane */
export function deriveDefaultRoot(tabs: TabMeta[]): LayoutNode {
  const silentChat = tabs.find((t) => t.id === SILENT_CHAT_TAB_ID)
  const others = tabs.filter((t) => t.id !== SILENT_CHAT_TAB_ID)

  if (silentChat && others.length > 0) {
    return {
      kind: 'split',
      split: { id: newSplitId(), direction: 'row', ratio: 0.69 },
      children: [
        {
          kind: 'pane',
          pane: {
            id: newPaneId(),
            tabIds: others.map((t) => t.id),
            activeTabId: others[0]!.id,
          },
        },
        {
          kind: 'pane',
          pane: {
            id: newPaneId(),
            tabIds: [silentChat.id],
            activeTabId: silentChat.id,
          },
        },
      ],
    }
  }

  return {
    kind: 'pane',
    pane: {
      id: newPaneId(),
      tabIds: tabs.map((t) => t.id),
      activeTabId: tabs[0]?.id ?? null,
    },
  }
}

// ============ 遍历 / 查找 ============

/** DFS 收集所有 pane 节点(顺序 = 树深度优先) */
export function listPanes(root: LayoutNode): PaneMeta[] {
  const out: PaneMeta[] = []
  const walk = (n: LayoutNode) => {
    if (n.kind === 'pane') out.push(n.pane)
    else {
      walk(n.children[0])
      walk(n.children[1])
    }
  }
  walk(root)
  return out
}

/** 第一个 pane(最左 / 最上)— 主 pane(承载 file tree toggle 等工作区控件) */
export function firstPane(root: LayoutNode): PaneMeta | null {
  let cur: LayoutNode = root
  while (cur.kind === 'split') cur = cur.children[0]
  return cur.kind === 'pane' ? cur.pane : null
}

/** 找包含某个 tab 的 pane;不存在返回 null */
export function findPaneOfTab(root: LayoutNode, tabId: string): PaneMeta | null {
  for (const p of listPanes(root)) {
    if (p.tabIds.includes(tabId)) return p
  }
  return null
}

export function findPaneById(root: LayoutNode, paneId: string): PaneMeta | null {
  for (const p of listPanes(root)) {
    if (p.id === paneId) return p
  }
  return null
}

// ============ Pane mutator(返回新树)============

function mapPane(
  node: LayoutNode,
  paneId: string,
  fn: (p: PaneMeta) => PaneMeta,
): LayoutNode {
  if (node.kind === 'pane') {
    return node.pane.id === paneId ? { kind: 'pane', pane: fn(node.pane) } : node
  }
  return {
    kind: 'split',
    split: node.split,
    children: [
      mapPane(node.children[0], paneId, fn),
      mapPane(node.children[1], paneId, fn),
    ],
  }
}

/** 设置某 pane 的 active tab */
export function setPaneActive(
  root: LayoutNode,
  paneId: string,
  tabId: string,
): LayoutNode {
  return mapPane(root, paneId, (p) => ({ ...p, activeTabId: tabId }))
}

/** 把一个 tab id 加到目标 pane(末尾默认),并设为 active。从 pane.tabIds 已有则去重再插。 */
export function appendTabToPane(
  root: LayoutNode,
  paneId: string,
  tabId: string,
  insertAt?: number,
): LayoutNode {
  return mapPane(root, paneId, (p) => {
    const without = p.tabIds.filter((id) => id !== tabId)
    const idx = insertAt === undefined ? without.length : Math.max(0, Math.min(insertAt, without.length))
    const next = [...without.slice(0, idx), tabId, ...without.slice(idx)]
    return { ...p, tabIds: next, activeTabId: tabId }
  })
}

/** 从某个 pane 移除一个 tab id(active 自动回落到首个剩余) */
export function removeTabFromPane(
  root: LayoutNode,
  paneId: string,
  tabId: string,
): LayoutNode {
  return mapPane(root, paneId, (p) => {
    const next = p.tabIds.filter((id) => id !== tabId)
    let active = p.activeTabId
    if (active === tabId || (active && !next.includes(active))) {
      active = next[0] ?? null
    }
    return { ...p, tabIds: next, activeTabId: active }
  })
}

/** 删除某 tab id 在树中所有出现(应该只一处)+ active 兜底 */
export function removeTabFromTree(root: LayoutNode, tabId: string): LayoutNode {
  if (root.kind === 'pane') {
    const next = root.pane.tabIds.filter((id) => id !== tabId)
    let active = root.pane.activeTabId
    if (active === tabId || (active && !next.includes(active))) {
      active = next[0] ?? null
    }
    return { kind: 'pane', pane: { ...root.pane, tabIds: next, activeTabId: active } }
  }
  return {
    kind: 'split',
    split: root.split,
    children: [removeTabFromTree(root.children[0], tabId), removeTabFromTree(root.children[1], tabId)],
  }
}

// ============ Split / Collapse(返回新树)============

/**
 * 把某 pane 拆成一个 split:目标 pane 留在第一格,新 pane 放第二格。
 * `direction = 'row'`    → 在右侧拆出新 pane
 * `direction = 'column'` → 在下方拆出新 pane
 *
 * `withTabId`:把这个 tab 从源 pane 移到新 pane(必填,避免空 pane)。
 * 返回 [新树, 新 pane id](方便 caller 切焦点)。
 */
export function splitPaneWithTab(
  root: LayoutNode,
  targetPaneId: string,
  direction: 'row' | 'column',
  withTabId: string,
): { root: LayoutNode; newPaneId: string } {
  const newPid = newPaneId()
  const sid = newSplitId()

  const replace = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      if (node.pane.id !== targetPaneId) return node
      // 源 pane:剔除 withTabId,active 回落(可能变空 — 合法,空 pane 是占位状态)
      const remaining = node.pane.tabIds.filter((id) => id !== withTabId)
      const sourceActive =
        node.pane.activeTabId === withTabId
          ? remaining[0] ?? null
          : node.pane.activeTabId
      const sourcePane: PaneMeta = {
        ...node.pane,
        tabIds: remaining,
        activeTabId: sourceActive,
      }
      const newPane: PaneMeta = {
        id: newPid,
        tabIds: [withTabId],
        activeTabId: withTabId,
      }
      const split: SplitMeta = { id: sid, direction, ratio: 0.5 }
      return {
        kind: 'split',
        split,
        children: [
          { kind: 'pane', pane: sourcePane },
          { kind: 'pane', pane: newPane },
        ],
      }
    }
    return {
      kind: 'split',
      split: node.split,
      children: [replace(node.children[0]), replace(node.children[1])],
    }
  }

  return { root: replace(root), newPaneId: newPid }
}

/**
 * Drag-drop 拆分:从任意源 pane 拿出 tabId,在目标 pane 的指定方向上拆出新 pane 装它。
 *
 * direction:'row'(横向拆) / 'column'(纵向拆)
 * position: 'before'(新 pane 在左/上) / 'after'(新 pane 在右/下)
 *
 * 跟 splitPaneWithTab 区别:这个允许跨 pane(源 pane ≠ 目标 pane)。先 removeTabFromTree
 * 把 tabId 从树中所有出现去掉,然后在目标 pane 处插 split。
 */
export function splitPaneInsertTab(
  root: LayoutNode,
  targetPaneId: string,
  direction: 'row' | 'column',
  position: 'before' | 'after',
  tabId: string,
): { root: LayoutNode; newPaneId: string } {
  const newPid = newPaneId()
  const sid = newSplitId()
  const without = removeTabFromTree(root, tabId)

  const replace = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      if (node.pane.id !== targetPaneId) return node
      const newPane: PaneMeta = { id: newPid, tabIds: [tabId], activeTabId: tabId }
      const targetWrapped: LayoutNode = { kind: 'pane', pane: node.pane }
      const newWrapped: LayoutNode = { kind: 'pane', pane: newPane }
      const split: SplitMeta = { id: sid, direction, ratio: 0.5 }
      const children: [LayoutNode, LayoutNode] =
        position === 'before' ? [newWrapped, targetWrapped] : [targetWrapped, newWrapped]
      return { kind: 'split', split, children }
    }
    return {
      kind: 'split',
      split: node.split,
      children: [replace(node.children[0]), replace(node.children[1])],
    }
  }

  return { root: replace(without), newPaneId: newPid }
}

/**
 * 把某个 tab 移到目标 pane(全树范围 dedupe + 强制移动)。
 *
 * 用例:用户在 pane X 点 + 开新 tab,reconcile 可能把 newTab 落到 focusedPane(若 focused
 * 因状态更新时序还没切到 X);此函数显式把 tab 拿到 X,从其他 pane 剔除。idempotent。
 */
export function moveTabToPane(
  root: LayoutNode,
  targetPaneId: string,
  tabId: string,
): LayoutNode {
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      if (node.pane.id === targetPaneId) {
        const without = node.pane.tabIds.filter((id) => id !== tabId)
        return {
          kind: 'pane',
          pane: { ...node.pane, tabIds: [...without, tabId], activeTabId: tabId },
        }
      }
      // 其他 pane:剔除 tabId(若有)
      if (!node.pane.tabIds.includes(tabId)) return node
      const next = node.pane.tabIds.filter((id) => id !== tabId)
      let active = node.pane.activeTabId
      if (active === tabId) active = next[0] ?? null
      return { kind: 'pane', pane: { ...node.pane, tabIds: next, activeTabId: active } }
    }
    return {
      kind: 'split',
      split: node.split,
      children: [walk(node.children[0]), walk(node.children[1])],
    }
  }
  return walk(root)
}

/** 关闭某个 pane:从树中删除该叶子,父 split 替换为兄弟。 */
export function closePane(root: LayoutNode, paneId: string): LayoutNode {
  const walk = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === 'pane') {
      return node.pane.id === paneId ? null : node
    }
    const left = walk(node.children[0])
    const right = walk(node.children[1])
    if (left === null && right === null) return null
    if (left === null) return right
    if (right === null) return left
    return { kind: 'split', split: node.split, children: [left, right] }
  }
  const out = walk(root)
  // 全树都被关了 → 回到一个空 pane(防止 root 为 null)
  if (!out) return { kind: 'pane', pane: { id: newPaneId(), tabIds: [], activeTabId: null } }
  return out
}

/**
 * 折叠所有空 pane:空 pane 的 split 父节点替换为另一个非空兄弟。
 * 递归直到全树没有空 pane(或剩下一个空根)。
 */
export function collapseEmptyPanes(root: LayoutNode): LayoutNode {
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') return node
    const left = walk(node.children[0])
    const right = walk(node.children[1])
    const leftEmpty = left.kind === 'pane' && left.pane.tabIds.length === 0
    const rightEmpty = right.kind === 'pane' && right.pane.tabIds.length === 0
    if (leftEmpty && rightEmpty) {
      // 两边都空 → 留左
      return left
    }
    if (leftEmpty) return right
    if (rightEmpty) return left
    return { kind: 'split', split: node.split, children: [left, right] }
  }
  return walk(root)
}

/** 设置某 split 的比例(react 拖动 divider 时调) */
export function setSplitRatio(
  root: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  const clamped = Math.min(0.9, Math.max(0.1, ratio))
  if (root.kind === 'pane') return root
  if (root.split.id === splitId) {
    return { kind: 'split', split: { ...root.split, ratio: clamped }, children: root.children }
  }
  return {
    kind: 'split',
    split: root.split,
    children: [setSplitRatio(root.children[0], splitId, clamped), setSplitRatio(root.children[1], splitId, clamped)],
  }
}

// ============ Reconcile(全树 vs tabs[] 一致化)============

/**
 * 让树跟 tabs[] 当前状态一致:
 *   - 树为 null → 按 tabs 派生默认
 *   - 移除已不存在的 tab id
 *   - 修正 active 指向不存在的 → 回落首 / null
 *   - 新出现的 tab(在 tabs[] 但树中无)→ 进 focused pane(若不存在,放第一个)
 *   - 折叠空 pane
 */
export function reconcileTree(
  root: LayoutNode | null | undefined,
  tabs: TabMeta[],
  focusedPaneId: string | null,
): LayoutNode {
  if (!root) return deriveDefaultRoot(tabs)

  // 1) 修剪树中所有 stale tab
  const tabIdSet = new Set(tabs.map((t) => t.id))
  const cleanNode = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      const next = node.pane.tabIds.filter((id) => tabIdSet.has(id))
      let active = node.pane.activeTabId
      if (active && !next.includes(active)) active = null
      if (!active && next.length > 0) active = next[0] ?? null
      return { kind: 'pane', pane: { ...node.pane, tabIds: next, activeTabId: active } }
    }
    return {
      kind: 'split',
      split: node.split,
      children: [cleanNode(node.children[0]), cleanNode(node.children[1])],
    }
  }
  let cleaned = cleanNode(root)

  // 注:不再"自动把 tabs 里有但树里没的 tab 塞到 focused pane"。
  //
  // 多窗口模型(Phase B)起,tab 的归属由各 window 自己的 root 树决定 —— "tabs 里有但
  // 这个窗口的树里没" 正常情况就是 "属于别的 window"(detached),不该被本窗口的 reconcile
  // 拉过来。tab 创建路径(openX / duplicate / window.open 拦截)都是显式调 appendTabToPane /
  // moveTabToPane,reconcile 不再承担"补漏"职责。
  //
  // 折叠空 pane(用户偏好):
  //   - 关掉某 pane 最后一个 tab → pane 自动折叠
  //   - 1-tab pane 做 split-right/down → 源被掏空 → 折叠 → 视觉零变化(IDE 行为)
  cleaned = collapseEmptyPanes(cleaned)
  return cleaned
}

// ============ 浅比较(用于 setState 抑制无变化的 rerender)============

export function rootShallowEqual(a: LayoutNode, b: LayoutNode): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  if (a.kind === 'pane' && b.kind === 'pane') {
    return (
      a.pane.id === b.pane.id &&
      a.pane.activeTabId === b.pane.activeTabId &&
      a.pane.tabIds.length === b.pane.tabIds.length &&
      a.pane.tabIds.every((id, i) => id === b.pane.tabIds[i])
    )
  }
  if (a.kind === 'split' && b.kind === 'split') {
    return (
      a.split.id === b.split.id &&
      a.split.direction === b.split.direction &&
      a.split.ratio === b.split.ratio &&
      rootShallowEqual(a.children[0], b.children[0]) &&
      rootShallowEqual(a.children[1], b.children[1])
    )
  }
  return false
}
