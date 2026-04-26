// [main · 桥接层 · import 'electron']
// IPC handler 注册入口。所有 handler 在这里集中注册,便于审计。
// 在 app.whenReady() 后、创建第一个 window 之前调 registerAllIpc()。

import { ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import { AgentRegistry } from '../agent/registry'
import { SessionService } from '../agent/session'
import type { StorageAdapter } from '../storage/adapter'
import { registerAgentIpc } from './agent'
import { registerSessionIpc } from './session'
import { registerTabIpc } from './tab'
import { registerFileIpc } from './file'

export interface IpcDeps {
  registry: AgentRegistry
  sessions: SessionService
  storage: StorageAdapter
}

export function registerAllIpc(deps: IpcDeps) {
  // smoke test (保留)
  ipcMain.handle(IPC.PING, () => ({ pong: true, at: new Date().toISOString() }))

  registerAgentIpc(deps.registry)
  registerSessionIpc(deps.sessions)
  // tab handler 是全局注册,每个窗口的 TabManager 在 main/index.ts 里 registerTabManager 单独挂入
  registerTabIpc()
  registerFileIpc(deps.storage)
}
