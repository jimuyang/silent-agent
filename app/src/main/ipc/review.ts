// [main · 桥接层 · import 'electron']
// review.run IPC handler。
// renderer 点 Review 按钮 → 这里 spawn `claude -p` 在 workspace 目录跑 review,
// 返回 markdown 建议 + session id(后续"在终端继续"用)。

import { ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import type { StorageAdapter } from '../storage/adapter'
import { runReview } from '../review/runner'
import { agentIdFromEvent } from './context'

export function registerReviewIpc(storage: StorageAdapter) {
  ipcMain.handle(IPC.REVIEW_RUN, async (event, workspaceId: string) => {
    const agentId = agentIdFromEvent(event)
    const wsPath = await storage.resolveWorkspacePath(agentId, workspaceId)
    // 每次都 fresh session(review 是系统调用,用完即弃)
    return runReview({ workspacePath: wsPath })
  })
}
