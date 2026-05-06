// [main · 纯业务,不 import 'electron']
//
// Tier 1 auto-commit 规则引擎 + IdleTimer + Debouncer。
//
// 设计原则(design/08-vcs.md §3):
// **silent agent 默认不主动 commit**。整个 `.silent/` gitignore 后,原 4 条 Tier 1
// 规则(chat.turn-end / browser.load-finish / shell.exit)都没东西可 commit;
// 只剩 `workspace.idle` 一条**可选**(opt-in)给 worktree fork 提供干净 base。
//
// 默认行为:`DEFAULT_TIER1_RULES = []`。VCS 实例仍 git init + 写 .gitignore +
// initial commit(只追 .gitignore),emit 仍 append events.jsonl,但**不触发任何
// auto commit**。用户 / agent 想动版本走 Tier 2 显式 `vcs.commit() / branch() /
// checkout()`(由 main_chat 暴露成 `workspace.commit("<语义化 message>")` tool)。
//
// 想开 idle 兜底:`createWorkspaceVCS(path, { rules: TIER1_RULES_IDLE_ONLY })`。
//
// IdleTimer 在每次 emit 时 reset(workspace.idle 自身 emit 不 reset,防止死循环)。
// Debouncer 按 rule.key 去重:同 rule 短时间多次触发只 commit 一次。

import type { AutoCommitRule } from './interface'
import type { WorkspaceEvent } from '@shared/types'

/**
 * Idle-only opt-in 规则集:30s 没活动 + dirty → 自动 commit 用户文件。
 * 给 worktree fork 提供干净 base / 给用户文件改动一个轻量 checkpoint。
 * 默认不启用(`DEFAULT_TIER1_RULES = []`),需显式传入。
 */
export const TIER1_RULES_IDLE_ONLY: AutoCommitRule[] = [
  { source: 'workspace', action: 'idle', debounceMs: 0 },
]

/** 默认空 = silent agent 不主动 commit;只有用户 / agent 显式 vcs.commit() 才写 git history */
export const DEFAULT_TIER1_RULES: AutoCommitRule[] = []

export const IDLE_COMMIT_MS = 30_000

export function matchRule(
  rules: AutoCommitRule[],
  evt: Pick<WorkspaceEvent, 'source' | 'action'>,
): AutoCommitRule | null {
  return (
    rules.find((r) => r.source === evt.source && r.action === evt.action) ?? null
  )
}

/**
 * Per-rule debounce timer 表。同 key 重复触发会 cancel 上一个 timer。
 * `dispose()` 清所有 pending 的 timer,防止 app 退出后还在 fire。
 */
export class Debouncer {
  private timers = new Map<string, NodeJS.Timeout>()

  schedule(key: string, ms: number, fn: () => void): void {
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      this.timers.delete(key)
      fn()
    }, ms)
    this.timers.set(key, t)
  }

  /** 立即取消某 key 的 pending timer(若有) */
  cancel(key: string): void {
    const existing = this.timers.get(key)
    if (existing) {
      clearTimeout(existing)
      this.timers.delete(key)
    }
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

/**
 * 兜底 IdleTimer:每次外部活动时 reset,30s 没新活动触发 onIdle。
 * onIdle 是回调,由 VcsImpl 实现「emit workspace.idle event」逻辑。
 */
export class IdleTimer {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onIdle: () => void,
    private readonly delayMs: number = IDLE_COMMIT_MS,
  ) {}

  reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onIdle()
    }, this.delayMs)
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
