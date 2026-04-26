// [main · 桥接层 · import 'electron']
// Session 相关 IPC handler。所有方法隐含 agentId(当前 window 绑的那个)。

import { ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import type { CreateSessionArgs } from '@shared/types'
import { SessionService } from '../agent/session'
import { agentIdFromEvent } from './context'

export function registerSessionIpc(sessions: SessionService) {
  ipcMain.handle(IPC.SESSION_LIST, async (event) => {
    return sessions.list(agentIdFromEvent(event))
  })

  ipcMain.handle(IPC.SESSION_CREATE, async (event, args: CreateSessionArgs) => {
    return sessions.create(agentIdFromEvent(event), args)
  })

  ipcMain.handle(
    IPC.SESSION_ADD_WORKSPACE,
    async (event, payload: { path: string; name?: string }) => {
      return sessions.addWorkspace(
        agentIdFromEvent(event),
        payload.path,
        payload.name,
      )
    },
  )

  ipcMain.handle(
    IPC.SESSION_RENAME,
    async (event, payload: { id: string; name: string }) => {
      return sessions.rename(agentIdFromEvent(event), payload.id, payload.name)
    },
  )

  ipcMain.handle(IPC.SESSION_DELETE, async (event, id: string) => {
    return sessions.delete(agentIdFromEvent(event), id)
  })

  ipcMain.handle(IPC.SESSION_LOAD_MESSAGES, async (event, id: string) => {
    return sessions.loadMessages(agentIdFromEvent(event), id)
  })
}
