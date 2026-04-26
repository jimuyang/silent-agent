// [main · 桥接层 · import 'electron']
// 从 IPC event 解析出 "当前 window 绑的 agent id"。
// MVP 只有一个 window 和 default agent, 直接返回常量。
// v0.2 多 window 多 agent 时,BrowserWindow 上挂一个 meta { agentId },
// 这里用 BrowserWindow.fromWebContents(event.sender) 反查即可。

import type { IpcMainInvokeEvent } from 'electron'

const MVP_DEFAULT_AGENT = 'silent-default'

export function agentIdFromEvent(_event: IpcMainInvokeEvent): string {
  // TODO v0.2: 按 window 绑定解析,支持多 agent / 多 window
  return MVP_DEFAULT_AGENT
}
