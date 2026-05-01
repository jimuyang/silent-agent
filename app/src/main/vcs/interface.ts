// [main · 纯业务,不 import 'electron']
//
// WorkspaceVCS — workspace 同级的「事件流 + git history」统一外壳。
// 详见 design/08-vcs.md。每个 workspace 一个 instance(由 vcs/registry.ts 管 cache)。

import type { WorkspaceEvent, EventSource } from '@shared/types'

export type EmitInput = Omit<WorkspaceEvent, 'ts'> & { ts?: string }

/** Tier 1 自动 commit 规则:source.action → 触发 commit(可带 debounce) */
export interface AutoCommitRule {
  source: EventSource
  action: string
  /** debounce 毫秒数;0 表示同步触发 */
  debounceMs: number
  /** 用于 debounce 表的 key,默认 source+action */
  key?: string
}

export interface CommitInfo {
  sha: string
  message: string
  ts: string
  files: string[]
}

export interface FileStatus {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
}

export interface WorkspaceStatus {
  dirty: boolean
  staged: FileStatus[]
  unstaged: FileStatus[]
}

export interface LogOpts {
  limit?: number
  since?: string
  until?: string
  path?: string
}

export interface CommitDetail {
  message: string
  ts: string
  files: string[]
  patch: string
}

export interface WorkspaceVCS {
  readonly workspacePath: string

  // ============ 写入(单一入口)============
  /** 应用层主动调,做两件事:① append events.jsonl;② 命中规则时(可能 debounce 后) commit */
  emit(evt: EmitInput): Promise<void>

  // ============ 显式 commit(Tier 2,agent / 用户调)============
  commit(message: string, opts?: { paths?: string[]; allowEmpty?: boolean }): Promise<string>
  branch(name: string): Promise<void>
  checkout(ref: string): Promise<void>

  // ============ 读(meta-skill,任意 agent 可调)============
  status(): Promise<WorkspaceStatus>
  log(opts?: LogOpts): Promise<CommitInfo[]>
  diff(refA: string, refB?: string, paths?: string[]): Promise<string>
  show(sha: string): Promise<CommitDetail>

  // ============ 生命周期 ============
  /** 清理 idle timer / debounce timer / git binding,registry dispose 时调 */
  dispose(): Promise<void>
}
