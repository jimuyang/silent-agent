// [main · 桥接层 · import 'electron']
// Agent 相关 IPC handler。
// ipcMain.handle 是 request-response,对应 renderer 的 ipcRenderer.invoke。
// 所有 handler 第一个参数是 IpcMainInvokeEvent,用来推出当前 window 绑的 agentId。

import { ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import { AgentRegistry } from '../agent/registry'
import { agentIdFromEvent } from './context'

export function registerAgentIpc(registry: AgentRegistry) {
  ipcMain.handle(IPC.AGENT_CURRENT, async (event) => {
    const id = agentIdFromEvent(event)
    return registry.get(id)
  })

  ipcMain.handle(IPC.AGENT_LIST, async () => {
    return registry.list()
  })
}
