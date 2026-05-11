// [main · 桥接层 · import 'electron']
// Tab 相关 IPC handler。
// TabManager 是每窗口一个(绑定到 BrowserWindow),所以我们存一个 Map<windowId, TabManager>。
// MVP 单 window, 直接拿 default manager 即可;预留多 window 扩展点。

import { ipcMain, Menu, BrowserWindow } from 'electron'

import { IPC } from '@shared/ipc'
import type { TabManager, OpenTabArgs } from '../tabs/manager'

export type TabTypeChoice = 'browser' | 'terminal' | 'file' | 'file-new' | null
/** 右键 tab 后的语义动作 */
export type TabContextChoice = 'split-right' | 'split-down' | 'detach' | 'close' | null

// windowId → TabManager
const managers = new Map<number, TabManager>()

export function registerTabManager(windowId: number, manager: TabManager) {
  managers.set(windowId, manager)
}

export function unregisterTabManager(windowId: number) {
  managers.get(windowId)?.dispose()
  managers.delete(windowId)
}

// 导出给其他 IPC handler 复用(workspace.openInNewWindow 也要拿 TabManager 建窗)
export function managerFor(_event: Electron.IpcMainInvokeEvent): TabManager {
  // 在多 window 时按 event.sender.getOwnerBrowserWindow().id 反查
  // MVP 单 window, 任意拿第一个就好
  if (managers.size === 0) throw new Error('no tab manager registered')
  const [, first] = managers.entries().next().value as [number, TabManager]
  return first
}

export function registerTabIpc() {
  ipcMain.handle(IPC.TAB_LIST, async (event, workspaceId: string) => {
    return managerFor(event).list(workspaceId)
  })

  ipcMain.handle(
    IPC.TAB_OPEN,
    async (event, payload: { workspaceId: string; args: OpenTabArgs }) => {
      return managerFor(event).open(payload.workspaceId, payload.args)
    },
  )

  ipcMain.handle(IPC.TAB_CLOSE, async (event, tabId: string) => {
    return managerFor(event).close(tabId)
  })

  ipcMain.handle(IPC.TAB_DUPLICATE, async (event, tabId: string) => {
    return managerFor(event).duplicate(tabId)
  })

  ipcMain.handle(IPC.TAB_DETACH, async (event, tabId: string) => {
    return managerFor(event).detach(tabId)
  })

  ipcMain.handle(IPC.TAB_FOCUS, async (event, tabId: string) => {
    return managerFor(event).focus(tabId)
  })

  ipcMain.handle(
    IPC.TAB_SET_BOUNDS_FOR,
    async (
      event,
      payload: {
        tabId: string
        bounds: { x: number; y: number; width: number; height: number }
      },
    ) => {
      managerFor(event).setBoundsFor(payload.tabId, payload.bounds)
    },
  )

  ipcMain.handle(IPC.TAB_HIDE_TAB, async (event, tabId: string) => {
    managerFor(event).hideTab(tabId)
  })

  ipcMain.handle(
    IPC.TAB_NAVIGATE,
    async (event, payload: { tabId: string; url: string }) => {
      return managerFor(event).navigate(payload.tabId, payload.url)
    },
  )

  // 切 workspace 时 renderer 主动告诉 main(hide 旧 tabs + 恢复新 tabs 的 runtime)
  ipcMain.handle(IPC.TAB_SWITCH_WORKSPACE, async (event, workspaceId: string) => {
    return managerFor(event).switchWorkspace(workspaceId)
  })

  // ----- Terminal-specific -----

  ipcMain.handle(
    IPC.TERMINAL_WRITE,
    (event, payload: { tabId: string; data: string }) => {
      const term = managerFor(event).findTerminal(payload.tabId)
      if (!term) return
      term.write(payload.data)
    },
  )

  ipcMain.handle(
    IPC.TERMINAL_RESIZE,
    (event, payload: { tabId: string; cols: number; rows: number }) => {
      const term = managerFor(event).findTerminal(payload.tabId)
      if (!term) return
      term.resize(payload.cols, payload.rows)
    },
  )

  ipcMain.handle(IPC.TERMINAL_GET_BUFFER, (event, tabId: string) => {
    const term = managerFor(event).findTerminal(tabId)
    return term?.getBuffer() ?? ''
  })

  // 弹原生 OS 菜单选新建 tab 的类型。
  // 原生菜单是 OS 级绘制,不参与 Electron 窗口的 z-index / native overlay,
  // 所以即便有 WebContentsView(browser tab)覆盖,菜单也能正常显示。
  // 在某 tab 上右键弹原生 context menu。caller 只需告诉是否可关。
  // 拆右 / 拆下永远可用(把这个 tab 拆到新 pane)。
  ipcMain.handle(
    IPC.TAB_POPUP_CONTEXT_MENU,
    async (event, payload: { canClose: boolean; canDetach?: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return null

      return await new Promise<TabContextChoice>((resolve) => {
        let chosen: TabContextChoice = null
        const items: Electron.MenuItemConstructorOptions[] = [
          {
            label: '⊞   拆到右侧 pane',
            click: () => {
              chosen = 'split-right'
            },
          },
          {
            label: '⊟   拆到下侧 pane',
            click: () => {
              chosen = 'split-down'
            },
          },
        ]
        // silent-chat / pinned tab 不显示"在新窗口打开"
        if (payload.canDetach !== false) {
          items.push({ type: 'separator' })
          items.push({
            label: '🪟   在新窗口打开',
            click: () => {
              chosen = 'detach'
            },
          })
        }
        if (payload.canClose) {
          items.push({ type: 'separator' })
          items.push({
            label: '✕   关闭 tab',
            click: () => {
              chosen = 'close'
            },
          })
        }
        const menu = Menu.buildFromTemplate(items)
        menu.on('menu-will-close', () => {
          setTimeout(() => resolve(chosen), 0)
        })
        menu.popup({ window: win })
      })
    },
  )

  ipcMain.handle(IPC.TAB_POPUP_TYPE_MENU, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    return await new Promise<TabTypeChoice>((resolve) => {
      let chosen: TabTypeChoice = null
      const menu = Menu.buildFromTemplate([
        {
          label: '🌐   浏览器',
          click: () => {
            chosen = 'browser'
          },
        },
        {
          label: '🖥   终端',
          click: () => {
            chosen = 'terminal'
          },
        },
        { type: 'separator' },
        {
          label: '📄   打开文件',
          click: () => {
            chosen = 'file'
          },
        },
        {
          label: '✨   在工作区新建文件',
          click: () => {
            chosen = 'file-new'
          },
        },
      ])
      // menu-will-close 比 item click 回调先触发,延到下 tick 等 click 写入 chosen
      menu.on('menu-will-close', () => {
        setTimeout(() => resolve(chosen), 0)
      })
      menu.popup({ window: win })
    })
  })
}
