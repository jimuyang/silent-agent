import { useCallback, useEffect, useState } from 'react'
import type { TabMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

export interface UseTabsResult {
  tabs: TabMeta[]
  activeTabId: string | null
  activeTab: TabMeta | null
  setActiveTabId: (id: string | null) => void
  openBrowser: (url: string) => Promise<TabMeta>
  openTerminal: (cwd?: string) => Promise<TabMeta>
  openFile: (path: string) => Promise<TabMeta>
  close: (tabId: string) => Promise<void>
  navigate: (tabId: string, url: string) => Promise<void>
  reload: () => Promise<void>
}

/**
 * 订阅当前 workspace 下所有 tab 的运行时状态。
 * 每个 workspace 有一个 silent-chat 类型 tab(创建 workspace 时自动 seed),是默认激活目标。
 * 切 workspace 时调 tab.switchWorkspace,让 main 端隐掉旧 workspace 的 native view、恢复新 workspace 的。
 */
export function useTabs(workspaceId: string | null): UseTabsResult {
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

  // workspace 切换:告诉 main 做运行时切换,把默认 active 设成 silent-chat tab
  useEffect(() => {
    let mounted = true
    if (!workspaceId) {
      setTabs([])
      setActiveTabId(null)
      return
    }
    ipc.tab
      .switchWorkspace(workspaceId)
      .then((list) => {
        if (!mounted) return
        setTabs(list)
        const silent = list.find((t) => t.type === 'silent-chat')
        setActiveTabId(silent?.id ?? list[0]?.id ?? null)
      })
      .catch((e) => console.error('[useTabs] switchWorkspace', e))
    return () => {
      mounted = false
    }
  }, [workspaceId])

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
    async (cwd?: string) => {
      if (!workspaceId) throw new Error('no active workspace')
      const tab = await ipc.tab.open(workspaceId, { type: 'terminal', cwd })
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

  // activeTabId 变化 → main 端 focus(内部会 hideAll + show if runtime)
  useEffect(() => {
    if (activeTabId) {
      ipc.tab.focus(activeTabId).catch((e) => console.warn('[useTabs] focus', e))
    } else {
      ipc.tab.hideAll().catch((e) => console.warn('[useTabs] hideAll', e))
    }
  }, [activeTabId])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTabId,
    openBrowser,
    openTerminal,
    openFile,
    close,
    navigate,
    reload,
  }
}
