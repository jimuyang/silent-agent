// [main · 纯业务,不 import 'electron']
//
// WorkspaceVcsImpl + createWorkspaceVCS factory。
// 把 GitWrapper / RuleEngine / IdleTimer / Debouncer / events.jsonl writer 缝合成
// 一个对外的 WorkspaceVCS 实例。详见 design/08-vcs.md。

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { appendLine } from '../storage/jsonl'
import { workspaceEventsFile, workspaceInternalDir } from '../storage/paths'
import type { WorkspaceEvent } from '@shared/types'

import {
  DEFAULT_TIER1_RULES,
  Debouncer,
  IDLE_COMMIT_MS,
  IdleTimer,
  matchRule,
} from './auto-commit'
import { GitWrapper, buildCommitMessage } from './git'
import type {
  AutoCommitRule,
  CommitDetail,
  CommitInfo,
  EmitInput,
  LogOpts,
  WorkspaceStatus,
  WorkspaceVCS,
} from './interface'

const SILENT_GITIGNORE_LINE = '.silent/runtime/'

export interface CreateVcsOpts {
  rules?: AutoCommitRule[]
  idleMs?: number
}

class WorkspaceVcsImpl implements WorkspaceVCS {
  private readonly git: GitWrapper
  private readonly rules: AutoCommitRule[]
  private readonly debouncer = new Debouncer()
  /** 仅在 auto-commit 启用(rules 非空)时构造,否则 idle 兜底也无意义 */
  private readonly idleTimer: IdleTimer | null
  private disposed = false

  constructor(public readonly workspacePath: string, opts?: CreateVcsOpts) {
    this.git = new GitWrapper(workspacePath)
    this.rules = opts?.rules ?? DEFAULT_TIER1_RULES
    this.idleTimer =
      this.rules.length > 0
        ? new IdleTimer(() => void this.fireIdle(), opts?.idleMs ?? IDLE_COMMIT_MS)
        : null
  }

  // -------- 写入 --------

  async emit(input: EmitInput): Promise<void> {
    if (this.disposed) return
    const evt: WorkspaceEvent = {
      ts: input.ts ?? new Date().toISOString(),
      source: input.source,
      action: input.action,
      tabId: input.tabId,
      target: input.target,
      meta: input.meta,
    }
    // ① append events.jsonl
    try {
      await appendLine(workspaceEventsFile(this.workspacePath), evt)
    } catch (e) {
      console.warn('[vcs] append events.jsonl failed:', (e as Error).message)
    }

    // ② 命中 Tier 1 规则 → 立即 / debounce 后 commit
    const rule = matchRule(this.rules, evt)
    if (rule) {
      const key = rule.key ?? `${rule.source}.${rule.action}`
      if (rule.debounceMs === 0) {
        void this.tryCommit(rule, evt)
      } else {
        this.debouncer.schedule(key, rule.debounceMs, () => void this.tryCommit(rule, evt))
      }
    }

    // ③ idle timer reset —— workspace.idle 自身 emit 不 reset,避免死循环
    //    rules 为空时 idleTimer 也是 null(MVP 默认不开 auto-commit)
    if (this.idleTimer && !(evt.source === 'workspace' && evt.action === 'idle')) {
      this.idleTimer.reset()
    }
  }

  // -------- 显式 commit / branch / checkout --------

  async commit(message: string, opts?: { paths?: string[]; allowEmpty?: boolean }): Promise<string> {
    return this.git.commit(message, opts)
  }

  async branch(name: string): Promise<void> {
    await this.git.branch(name)
  }

  async checkout(ref: string): Promise<void> {
    await this.git.checkout(ref)
  }

  // -------- 只读 --------

  async status(): Promise<WorkspaceStatus> {
    return this.git.status()
  }

  async log(opts?: LogOpts): Promise<CommitInfo[]> {
    return this.git.log(opts)
  }

  async diff(refA: string, refB?: string, paths?: string[]): Promise<string> {
    return this.git.diff(refA, refB, paths)
  }

  async show(sha: string): Promise<CommitDetail> {
    return this.git.show(sha)
  }

  // -------- 生命周期 --------

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.debouncer.dispose()
    this.idleTimer?.dispose()
  }

  // -------- internals --------

  private async tryCommit(rule: AutoCommitRule, lastEvt: WorkspaceEvent): Promise<void> {
    if (this.disposed) return
    try {
      const status = await this.git.status()
      if (!status.dirty) return // 没有内容变化:skip empty commit(events.jsonl 已 append,timeline 已记)
      const summary = (lastEvt.meta?.summary as string | undefined) ?? lastEvt.target ?? ''
      const msg = buildCommitMessage({
        source: lastEvt.source,
        action: lastEvt.action,
        summary,
        trigger: `${lastEvt.source}.${lastEvt.action}`,
        ts: lastEvt.ts,
      })
      await this.git.commit(msg)
    } catch (e) {
      console.warn('[vcs] tryCommit failed:', (e as Error).message)
    }
  }

  private async fireIdle(): Promise<void> {
    // emit workspace.idle event,会走规则匹配 → 0ms commit
    await this.emit({
      source: 'workspace',
      action: 'idle',
      meta: { summary: 'idle commit (30s no activity)' },
    })
  }
}

/**
 * 工厂函数:确保 workspace 是 git repo + .gitignore 含 `.silent/runtime/`,然后构造实例。
 *
 * 行为:
 * - 若 wsPath 不是 git repo → `git init` + 写 .gitignore + initial commit
 * - 若已是 git repo → 仅幂等追加 `.silent/runtime/` 到现有 .gitignore(若已含跳过)
 *
 * 让外挂 workspace(用户自己的 git 项目)不被乱动 commit 历史。
 */
export async function createWorkspaceVCS(
  workspacePath: string,
  opts?: CreateVcsOpts,
): Promise<WorkspaceVCS> {
  await ensureSilentRuntimeIgnored(workspacePath)
  const git = new GitWrapper(workspacePath)
  if (!(await git.isRepo())) {
    await git.init()
    // 第一笔提交:把 .gitignore + .silent/(若存在)纳入版本控制
    const initPaths: string[] = ['.gitignore']
    if (await pathExists(join(workspacePath, '.silent'))) {
      initPaths.push('.silent')
    }
    await git.addAll(initPaths)
    try {
      await git.commit('initial: silent agent workspace', { allowEmpty: true })
    } catch (e) {
      // 极少数:用户没设过 git user.name/email,commit 会失败。降级成 silent fail。
      console.warn('[vcs] initial commit skipped:', (e as Error).message)
    }
  }
  return new WorkspaceVcsImpl(workspacePath, opts)
}

async function ensureSilentRuntimeIgnored(wsPath: string): Promise<void> {
  // 必须先确保 .silent/ 目录存在(workspace 创建逻辑已保证,但为外挂 case 防御一手)
  await fs.mkdir(workspaceInternalDir(wsPath), { recursive: true })
  const gitignorePath = join(wsPath, '.gitignore')
  let existing = ''
  try {
    existing = await fs.readFile(gitignorePath, 'utf8')
  } catch {
    /* 不存在,新建 */
  }
  const lines = existing.split('\n').map((l) => l.trim())
  if (lines.some((l) => l === SILENT_GITIGNORE_LINE)) return
  const append =
    (existing && !existing.endsWith('\n') ? '\n' : '') + `${SILENT_GITIGNORE_LINE}\n`
  await fs.writeFile(gitignorePath, existing + append, 'utf8')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
