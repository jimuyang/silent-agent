// [main · 桥接层 · import 'electron'(通过 window)]
// TerminalTabRuntime:每个终端 tab 对应:
//   - 一个 node-pty 进程(shell 真 跑在这里)
//   - 一个 rolling buffer(最近 256KB 输出, 用于 renderer 重连时回填)
//   - 一份 buffer.log 落盘(pty 所有 stdout append-only, 供 tail -f / agent 读)
// 和 BrowserTabRuntime 不同,终端没有 native view,所以 show/hide 是 no-op,
// 渲染完全在 renderer 侧用 xterm.js 完成。

import * as pty from 'node-pty'
import type { BrowserWindow } from 'electron'
import { createWriteStream, WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { TabMeta, TerminalTabState } from '@shared/types'
import { ptyChannel } from '@shared/ipc'

const DEFAULT_SHELL = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
const BUFFER_MAX_BYTES = 256 * 1024

export class TerminalTabRuntime {
  meta: TabMeta
  private proc: pty.IPty

  // rolling buffer: renderer 切走 / 重连时用来回填历史
  private buffer: string[] = []
  private bufferBytes = 0

  // 落盘 buffer.log: pty 所有 stdout 同步 append(供外部 tail -f / agent 读)
  private bufferLogStream: WriteStream | null = null

  /** 由 manager 注入,pty 退出等事件发给 workspace 级 events.jsonl */
  onWorkspaceEvent?: (evt: {
    source: 'shell'
    action: string
    target?: string
    meta?: Record<string, unknown>
  }) => void

  constructor(
    public readonly window: BrowserWindow,
    meta: TabMeta,
    /** `tabs/<tid>/buffer.log` 的绝对路径,由 TabManager 传入 */
    private readonly bufferLogPath: string,
    /** 可选:直接 pty.spawn 的 file + args(取代默认 shell),用于 `claude --resume` 这种场景 */
    customCommand?: { file: string; args: string[] },
  ) {
    this.meta = meta
    const state = (meta.state as TerminalTabState | null) ?? {
      cwd: process.env.HOME || '/',
      shell: DEFAULT_SHELL,
      cols: 100,
      rows: 30,
    }

    meta.state = state

    // 默认走 shell;如果有 customCommand,直接 pty.spawn 那个进程(不进 shell)
    const procFile = customCommand?.file ?? state.shell
    const procArgs = customCommand?.args ?? []
    console.log('[terminal-tab] pty.spawn', {
      procFile, procArgs, cwd: state.cwd, hasCustom: !!customCommand,
      PATH: process.env.PATH,
    })

    try {
      this.proc = pty.spawn(procFile, procArgs, {
        name: 'xterm-256color',
        cols: state.cols,
        rows: state.rows,
        cwd: state.cwd,
        env: process.env as { [key: string]: string },
      })
    } catch (e) {
      console.error('[terminal-tab] pty.spawn failed:', e)
      throw e
    }

    // 打开 buffer.log 落盘流(append 模式),异步建父目录
    mkdir(dirname(bufferLogPath), { recursive: true })
      .then(() => {
        this.bufferLogStream = createWriteStream(bufferLogPath, { flags: 'a' })
      })
      .catch((e) => console.warn('[terminal] open buffer.log', e))

    this.proc.onData((chunk: string) => {
      this.pushBuffer(chunk)
      this.bufferLogStream?.write(chunk)
      if (!this.window.isDestroyed()) {
        this.window.webContents.send(ptyChannel.data(meta.id), chunk)
      }
    })

    this.proc.onExit(({ exitCode }) => {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send(ptyChannel.exit(meta.id), exitCode)
      }
      this.onWorkspaceEvent?.({
        source: 'shell',
        action: 'pty-exit',
        meta: { exitCode },
      })
      this.bufferLogStream?.end()
      this.bufferLogStream = null
    })
  }

  /** 无 native view, no-op */
  show(_bounds: { x: number; y: number; width: number; height: number }) {}
  hide() {}

  write(input: string) {
    this.proc.write(input)
  }

  resize(cols: number, rows: number) {
    try {
      this.proc.resize(cols, rows)
    } catch {
      // pty 可能已 exit
    }
    const state = this.meta.state as TerminalTabState
    state.cols = cols
    state.rows = rows
  }

  getBuffer(): string {
    return this.buffer.join('')
  }

  destroy() {
    try {
      this.proc.kill()
    } catch {
      /* already dead */
    }
    this.bufferLogStream?.end()
    this.bufferLogStream = null
  }

  // ----- internals -----
  private pushBuffer(chunk: string) {
    this.buffer.push(chunk)
    this.bufferBytes += chunk.length
    while (this.bufferBytes > BUFFER_MAX_BYTES && this.buffer.length > 1) {
      const dropped = this.buffer.shift()
      if (dropped) this.bufferBytes -= dropped.length
    }
  }
}
