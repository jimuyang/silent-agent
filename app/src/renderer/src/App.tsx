import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutNode } from '@shared/types'
import LeftNav from './components/LeftNav'
import LayoutTree from './components/LayoutTree'
import FileTreePanel from './components/FileTreePanel'
import PingPill from './components/PingPill'
import { useAgent } from './hooks/useAgent'
import { useWorkspaces } from './hooks/useWorkspaces'
import { useTabs } from './hooks/useTabs'
import { ipc } from './lib/ipc'
import type { ContextMenuChoice } from './components/TabBar'
import {
  appendTabToPane,
  closePane,
  findPaneOfTab,
  firstPane,
  moveTabToPane,
  reconcileTree,
  rootShallowEqual,
  setPaneActive,
  setSplitRatio,
  splitPaneWithTab,
} from './lib/layout-tree'

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
    activeTab,
    setActiveTabId,
    openBrowser,
    openTerminal,
    openFile,
    duplicate: duplicateTab,
    close: closeTab,
  } = useTabs(activeWorkspaceId)

  // ============ Layout state(递归 LayoutNode 树) ============
  const [root, setRoot] = useState<LayoutNode | null>(null)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const layoutLoadedRef = useRef(false)

  // 1) workspace 切换 → 拉对应 layout
  useEffect(() => {
    layoutLoadedRef.current = false
    if (!activeWorkspaceId) {
      setRoot(null)
      return
    }
    let cancelled = false
    ipc.layout
      .get(activeWorkspaceId)
      .then((l) => {
        if (cancelled) return
        setRoot(l.root ?? null)
        layoutLoadedRef.current = true
      })
      .catch((e) => console.warn('[App] layout.get failed:', e))
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  // 2) tabs 变化 → reconcile 树(派生默认 / 移除 stale / 新 tab 进 focused / 折叠空 pane)
  useEffect(() => {
    if (!activeWorkspaceId) return
    setRoot((prev) => {
      const reconciled = reconcileTree(prev, tabs, focusedPaneId)
      return prev && rootShallowEqual(prev, reconciled) ? prev : reconciled
    })
  }, [tabs, focusedPaneId, activeWorkspaceId])

  // 3) root 变化 → 落盘
  useEffect(() => {
    if (!activeWorkspaceId || !layoutLoadedRef.current || !root) return
    ipc.layout
      .set(activeWorkspaceId, { root })
      .catch((e) => console.warn('[App] layout.set root failed:', e))
  }, [root, activeWorkspaceId])

  // 4) focusedPaneId 失效 → 回落首 pane
  useEffect(() => {
    if (!root) return
    const all: string[] = []
    const walk = (n: LayoutNode) => {
      if (n.kind === 'pane') all.push(n.pane.id)
      else {
        walk(n.children[0])
        walk(n.children[1])
      }
    }
    walk(root)
    if (all.length === 0) return
    if (!focusedPaneId || !all.includes(focusedPaneId)) {
      setFocusedPaneId(all[0]!)
    }
  }, [root, focusedPaneId])

  // 5) 全局 focused tab → 同步给 useTabs(下游 file tree / focus IPC emit)
  const focusedTabId = useMemo<string | null>(() => {
    if (!root || !focusedPaneId) return null
    let found: string | null = null
    const walk = (n: LayoutNode) => {
      if (found !== null) return
      if (n.kind === 'pane') {
        if (n.pane.id === focusedPaneId) found = n.pane.activeTabId
      } else {
        walk(n.children[0])
        walk(n.children[1])
      }
    }
    walk(root)
    return found
  }, [root, focusedPaneId])
  useEffect(() => {
    setActiveTabId(focusedTabId)
  }, [focusedTabId, setActiveTabId])

  // ============ 操作(全部基于纯函数 mutator) ============

  const onActivateTab = useCallback((paneId: string, tabId: string) => {
    setRoot((prev) => (prev ? setPaneActive(prev, paneId, tabId) : prev))
    setFocusedPaneId(paneId)
  }, [])

  const onCloseTab = useCallback(
    (tabId: string) => {
      // 先调 useTabs.close(走 main 销毁 runtime + tabs.json),
      // tabs[] 变化触发 reconcile(自动 remove + 折叠空 pane)
      closeTab(tabId).catch((e) => console.warn('[App] closeTab', e))
    },
    [closeTab],
  )

  /**
   * 拆右 / 拆下 通用入口。
   *   - 源 pane 有 ≥2 tab:把 tabId 移到新 pane(源留剩下的)
   *   - 源 pane 只有这 1 个 tab:复制一份,源留原版,新 pane 装复制版
   *     (silent-chat 不可复制 → no-op)
   */
  const splitTab = useCallback(
    async (paneId: string, direction: 'row' | 'column', tabId: string) => {
      // console.log('[splitTab] called', { paneId, direction, tabId })
      if (!root) {
        // console.warn('[splitTab] no root, abort')
        return
      }
      const source = findPaneOfTab(root, tabId)
      if (!source || source.id !== paneId) {
        // console.warn('[splitTab] source mismatch', {
        //   sourceFound: !!source,
        //   sourceId: source?.id,
        //   paneId,
        // })
        return
      }
      // console.log('[splitTab] source', {
      //   id: source.id,
      //   tabIds: source.tabIds,
      //   tabCount: source.tabIds.length,
      // })

      // 普通路径:≥2 tab,直接移
      if (source.tabIds.length >= 2) {
        // console.log('[splitTab] >=2 tabs path, moving tab to new pane')
        setRoot((prev) => {
          if (!prev) return prev
          const { root: nextRoot, newPaneId } = splitPaneWithTab(
            prev,
            paneId,
            direction,
            tabId,
          )
          queueMicrotask(() => setFocusedPaneId(newPaneId))
          return nextRoot
        })
        return
      }

      // 1-tab 路径:复制后再拆。silent-chat 唯一不可复制 → 跳过。
      const orig = tabs.find((t) => t.id === tabId)
      if (!orig) {
        // console.warn('[splitTab] tab meta not found in tabs[]', tabId)
        return
      }
      if (orig.type === 'silent-chat') {
        // console.warn(
        //   '[splitTab] cannot split single silent-chat tab (silent-chat is unique per workspace)',
        // )
        return
      }
      // console.log('[splitTab] 1-tab path, duplicating', orig.type)
      let dupTab
      try {
        dupTab = await duplicateTab(tabId)
      } catch (e) {
        console.warn('[App] duplicate for split failed:', e)
        return
      }
      // console.log('[splitTab] dup created', dupTab.id, 'now splitting')
      // 乐观地把复制版加进 source pane,然后立刻把它拆到新 pane
      setRoot((prev) => {
        if (!prev) return prev
        const withDup = appendTabToPane(prev, paneId, dupTab.id)
        const { root: nextRoot, newPaneId } = splitPaneWithTab(
          withDup,
          paneId,
          direction,
          dupTab.id,
        )
        queueMicrotask(() => setFocusedPaneId(newPaneId))
        return nextRoot
      })
    },
    [root, tabs, duplicateTab],
  )

  /** 关闭整个 pane(显式删除该叶子;空 pane 用户主动收尾 / 关 last tab 后想清理) */
  const onClosePane = useCallback((paneId: string) => {
    setRoot((prev) => (prev ? closePane(prev, paneId) : prev))
  }, [])

  /**
   * window.open / target=_blank 拦截后,main 主动建的新 tab → 落到**源 tab 所在的 pane**。
   * 用 parentTabId 反查 pane 比 focusedPaneId 准:点链接的瞬间用户的 focus 不一定就在父 pane。
   */
  useEffect(() => {
    if (!activeWorkspaceId) return
    const unsubscribe = ipc.tab.onOpened((payload) => {
      if (payload.workspaceId !== activeWorkspaceId) return
      // 等 root + tabs 把 newTab 接住后(useTabs.onOpened 处理 tabs[]),把它放到对的 pane
      setRoot((prev) => {
        if (!prev) return prev
        if (!payload.parentTabId) return prev // 没父 tab 信息 → 让 reconcile 走默认
        const parentPane = findPaneOfTab(prev, payload.parentTabId)
        if (!parentPane) return prev
        return moveTabToPane(prev, parentPane.id, payload.meta.id)
      })
      // focus 跟过去
      if (payload.parentTabId) {
        setRoot((prev) => {
          if (!prev) return prev
          const parentPane = findPaneOfTab(prev, payload.parentTabId!)
          if (parentPane) setFocusedPaneId(parentPane.id)
          return prev
        })
      }
    })
    return unsubscribe
  }, [activeWorkspaceId])

  /** TabBar 右上角 ⊞ / ⊟ 按钮:把该 pane 当前 active 拆出去(走统一 splitTab 入口) */
  const onSplitRightFromButton = useCallback(
    (paneId: string) => {
      if (!root) return
      const active = listFocusedActive(root, paneId)
      if (!active) return
      void splitTab(paneId, 'row', active)
    },
    [root, splitTab],
  )

  const onSplitDownFromButton = useCallback(
    (paneId: string) => {
      if (!root) return
      const active = listFocusedActive(root, paneId)
      if (!active) return
      void splitTab(paneId, 'column', active)
    },
    [root, splitTab],
  )

  /** 右键菜单 dispatch */
  const onContextMenuAction = useCallback(
    (choice: ContextMenuChoice, tabId: string, paneId: string) => {
      if (choice === 'split-right') void splitTab(paneId, 'row', tabId)
      else if (choice === 'split-down') void splitTab(paneId, 'column', tabId)
      else if (choice === 'close') onCloseTab(tabId)
    },
    [splitTab, onCloseTab],
  )

  /** divider 拖动:实时改 split.ratio,松手统一持久化(由 root effect 处理) */
  const onSplitRatioChange = useCallback((splitId: string, ratio: number) => {
    setRoot((prev) => (prev ? setSplitRatio(prev, splitId, ratio) : prev))
  }, [])
  const onSplitRatioCommit = useCallback(() => {
    /* root 变化的 useEffect 已经会落盘,无需额外动作 */
  }, [])

  // ============ 新 tab/file/terminal/browser:进 focused pane ============
  // useTabs 内部会 setActiveTabId(newTab.id),触发 reconcile 把新 tab 落到 focused pane

  async function handleCreateWorkspace(name: string | undefined) {
    const w = await create({ name })
    setActiveWorkspaceId(w.id)
  }

  // 当前 file tab 的绝对路径(用于文件树高亮)
  const activeFilePath =
    activeTab?.type === 'file' && activeTab.path ? activeTab.path : null
  const workspaceId = activeWorkspaceId ?? 'no-workspace'

  // 主 pane(树最左/最上叶子)id —— 用来决定哪个 pane 显示 file tree toggle + [+]
  const primaryPaneId = useMemo(
    () => (root ? firstPane(root)?.id ?? null : null),
    [root],
  )

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
          <div className="layout-root">
            {root ? (
              <LayoutTree
                node={root}
                allTabs={tabs}
                workspaceId={workspaceId}
                primaryPaneId={primaryPaneId}
                fileTreeOpen={fileTreeOpen}
                onToggleFileTree={() => setFileTreeOpen((x) => !x)}
                onActivateTab={onActivateTab}
                onCloseTab={onCloseTab}
                onClosePane={onClosePane}
                onContextMenuAction={onContextMenuAction}
                onSplitRight={onSplitRightFromButton}
                onSplitDown={onSplitDownFromButton}
                onOpenBrowser={async (paneId, url) => {
                  setFocusedPaneId(paneId)
                  const newTab = await openBrowser(url)
                  // 显式把新 tab 落到目标 pane(防 reconcile 时序 race 把它放错栏)
                  setRoot((prev) =>
                    prev ? moveTabToPane(prev, paneId, newTab.id) : prev,
                  )
                }}
                onOpenTerminal={async (paneId) => {
                  setFocusedPaneId(paneId)
                  const newTab = await openTerminal()
                  setRoot((prev) =>
                    prev ? moveTabToPane(prev, paneId, newTab.id) : prev,
                  )
                }}
                onOpenFile={async (paneId) => {
                  const path = await window.api.file.pickOpen()
                  if (path) {
                    setFocusedPaneId(paneId)
                    const newTab = await openFile(path)
                    setRoot((prev) =>
                      prev ? moveTabToPane(prev, paneId, newTab.id) : prev,
                    )
                  }
                }}
                onNewFile={async (paneId, filename) => {
                  if (!activeWorkspaceId) return
                  const abs = await window.api.file.createInWorkspace(
                    activeWorkspaceId,
                    filename,
                  )
                  setFocusedPaneId(paneId)
                  const newTab = await openFile(abs)
                  setRoot((prev) =>
                    prev ? moveTabToPane(prev, paneId, newTab.id) : prev,
                  )
                }}
                onSplitRatioChange={onSplitRatioChange}
                onSplitRatioCommit={onSplitRatioCommit}
              />
            ) : (
              <div className="pane-empty">
                <div className="pane-empty-text">Loading layout…</div>
              </div>
            )}
          </div>
        </main>
      </div>

      <PingPill />
    </div>
  )
}

/** 拿某 pane 的 active tab id(给 ⊞/⊟ 按钮用) */
function listFocusedActive(root: LayoutNode, paneId: string): string | null {
  let found: string | null = null
  const walk = (n: LayoutNode) => {
    if (found) return
    if (n.kind === 'pane') {
      if (n.pane.id === paneId) found = n.pane.activeTabId
    } else {
      walk(n.children[0])
      walk(n.children[1])
    }
  }
  walk(root)
  return found
}

