// [main · 桥接层 · import 'electron']
// Workspace 相关 IPC handler。所有方法隐含 agentId(当前 window 绑的那个)。

import { ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import type { CreateWorkspaceArgs } from '@shared/types'
import { WorkspaceService } from '../agent/workspace'
import { agentIdFromEvent } from './context'

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
}
