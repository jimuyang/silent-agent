// [main · 纯业务,不 import 'electron']
//
// Tier 1 auto-commit 规则引擎 + IdleTimer + Debouncer。
//
// 设计完整规则(design/08-vcs.md §3,详见 TIER1_RULES_FULL):
//   - chat.turn-end       0ms debounce(Phase 6 chat 接入后才触发)
//   - browser.load-finish 1s  debounce(合并 SPA 多帧)
//   - shell.exit          0ms 每命令独立 commit
//   - workspace.idle      0ms idle 30s 兜底(commit if dirty)
//
// **MVP 默认不开 auto-commit**:DEFAULT_TIER1_RULES = []。VCS 实例仍 git init +
// 写 .gitignore + initial commit,emit 仍 append events.jsonl,但不触发 Tier 1
// auto commit。用户/agent 想动版本走 Tier 2 显式 vcs.commit() / branch() / checkout()。
// 真要开 auto-commit 把 vcsFor 那一层传 { rules: TIER1_RULES_FULL } 即可。
//
// IdleTimer 在每次 emit 时 reset(workspace.idle 自身 emit 不 reset,防止死循环)。
// Debouncer 按 rule.key 去重:同 rule 短时间多次触发只 commit 一次。

import type { AutoCommitRule } from './interface'
import type { WorkspaceEvent } from '@shared/types'

/** 完整 Tier 1 规则集,MVP 不启用,留给后续 opt-in */
export const TIER1_RULES_FULL: AutoCommitRule[] = [
  { source: 'chat', action: 'turn-end', debounceMs: 0 },
  { source: 'browser', action: 'load-finish', debounceMs: 1000 },
  { source: 'shell', action: 'exit', debounceMs: 0 },
  { source: 'workspace', action: 'idle', debounceMs: 0 },
]

/** MVP 默认空 = 不 auto-commit;只有用户 / agent 显式 vcs.commit() 才进版本 */
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
