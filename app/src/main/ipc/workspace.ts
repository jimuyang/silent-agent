// [main · 桥接层 · import 'electron']
// Workspace 相关 IPC handler。所有方法隐含 agentId(当前 window 绑的那个)。

import { ipcMain, Menu, BrowserWindow } from 'electron'

import { IPC } from '@shared/ipc'
import type { CreateWorkspaceArgs } from '@shared/types'
import { WorkspaceService } from '../agent/workspace'
import { agentIdFromEvent } from './context'
import { managerFor } from './tab'

/** workspace 行右键菜单的语义动作 */
export type WorkspaceMenuChoice = 'open-in-new-window' | null

export function registerWorkspaceIpc(workspaces: WorkspaceService) {
  ipcMain.handle(IPC.WORKSPACE_LIST, async (event) => {
    return workspaces.list(agentIdFromEvent(event))
  })

  ipcMain.handle(IPC.WORKSPACE_CREATE, async (event, args: CreateWorkspaceArgs) => {
    return workspaces.create(agentIdFromEvent(event), args)
  })

  ipcMain.handle(
    IPC.WORKSPACE_ADD,
    async (event, payload: { path: string; name?: string }) => {
      return workspaces.addWorkspace(
        agentIdFromEvent(event),
        payload.path,
        payload.name,
      )
    },
  )

  ipcMain.handle(
    IPC.WORKSPACE_RENAME,
    async (event, payload: { id: string; name: string }) => {
      return workspaces.rename(agentIdFromEvent(event), payload.id, payload.name)
    },
  )

  ipcMain.handle(IPC.WORKSPACE_DELETE, async (event, id: string) => {
    return workspaces.delete(agentIdFromEvent(event), id)
  })

  ipcMain.handle(IPC.WORKSPACE_LOAD_MESSAGES, async (event, id: string) => {
    return workspaces.loadMessages(agentIdFromEvent(event), id)
  })

  // 在新 BrowserWindow 打开 workspace —— fresh 空 pane,不影响原窗口。
  // TabManager 是单例,任意 event 拿到的都同一个;复用 detach 的 createDetachedBrowserWindow。
  ipcMain.handle(
    IPC.WORKSPACE_OPEN_IN_NEW_WINDOW,
    async (event, workspaceId: string) => {
      return managerFor(event).openWorkspaceInNewWindow(workspaceId)
    },
  )

  // 右键 workspace item 弹原生菜单(MVP 只有一项,留可扩展空间:重命名 / 在 Finder 显示 等)
  ipcMain.handle(IPC.WORKSPACE_POPUP_CONTEXT_MENU, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    return await new Promise<WorkspaceMenuChoice>((resolve) => {
      let chosen: WorkspaceMenuChoice = null
      const menu = Menu.buildFromTemplate([
        {
          label: '🪟   在新窗口打开',
          click: () => {
            chosen = 'open-in-new-window'
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
