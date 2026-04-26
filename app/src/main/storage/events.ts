// [main · 纯业务, 不 import 'electron']
// Session 级事件流:所有跨 tab 动作(focus / open / close)+ 各 tab 内动作
// (navigate / request / exec / chat-turn...)汇入 `<sessionPath>/.silent/events.jsonl`。
// 单一时间线,append-only。

import type { SessionEvent } from '@shared/types'
import { appendLine } from './jsonl'
import * as P from './paths'

/** 直接给 wsPath 版本 —— 调用方(TabManager / ipc handler)先 resolveSessionPath */
export async function appendEventAt(
  wsPath: string,
  evt: Omit<SessionEvent, 'ts'> & { ts?: string },
): Promise<void> {
  const full: SessionEvent = {
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
 * 便捷版: 传 agentId + sessionId, 由 resolver 拿 wsPath。
 * @param resolver 通常是 `storage.resolveSessionPath.bind(storage)`
 */
export async function appendSessionEvent(
  resolver: (agentId: string, sessionId: string) => Promise<string>,
  agentId: string,
  sessionId: string,
  evt: Omit<SessionEvent, 'ts'> & { ts?: string },
): Promise<void> {
  const wsPath = await resolver(agentId, sessionId)
  await appendEventAt(wsPath, evt)
}
