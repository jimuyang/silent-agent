// [main · 纯业务,不 import 'electron']
//
// terminal tab snapshot 子系统(Phase 5e):
// 解析 pty stdout 里的 OSC 133/633 标记(由 zsh-integration 注入的 hook 发出),
// 切出每条命令的输出片段,落:
//   1. .silent/runtime/tabs/<tid>/snapshots/NNN-<ts>-<slug>.log  (历史切片,.gitignore)
//   2. .silent/tabs/<tid>/latest-cmd.log                         (当前真状态,进 git)
//
// 设计依据 design/08-vcs.md §7。

import { mkdir, readdir, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

import { tabRuntimeDir, RUNTIME_SUBDIRS } from '@shared/consts'
import * as P from '../storage/paths'

/** 单条命令满 1MB 后丢弃后续输出(防失控:tail -f / yes 之类) */
const MAX_CMD_BUFFER_BYTES = 1 * 1024 * 1024

// =============== OSC marker parser ===============

export type OscEvent =
  | { type: 'cmdline'; pos: number; end: number; cmd: string }
  | { type: 'preexec'; pos: number; end: number }
  | { type: 'exit'; pos: number; end: number; exitCode: number }

/**
 * 从 pty data chunk 里抽出 silent_agent 关心的 OSC 133/633 标记。
 * 跨 chunk 边界的不完整 OSC 通过 `leftover` 返回,调用方下次 prepend 进新 chunk 再 parse。
 *
 * 只匹配 BEL(`\x07`)结尾的 OSC,ST(ESC \\)形态 MVP 不支持(zsh-integration 只发 BEL)。
 */
export function parseOscMarkers(input: string): {
  events: OscEvent[]
  leftover: string
} {
  const events: OscEvent[] = []
  // eslint-disable-next-line no-control-regex
  const oscRe = /\x1b\](133|633);([^\x07\x1b]*)\x07/g
  let lastUnconsumed = 0

  while (true) {
    const m = oscRe.exec(input)
    if (!m) break
    const [whole, code, body] = m
    const start = m.index
    const end = start + whole.length

    if (code === '133') {
      if (body === 'C') {
        events.push({ type: 'preexec', pos: start, end })
      } else if (body.startsWith('D')) {
        const parts = body.split(';')
        const ec = parts.length > 1 ? Number(parts[1]) : 0
        events.push({ type: 'exit', pos: start, end, exitCode: Number.isNaN(ec) ? 0 : ec })
      }
      // 忽略 A / B(prompt 起止),Silent Agent 不需要
    } else if (code === '633') {
      if (body.startsWith('E;')) {
        events.push({ type: 'cmdline', pos: start, end, cmd: body.slice(2) })
      }
      // 633 P / 其它扩展暂不处理
    }
    lastUnconsumed = end
  }

  // 检查 input 末尾是否有 ESC ] 但没等到 BEL —— 那就是个跨 chunk 的不完整 OSC,
  // 整段当作 leftover 留给下次 parse。
  const tailEsc = input.lastIndexOf('\x1b]', input.length - 1)
  if (tailEsc >= lastUnconsumed) {
    // tailEsc 之后没有 BEL ⇒ 不完整
    const tailBel = input.indexOf('\x07', tailEsc)
    if (tailBel === -1) {
      return { events, leftover: input.slice(tailEsc) }
    }
  }
  return { events, leftover: '' }
}

// =============== Snapshotter state machine ===============

export type CmdEvent =
  | { kind: 'preexec'; cmd: string }
  | {
      kind: 'exit'
      cmd: string
      exitCode: number
      durMs: number
      bufferContent: string
    }

export interface CmdSnapshotResult {
  /** 相对 workspace 根的路径,直接放进 events.jsonl `meta.detailPath` */
  detailPath: string
  /** 一行 LLM-readable 简介,放 events.jsonl `meta.summary` */
  summary: string
  bytes: number
}

/**
 * 每个 TerminalTabRuntime 持有一个。喂 pty.onData 的 chunk → 输出命令边界事件。
 * `feed()` 是 sync,`writeSnapshot()` 异步落盘。
 *
 * 状态机:
 *   - idle:见到 cmdline / preexec 进入 running(忽略 idle 时的 exit;首次 prompt 会发 spurious D)
 *   - running:累积 cmd buffer,见到 exit → emit CmdEvent.kind='exit' → idle
 */
export class TerminalSnapshotter {
  private state: 'idle' | 'running' = 'idle'
  private pendingCmdline: string | null = null
  private currentCmd = ''
  private cmdStartedAt = 0
  private cmdBuffer: string[] = []
  private cmdBufferBytes = 0
  private cmdBufferTruncated = false
  private parseTail = ''

  constructor(
    private readonly wsPath: string,
    private readonly tabId: string,
  ) {}

