import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutNode, TabMeta, WorkspaceLayout } from '@shared/types'
import { MAIN_WINDOW_ID } from '@shared/consts'
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
  collapseEmptyPanes,
  findPaneOfTab,
  firstPane,
  moveTabToPane,
  reconcileTree,
  removeTabFromTree,
  rootShallowEqual,
  setPaneActive,
  setSplitRatio,
  splitPaneInsertTab,
  splitPaneWithTab,
} from '@shared/layout-tree'
import type { DropZone } from './components/Pane'

/**
 * App 同时承担主窗口和 detached 窗口两种身份。
 *
 *  - 主窗口:windowId='window-main',isMain=true,workspaceId 由用户选(LeftNav 切),
 *    渲染 LeftNav / FileTreePanel / WorkspaceSwitcher
 *  - detached:windowId='window-<rand>',isMain=false,workspaceId 启动时由 URL 给死,
 *    不显示 LeftNav,只渲染自己 WindowLayout.root 的 LayoutTree(可 split / 多 tab)
 */
export interface AppProps {
  windowId?: string
  isMain?: boolean
  /** detached 模式启动 URL 锁死 workspaceId,主窗口走 useWorkspaces 自动选 */
  fixedWorkspaceId?: string
}

export default function App({
  windowId = MAIN_WINDOW_ID,
  isMain = true,
  fixedWorkspaceId,
}: AppProps = {}) {
  const { agent } = useAgent()
  const { workspaces, create } = useWorkspaces()
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    fixedWorkspaceId ?? null,
  )
  const [fileTreeOpen, setFileTreeOpen] = useState(false)

  // 列表首次加载完 / 当前选中被删 时, 回落到第一条(仅主窗口;detached 锁死 fixedWorkspaceId)
  useEffect(() => {
    if (!isMain) return
    if (workspaces.length === 0) {
      setActiveWorkspaceId(null)
      return
    }
    if (!activeWorkspaceId || !workspaces.find((w) => w.id === activeWorkspaceId)) {
      setActiveWorkspaceId(workspaces[0]!.id)
    }
  }, [workspaces, activeWorkspaceId, isMain])

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  )

  // ============ Layout state(递归 LayoutNode 树) ============
  const [root, setRoot] = useState<LayoutNode | null>(null)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const layoutLoadedRef = useRef(false)

  // drag-drop 期间临时卸载 browser WC —— Electron WebContentsView 是 native overlay,
  // 盖住 pane body 时会拦截 dragover/drop 事件。dragstart 时 setDragging(true) → TabContent
  // 不渲染 BrowserPane → unmount 触发 hideTab → WC OFFSCREEN → React DOM 暴露,drag 事件
  // 正常 fire。drag 结束后 setDragging(false) → 重 mount → setBoundsFor → WC 回原位。
  //
  // 监听 dragend(取消 drag)+ drop(成功 drop)双兜底:成功 drop 时源 tab 会因为 React
  // 重渲染而 unmount(被移到别的 pane),dragend 事件可能丢失(源元素被删时不 fire);
  // drop 事件 bubble 到 document 一定到,所以两个都听确保 dragging 一定能复位。
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('application/x-silent-tab')) {
        setDragging(true)
      }
    }
    const reset = () => setDragging(false)
    document.addEventListener('dragstart', onDragStart)
    document.addEventListener('dragend', reset)
    document.addEventListener('drop', reset)
    return () => {
      document.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('dragend', reset)
      document.removeEventListener('drop', reset)
    }
  }, [])

  // === refs:reconcile 用最新值,绕开 useEffect 闭包的 stale snapshot 问题 ===
  //
  // 背景:reconcile useEffect 的闭包(tabs / focusedPaneId)是调度时的 snapshot,但
  // setRoot 的 functional updater 的 prev 是执行时的最新 state。两者错位会让 cleanNode
  // 拿"旧 tabs + 新 prev"运行,把 onLayoutLoaded 写进的 pane.tabIds 当 stale 摘掉。
  //
  // 用 ref + render-phase 写入,**但仍不够**:setRoot 和 setTabs 跨 Electron IPC promise
  // 不一定 batch,setRoot 先 commit 时,tabsRef 也没更新到 list。所以 onLayoutLoaded
  // 还要**手动 seed tabsRef.current = list**(在 setRoot 之前),双保险。
  const tabsRef = useRef<TabMeta[]>([])
  const focusedPaneIdRef = useRef<string | null>(null)

  // 1) workspace 切换:tabs 跟 layout 通过 useTabs 一次 IPC 原子拿回。
  //    多窗口模型(Phase B/C):layout.windows[] 数组,按 windowId 取自己那条
  const onLayoutLoaded = useCallback(
    (layout: WorkspaceLayout, list: TabMeta[]) => {
      const myWin = layout.windows.find((w) => w.id === windowId) ?? null
      // 关键:seed tabsRef,防止 reconcile 在 setTabs commit 之前跑、把 myWin.root.tabIds 摘空
      tabsRef.current = list
      setRoot(myWin?.root ?? null)
      layoutLoadedRef.current = true
    },
    [windowId],
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
  } = useTabs(activeWorkspaceId, { onLayoutLoaded })

  // render-phase 同步 ref。**关键 guard**:不能用空 tabs 覆盖 onLayoutLoaded 刚 seed 的非空 list。
  // 时序:onLayoutLoaded seed = list → setRoot 触发 re-render → 此时 setTabs(list) 可能还没 commit
  // (Electron IPC 跨 batch),所以 `tabs` state 在这次 re-render 里还是 `[]` → 如果无脑覆盖,
  // 就把 seed 抹掉了 → reconcile 又拿到空 ref → 老 bug 复现。
  // workspace 有 silent-chat pinned,正常状态下 tabs.length 永远 ≥ 1;空 = 状态没就绪,保留 seed。
  if (tabs.length > 0) tabsRef.current = tabs
  focusedPaneIdRef.current = focusedPaneId

  // workspace 切换时重置 layoutLoadedRef(下次 onLayoutLoaded 触发再变 true)
  useEffect(() => {
    layoutLoadedRef.current = false
    if (!activeWorkspaceId) setRoot(null)
  }, [activeWorkspaceId])

  // 2) tabs 变化 → reconcile 树(移除 stale / 折叠空 pane)
  useEffect(() => {
    if (!activeWorkspaceId) return
    setRoot((prev) => {
      const reconciled = reconcileTree(prev, tabsRef.current, focusedPaneIdRef.current)
      return prev && rootShallowEqual(prev, reconciled) ? prev : reconciled
    })
  }, [tabs, focusedPaneId, activeWorkspaceId])

  // 3) root 变化 → 持久化到 windows[windowId].root(细粒度,多窗口并发安全)
  useEffect(() => {
    if (!activeWorkspaceId || !layoutLoadedRef.current || !root) return
    ipc.layout
      .setWindowRoot(activeWorkspaceId, windowId, root)
      .catch((e) => console.warn('[App] layout.setWindowRoot failed:', e))
  }, [root, activeWorkspaceId, windowId])

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
      else if (choice === 'detach') {
        // tab 拆到新窗口:main 起 detached BrowserWindow,WC 跨 contentView 迁移;
        // 本窗口的 layout 树同步把 tab 移除(避免主窗口 BrowserPane 把 WC 又拉回来)
        void window.api.tab.detach(tabId).catch((e) => console.warn('[App] detach', e))
        setRoot((prev) => (prev ? collapseEmptyPanes(removeTabFromTree(prev, tabId)) : prev))
      } else if (choice === 'cross-window-moved') {
        // tab 已经被拖到另一个 window,目标 window renderer 已 add 到自己 root,
        // 这里源端只需本地 remove + 折叠空 pane。persist effect 自动落盘。
        setRoot((prev) => (prev ? collapseEmptyPanes(removeTabFromTree(prev, tabId)) : prev))
      }
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

  /** 跨 pane drag-drop:把 tab 从源 pane 移到目标 pane(同 pane 由 TabBar 内部 no-op) */
  const onTabDrop = useCallback(
    (toPaneId: string, payload: { tabId: string; fromPaneId: string }) => {
      setRoot((prev) => {
        if (!prev) return prev
        // 显式 collapseEmptyPanes:moveTabToPane 可能让源 pane 变空,这里立即折叠,
        // 不依赖 reconcile useEffect 时序去清理(避免短暂空 pane 闪现 / 时序 race 漏 fold)
        return collapseEmptyPanes(moveTabToPane(prev, toPaneId, payload.tabId))
      })
      setFocusedPaneId(toPaneId)
    },
    [],
  )

  /** drag-drop 落在 pane body 4 边 → 在该边拆出新 pane 装这个 tab */
  const onTabDropSplit = useCallback(
    (toPaneId: string, zone: DropZone, payload: { tabId: string; fromPaneId: string }) => {
      const direction: 'row' | 'column' =
        zone === 'left' || zone === 'right' ? 'row' : 'column'
      const position: 'before' | 'after' =
        zone === 'left' || zone === 'top' ? 'before' : 'after'
      setRoot((prev) => {
        if (!prev) return prev
        const { root: nextRoot, newPaneId } = splitPaneInsertTab(
          prev,
          toPaneId,
          direction,
          position,
          payload.tabId,
        )
        queueMicrotask(() => setFocusedPaneId(newPaneId))
        // 同上:splitPaneInsertTab 可能把源 pane 掏空,立即 fold,不靠 reconcile 兜底
        return collapseEmptyPanes(nextRoot)
      })
    },
    [],
  )

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
        {isMain && (
          <LeftNav
            agent={agent}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            narrow={fileTreeOpen}
            onSelectWorkspace={setActiveWorkspaceId}
            onCreateWorkspace={handleCreateWorkspace}
            onToggleFileTree={() => setFileTreeOpen((x) => !x)}
          />
        )}

        {isMain && fileTreeOpen && activeWorkspace?.path && (
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
                dragging={dragging}
                fileTreeOpen={fileTreeOpen}
                onToggleFileTree={() => setFileTreeOpen((x) => !x)}
                onActivateTab={onActivateTab}
                onCloseTab={onCloseTab}
                onClosePane={onClosePane}
                onContextMenuAction={onContextMenuAction}
                onSplitRight={onSplitRightFromButton}
                onSplitDown={onSplitDownFromButton}
                onTabDrop={onTabDrop}
                onTabDropSplit={onTabDropSplit}
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

