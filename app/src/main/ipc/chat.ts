// [main · 桥接层 · import 'electron']
// chat.* IPC handler。每个 window 一个 ChatManager,跟 TabManager 同形(windowId → manager)。

import { ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import type { ChatManager } from '../chat/manager'

const managers = new Map<number, ChatManager>()

export function registerChatManager(windowId: number, manager: ChatManager): void {
  managers.set(windowId, manager)
}

export function unregisterChatManager(windowId: number): void {
  managers.get(windowId)?.dispose()
  managers.delete(windowId)
}

function managerFor(_event: Electron.IpcMainInvokeEvent): ChatManager {
  if (managers.size === 0) throw new Error('no chat manager registered')
  // MVP 单 window:任意拿第一个。多 window 时按 sender 反查。
  const [, first] = managers.entries().next().value as [number, ChatManager]
  return first
}

export function registerChatIpc(): void {
  // spawn(idempotent):返回 workspaceId(便于 renderer 确认)
  ipcMain.handle(IPC.CHAT_SPAWN, async (event, workspaceId: string) => {
    await managerFor(event).ensure(workspaceId)
    return workspaceId
  })

  ipcMain.handle(
    IPC.CHAT_WRITE,
    (event, payload: { workspaceId: string; data: string }) => {
      const rt = managerFor(event).get(payload.workspaceId)
      if (!rt) return false
      rt.write(payload.data)
      return true
    },
  )

  ipcMain.handle(
    IPC.CHAT_RESIZE,
    (event, payload: { workspaceId: string; cols: number; rows: number }) => {
      const rt = managerFor(event).get(payload.workspaceId)
      rt?.resize(payload.cols, payload.rows)
    },
  )

  ipcMain.handle(IPC.CHAT_GET_BUFFER, (event, workspaceId: string) => {
    return managerFor(event).get(workspaceId)?.getBuffer() ?? ''
  })

  // 结构化"喂消息":text + 自动 \r 提交。MVP 接受 fragility(用户在 picker / streaming 时
  // 可能被吞;v0.2 升级到 OSC 133 prompt-ready 检测或 CC RemoteTrigger)
  ipcMain.handle(
    IPC.CHAT_INJECT,
    async (event, payload: { workspaceId: string; text: string }) => {
      const rt = await managerFor(event).ensure(payload.workspaceId)
      rt.inject(payload.text)
      return true
    },
  )

  ipcMain.handle(IPC.CHAT_KILL, (event, workspaceId: string) => {
    managerFor(event).kill(workspaceId)
  })
}