  /** 喂 pty data chunk,返回检测到的命令边界事件(0..N 个)。 */
  feed(chunk: string): CmdEvent[] {
    const combined = this.parseTail + chunk
    const { events, leftover } = parseOscMarkers(combined)
    this.parseTail = leftover

    // 实际数据范围:[0, realEnd) —— leftover 是跨 chunk 的不完整 OSC,不算输出
    const realEnd = combined.length - leftover.length

    const out: CmdEvent[] = []
    let cursor = 0

    for (const oe of events) {
      // 当前命令运行中,把 OSC 之前的内容追加到 cmd buffer
      if (this.state === 'running') {
        this.appendToCmdBuffer(combined.slice(cursor, oe.pos))
      }
      cursor = oe.end

      if (oe.type === 'cmdline') {
        if (oe.cmd) this.pendingCmdline = oe.cmd
      } else if (oe.type === 'preexec') {
        if (!this.pendingCmdline) continue
        this.state = 'running'
        this.currentCmd = this.pendingCmdline
        this.pendingCmdline = null
        this.cmdStartedAt = Date.now()
        this.cmdBuffer = []
        this.cmdBufferBytes = 0
        this.cmdBufferTruncated = false
        out.push({ kind: 'preexec', cmd: this.currentCmd })
      } else if (oe.type === 'exit') {
        if (this.state !== 'running') continue // spurious D(首次 prompt 等),忽略
        const content = this.cmdBuffer.join('')
        out.push({
          kind: 'exit',
          cmd: this.currentCmd,
          exitCode: oe.exitCode,
          durMs: Date.now() - this.cmdStartedAt,
          bufferContent: content,
        })
        this.state = 'idle'
        this.currentCmd = ''
        this.cmdBuffer = []
        this.cmdBufferBytes = 0
        this.cmdBufferTruncated = false
      }
    }

    // OSC 之后的尾巴(在 running 状态下)继续累积到 cmd buffer
    if (this.state === 'running' && cursor < realEnd) {
      this.appendToCmdBuffer(combined.slice(cursor, realEnd))
    }

    return out
  }

  /**
   * 落盘 NNN.log + cp latest-cmd.log,返回 detailPath / summary 用于 events.jsonl。
   * 失败返回 null(不阻断 pty 数据流)。
   */
  async writeSnapshot(args: {
    cmd: string
    exitCode: number
    durMs: number
    content: string
  }): Promise<CmdSnapshotResult | null> {
    try {
      const ts = new Date().toISOString()
      const tsSafe = ts.replace(/:/g, '-').replace(/\..+$/, '')
      const snapDir = P.workspaceTabSnapshotsDir(this.wsPath, this.tabId)
      const tabGitDir = P.workspaceTabGitDir(this.wsPath, this.tabId)
      await mkdir(snapDir, { recursive: true })
      await mkdir(tabGitDir, { recursive: true })

      const nnn = String(await nextSnapshotNumber(snapDir)).padStart(3, '0')
      const slug = slugifyCmd(args.cmd)
      const filename = `${nnn}-${tsSafe}-${slug}.log`
      const snapAbs = join(snapDir, filename)
      const latestAbs = P.workspaceTabLatestCmdLog(this.wsPath, this.tabId)

      const fileContent = buildSnapshotFile({
        cmd: args.cmd,
        exitCode: args.exitCode,
        durMs: args.durMs,
        ts,
        body: args.content,
      })
      await writeFile(snapAbs, fileContent, 'utf8')
      await copyFile(snapAbs, latestAbs)

      const detailPath = `${tabRuntimeDir(this.tabId)}/${RUNTIME_SUBDIRS.SNAPSHOTS}/${filename}`
      const cmdSnippet = args.cmd.slice(0, 60)
      const summary = `exec: ${cmdSnippet} (exit=${args.exitCode}, ${args.durMs}ms)`.slice(0, 199)

      return { detailPath, summary, bytes: fileContent.length }
    } catch (e) {
      console.warn('[terminal-snapshot] write failed:', (e as Error).message)
      return null
    }
  }

  // -------- internals --------

  private appendToCmdBuffer(s: string): void {
    if (!s) return
    if (this.cmdBufferTruncated) return
    if (this.cmdBufferBytes + s.length > MAX_CMD_BUFFER_BYTES) {
      const remaining = MAX_CMD_BUFFER_BYTES - this.cmdBufferBytes
      if (remaining > 0) {
        this.cmdBuffer.push(s.slice(0, remaining))
        this.cmdBuffer.push('\n... [silent_agent: cmd output truncated at 1MB] ...\n')
        this.cmdBufferBytes = MAX_CMD_BUFFER_BYTES
      }
      this.cmdBufferTruncated = true
      return
    }
    this.cmdBuffer.push(s)
    this.cmdBufferBytes += s.length
  }
}

// =============== file helpers ===============

async function nextSnapshotNumber(dir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return 1
  }
  let max = 0
  for (const name of entries) {
    const m = /^(\d+)-/.exec(name)
    if (!m) continue
    const n = Number(m[1])
    if (n > max) max = n
  }
  return max + 1
}

/** 把命令 slug 化进文件名:取首词,小写,只留 [a-z0-9-],截 24 字符 */
function slugifyCmd(cmd: string): string {
  const firstWord = cmd.trim().split(/\s+/)[0] ?? 'cmd'
  const slug = firstWord
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
  return slug || 'cmd'
}

/** Snapshot 文件 = YAML front matter + 命令 raw 输出。LLM 单文件可读。 */
function buildSnapshotFile(args: {
  cmd: string
  exitCode: number
  durMs: number
  ts: string
  body: string
}): string {
  return [
    '---',
    `cmd: ${JSON.stringify(args.cmd)}`,
    `exit: ${args.exitCode}`,
    `duration_ms: ${args.durMs}`,
    `ts: ${args.ts}`,
    'kind: cmd-snapshot',
    '---',
    '',
    args.body.replace(/\r\n/g, '\n').trimEnd(),
    '',
  ].join('\n')
}
