import { useCallback, useEffect, useState } from 'react'
import type { TabMeta, WorkspaceLayout } from '@shared/types'
import { ipc } from '../lib/ipc'

export interface UseTabsResult {
  tabs: TabMeta[]
  activeTabId: string | null
  activeTab: TabMeta | null
  setActiveTabId: (id: string | null) => void
  openBrowser: (url: string) => Promise<TabMeta>
  openTerminal: (cwd?: string, command?: { file: string; args: string[] }) => Promise<TabMeta>
  openFile: (path: string) => Promise<TabMeta>
  duplicate: (tabId: string) => Promise<TabMeta>
  close: (tabId: string) => Promise<void>
  navigate: (tabId: string, url: string) => Promise<void>
  reload: () => Promise<void>
}

export interface UseTabsOptions {
  /**
   * workspace 切换:tabs + layout 一次 IPC 拿回。回调里同时收到 layout 和 tabs list。
   *
   * 之前期望 setTabs + setRoot 走 React 18 auto-batching 一起 commit,实测 **不可靠**:
   * Electron IPC 跨进程 resolve 的 promise 在某些时序下,setTabs(useTabs 内)和 setRoot
   * (App 内 via onLayoutLoaded)会 commit 到不同 render,导致 setRoot 后 reconcile useEffect
   * 触发但 `tabs` state 还是空的(refs 也跟着是空)→ cleanNode 把刚 onLayoutLoaded 写进的 detached
   * pane.tabIds 全摘掉 → persist 写空 pane → detached window 看不到 tab。
   *
   * 所以把 `list` 一并传过去,App 端在 onLayoutLoaded 里**手动 seed `tabsRef.current = list`**,
   * 不依赖 setTabs 的 commit 节奏。
   */
  onLayoutLoaded?: (layout: WorkspaceLayout, tabs: TabMeta[]) => void
}

/**
 * 订阅当前 workspace 下所有 tab 的运行时状态。
 * 每个 workspace 有一个 silent-chat 类型 tab(创建 workspace 时自动 seed),是默认激活目标。
 * 切 workspace 时调 tab.switchWorkspace,让 main 端隐掉旧 workspace 的 native view、恢复新 workspace 的,
 * 同时一次拿回 tabs 和 layout(原子加载,杜绝独立 IPC 之间的 race)。
 */
export function useTabs(
  workspaceId: string | null,
  options: UseTabsOptions = {},
): UseTabsResult {
  const { onLayoutLoaded } = options
  const [tabs, setTabs] = useState<TabMeta[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setTabs([])
      return
    }
    const list = await ipc.tab.list(workspaceId)
    setTabs(list)
  }, [workspaceId])

  // workspace 切换:一次 IPC 拿回 { tabs, layout },同步 setTabs + onLayoutLoaded → React 批处理
  useEffect(() => {
    let mounted = true
    if (!workspaceId) {
      setTabs([])
      setActiveTabId(null)
      return
    }
    ipc.tab
      .switchWorkspace(workspaceId)
      .then(({ tabs: list, layout }) => {
        if (!mounted) return
        setTabs(list)
        const silent = list.find((t) => t.type === 'silent-chat')
        setActiveTabId(silent?.id ?? list[0]?.id ?? null)
        // 传 list 一起过去:App 端 seed tabsRef,不依赖 setTabs 的 commit 时机
        onLayoutLoaded?.(layout, list)
      })
      .catch((e) => console.error('[useTabs] switchWorkspace', e))
    return () => {
      mounted = false
    }
  }, [workspaceId, onLayoutLoaded])

  const openBrowser = useCallback(
    async (url: string) => {
      if (!workspaceId) throw new Error('no active workspace')
      const tab = await ipc.tab.open(workspaceId, { type: 'browser', url })
      await reload()
      setActiveTabId(tab.id)
      return tab
    },
    [workspaceId, reload],
  )

  const openTerminal = useCallback(
    async (cwd?: string, command?: { file: string; args: string[] }) => {
      if (!workspaceId) throw new Error('no active workspace')
      const tab = await ipc.tab.open(workspaceId, { type: 'terminal', cwd, command })
      await reload()
      setActiveTabId(tab.id)
      return tab
    },
    [workspaceId, reload],
  )

  const openFile = useCallback(
    async (path: string) => {
      if (!workspaceId) throw new Error('no active workspace')
      const tab = await ipc.tab.open(workspaceId, { type: 'file', path })
      await reload()
      setActiveTabId(tab.id)
      return tab
    },
    [workspaceId, reload],
  )

  // 复制现有 tab(同 type / 同关键 state)。不更新 activeTabId — 由 caller(App)决定放哪。
  const duplicate = useCallback(
    async (tabId: string) => {
      if (!workspaceId) throw new Error('no active workspace')
      const newTab = await ipc.tab.duplicate(tabId)
      await reload()
      return newTab
    },
    [workspaceId, reload],
  )

  const close = useCallback(
    async (tabId: string) => {
      await ipc.tab.close(tabId)
      // 关掉后,回落到 silent-chat
      const list = await ipc.tab.list(workspaceId!)
      setTabs(list)
      if (activeTabId === tabId) {
        const silent = list.find((t) => t.type === 'silent-chat')
        setActiveTabId(silent?.id ?? list[0]?.id ?? null)
      }
    },
    [workspaceId, activeTabId],
  )

  const navigate = useCallback(async (tabId: string, url: string) => {
    await ipc.tab.navigate(tabId, url)
  }, [])

  // activeTabId 变化 → main 端 emit `tab.focus` 事件进 events.jsonl(纯观察,不动 view)。
  // view 显示由各 BrowserPane 自己 mount/unmount 驱动 setBoundsFor / hideTab,跟这里无关。
  useEffect(() => {
    if (activeTabId) {
      ipc.tab.focus(activeTabId).catch((e) => console.warn('[useTabs] focus', e))
    }
  }, [activeTabId])

  // 订阅 main 主动建 tab 的事件(目前唯一来源:browser-tab window.open 拦截)。
  // payload.workspaceId 跟当前 workspace 不一致就忽略(用户已切别处)。
  useEffect(() => {
    if (!workspaceId) return
    const unsubscribe = ipc.tab.onOpened((payload) => {
      if (payload.workspaceId !== workspaceId) return
      setTabs((prev) => (prev.some((t) => t.id === payload.meta.id) ? prev : [...prev, payload.meta]))
      setActiveTabId(payload.meta.id)
    })
    return unsubscribe
  }, [workspaceId])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    openBrowser,
    openTerminal,
    openFile,
    duplicate,
    close,
    navigate,
    reload,
  }
}
