// [main · 纯业务, 不 import 'electron']
// Workspace 级事件流:所有跨 tab 动作(focus / open / close)+ 各 tab 内动作
// (navigate / request / exec / chat-turn...)汇入 `<wsPath>/.silent/events.jsonl`。
// 单一时间线,append-only。

import type { WorkspaceEvent } from '@shared/types'
import { appendLine } from './jsonl'
import * as P from './paths'

/** 直接给 wsPath 版本 —— 调用方(TabManager / ipc handler)先 resolveWorkspacePath */
export async function appendEventAt(
  wsPath: string,
  evt: Omit<WorkspaceEvent, 'ts'> & { ts?: string },
): Promise<void> {
  const full: WorkspaceEvent = {
    ts: evt.ts ?? new Date().toISOString(),
    source: evt.source,
    action: evt.action,
    tabId: evt.tabId,
    target: evt.target,
    meta: evt.meta,
  }
  await appendLine(P.workspaceEventsFile(wsPath), full)
}

/**
 * 便捷版: 传 agentId + workspaceId, 由 resolver 拿 wsPath。
 * @param resolver 通常是 `storage.resolveWorkspacePath.bind(storage)`
 */
export async function appendWorkspaceEvent(
  resolver: (agentId: string, workspaceId: string) => Promise<string>,
  agentId: string,
  workspaceId: string,
  evt: Omit<WorkspaceEvent, 'ts'> & { ts?: string },
): Promise<void> {
  const wsPath = await resolver(agentId, workspaceId)
  await appendEventAt(wsPath, evt)
}
