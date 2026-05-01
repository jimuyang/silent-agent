// [main · 纯业务,不 import 'electron']
//
// simple-git 的薄封装。把 git CLI 操作收口到一组 typed 方法,WorkspaceVcsImpl
// 只跟这一层打交道,不直接接 simple-git API。换 git 后端时只改这层。

import { simpleGit, SimpleGit } from 'simple-git'
import type { CommitInfo, CommitDetail, FileStatus, LogOpts, WorkspaceStatus } from './interface'

const COMMIT_FOOTER_SEP = '\n---\n'

export class GitWrapper {
  private git: SimpleGit

  constructor(public readonly cwd: string) {
    this.git = simpleGit({ baseDir: cwd })
  }

  async isRepo(): Promise<boolean> {
    return this.git.checkIsRepo()
  }

  async init(): Promise<void> {
    // -b main 让初始分支叫 main,跟现代 GitHub / GitLab 默认一致(避免警告)
    await this.git.init(['-b', 'main'])
  }

  async addAll(paths?: string[]): Promise<void> {
    if (paths && paths.length > 0) {
      await this.git.add(paths)
    } else {
      await this.git.add(['-A', '.'])
    }
  }

  /** Status, normalized to FileStatus[]. dirty = staged 或 unstaged 任一非空 */
  async status(): Promise<WorkspaceStatus> {
    const s = await this.git.status()
    const staged: FileStatus[] = []
    const unstaged: FileStatus[] = []
    // simple-git 的 file.index / working_dir 是 git porcelain XY 字段
    for (const f of s.files) {
      const indexCh = f.index?.trim() || ''
      const workCh = f.working_dir?.trim() || ''
      if (indexCh && indexCh !== '?') {
        staged.push({ path: f.path, status: mapStatus(indexCh) })
      }
      if (workCh) {
        unstaged.push({ path: f.path, status: mapStatus(workCh) })
      }
    }
    return { dirty: staged.length > 0 || unstaged.length > 0, staged, unstaged }
  }

  /**
   * 提交。如果 paths 给了,只 add 这些;否则 add -A。
   * allowEmpty=false 时如果 staged 为空直接返回上一个 HEAD,不真 commit。
   */
  async commit(
    message: string,
    opts?: { paths?: string[]; allowEmpty?: boolean },
  ): Promise<string> {
    await this.addAll(opts?.paths)
    const s = await this.git.status()
    const stagedCount = s.staged.length + s.created.length + s.deleted.length + s.renamed.length
    if (!opts?.allowEmpty && stagedCount === 0) {
      // 没东西可提交;返回当前 HEAD sha(即"没动")
      try {
        return (await this.git.revparse(['HEAD'])).trim()
      } catch {
        return ''
      }
    }
    const result = await this.git.commit(message)
    return result.commit
  }

  async branch(name: string): Promise<void> {
    await this.git.checkoutLocalBranch(name)
  }

  async checkout(ref: string): Promise<void> {
    await this.git.checkout(ref)
  }

  async log(opts?: LogOpts): Promise<CommitInfo[]> {
    const args: string[] = []
    if (opts?.limit) args.push(`-${opts.limit}`)
    if (opts?.since) args.push(`--since=${opts.since}`)
    if (opts?.until) args.push(`--until=${opts.until}`)
    if (opts?.path) args.push('--', opts.path)
    const log = await this.git.log({ '--name-only': null, maxCount: opts?.limit ?? 30 })
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      ts: c.date,
      files: (c.diff?.files ?? []).map((f) => f.file),
    }))
  }

  async diff(refA: string, refB?: string, paths?: string[]): Promise<string> {
    const args: string[] = []
    if (refB) args.push(`${refA}..${refB}`)
    else args.push(refA)
    if (paths && paths.length > 0) args.push('--', ...paths)
    return this.git.diff(args)
  }

  async show(sha: string): Promise<CommitDetail> {
    const showRaw = await this.git.show([sha, '--name-only', '--pretty=format:%H%n%aI%n%B%n----PATCH----'])
    const sepIdx = showRaw.indexOf('----PATCH----')
    const head = sepIdx >= 0 ? showRaw.slice(0, sepIdx) : showRaw
    const patch = sepIdx >= 0 ? showRaw.slice(sepIdx + '----PATCH----'.length).trimStart() : ''
    const lines = head.split('\n').filter((l) => l !== '')
    // 行 0 = sha,行 1 = ts,行 2.. = message + 文件名(不分隔,用 -p '%B' 后 git 会有空行分隔 commit body 和 file list)
    // 简单处理:第二个空行后是 file list。回退方案直接 git show --stat 即可,这里粗略给个结果
    const ts = lines[1] ?? new Date().toISOString()
    const message = lines.slice(2, -1).join('\n').trim()
    const files = (lines[lines.length - 1] ?? '').split('\n').filter(Boolean)
    return { message, ts, files, patch }
  }
}

function mapStatus(ch: string): FileStatus['status'] {
  switch (ch) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case '?':
      return 'untracked'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

/** 拼 commit message:title(`[source] action: summary`)+ footer(trigger / ts metadata) */
export function buildCommitMessage(args: {
  source: string
  action: string
  summary?: string
  trigger: string
  ts: string
}): string {
  const head = args.summary
    ? `[${args.source}] ${args.action}: ${args.summary}`
    : `[${args.source}] ${args.action}`
  const footer = `trigger: ${args.trigger}\nts: ${args.ts}`
  return head + COMMIT_FOOTER_SEP + footer
}
