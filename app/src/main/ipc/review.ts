// [main · 桥接层 · import 'electron']
// review.run IPC handler。
// renderer 点 Review 按钮 → 这里 spawn `claude -p` 在 workspace 目录跑 review,
// 返回 markdown 建议 + session id(后续"在终端继续"用)。

import { ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import type { StorageAdapter } from '../storage/adapter'
import { runReview } from '../review/runner'
import { vcsFor } from '../vcs/registry'
import { agentIdFromEvent } from './context'

export function registerReviewIpc(storage: StorageAdapter) {
  ipcMain.handle(IPC.REVIEW_RUN, async (event, workspaceId: string) => {
    const agentId = agentIdFromEvent(event)
    const wsPath = await storage.resolveWorkspacePath(agentId, workspaceId)
    // 每次都 fresh session(review 是系统调用,用完即弃)
    const result = await runReview({ workspacePath: wsPath })

    // emit review.surfaced 进 events.jsonl,timeline 留痕「review 在 T 时刻产了建议」。
    // 内联 await:emit 当前就一次 jsonl append,~1ms 不会让 IPC 显著延迟。
    if (result.ok) {
      try {
        const vcs = await vcsFor(wsPath)
        const firstLine = result.suggestion?.split('\n').find((l) => l.trim()) ?? ''
        await vcs.emit({
          source: 'review',
          action: 'surfaced',
          meta: {
            summary: `review: ${firstLine.slice(0, 80) || 'no pattern found'}`,
            sessionId: result.sessionId,
            durationMs: result.durationMs,
          },
        })
      } catch (e) {
        console.warn('[ipc/review] emit review.surfaced failed:', (e as Error).message)
      }
    }

    return result
  })
}
