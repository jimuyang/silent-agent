// [main · 桥接层 · import 'electron'(BrowserWindow)]
// ChatRuntime:每个 workspace 一个长驻 `claude` 子进程,作为该 workspace 的主 agent 入口。
// SilentChat panel 的问答区通过 IPC 直连这个 pty,用户在 xterm 里跟 CC 对话。
// review 的"在主 agent 中继续"通过 ChatManager.inject 调本 runtime 的 write,把 review 文本
// 当成一条 user message 喂给 CC。
//
// 跟 TerminalTabRuntime 的区别:
// - 不是 tab,不进 tabs.json,不在 TabBar 显示
// - 命令固定为 `claude --continue --permission-mode acceptEdits`
// - 一 workspace 一份,常驻直到 workspace 关闭或用户显式 kill

import * as pty from 'node-pty'
import type { BrowserWindow } from 'electron'

import { chatChannel } from '@shared/ipc'

const BUFFER_MAX_BYTES = 256 * 1024

export class ChatRuntime {
  private proc: pty.IPty
  // rolling buffer:renderer 切走 / 重连时回填历史
  private buffer: string[] = []
  private bufferBytes = 0
  private dead = false

  constructor(
    public readonly workspaceId: string,
    public readonly window: BrowserWindow,
    cwd: string,
    /**
     * 该 workspace 主 chat 的 session id。有则 --resume,无则起新会话。
     * MVP:ChatManager 暂不持久化(每次开 workspace 起新会话);v0.2 加持久化时
     * 把 chat session 跟 .silent/messages.jsonl 绑定,跟 review 系统调用 session 分开。
     */
    resumeSid: string | null,
    cols = 100,
    rows = 30,
  ) {
    const args = ['--permission-mode', 'acceptEdits']
    if (resumeSid) args.unshift('--resume', resumeSid)
    console.log('[chat-runtime] spawn', { workspaceId, cwd, resumeSid })
    this.proc = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as { [key: string]: string },
    })

    this.proc.onData((chunk) => {
      this.pushBuffer(chunk)
      if (!this.window.isDestroyed()) {
        this.window.webContents.send(chatChannel.data(workspaceId), chunk)
      }
    })

    this.proc.onExit(({ exitCode }) => {
      this.dead = true
      console.log('[chat-runtime] exit', { workspaceId, exitCode })
      if (!this.window.isDestroyed()) {
        this.window.webContents.send(chatChannel.exit(workspaceId), exitCode)
      }
    })
  }

  write(data: string): void {
    if (this.dead) return
    this.proc.write(data)
  }

  resize(cols: number, rows: number): void {
    try {
      this.proc.resize(cols, rows)
    } catch {
      /* pty 可能已 exit */
    }
  }

  /** 把一段 markdown 文本作为 user message 投递给 CC(直接写 + \r 提交) */
  inject(text: string): void {
    if (this.dead) return
    this.proc.write(text)
    this.proc.write('\r')
  }

  getBuffer(): string {
    return this.buffer.join('')
  }

  isDead(): boolean {
    return this.dead
  }

  destroy(): void {
    if (this.dead) return
    try {
      this.proc.kill()
    } catch {
      /* already dead */
    }
    this.dead = true
  }

  private pushBuffer(chunk: string): void {
    this.buffer.push(chunk)
    this.bufferBytes += chunk.length
    while (this.bufferBytes > BUFFER_MAX_BYTES && this.buffer.length > 1) {
      const dropped = this.buffer.shift()
      if (dropped) this.bufferBytes -= dropped.length
    }
  }
}
