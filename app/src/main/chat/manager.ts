// [main · 桥接层 · import 'electron']
// ChatManager:per-window,管该 window 下每个 workspace 的 ChatRuntime(claude pty)。
// 跟 TabManager 类似的形态(workspaceId → runtime),但只管 chat,不管 tab。

import type { BrowserWindow } from 'electron'

import type { StorageAdapter } from '../storage/adapter'
import { ChatRuntime } from './runtime'

export class ChatManager {
  // workspaceId → runtime
  private runtimes = new Map<string, ChatRuntime>()

  constructor(
    private readonly window: BrowserWindow,
    private readonly storage: StorageAdapter,
    private readonly agentId: () => string,
  ) {}

  /** 获取或创建该 workspace 的 chat runtime(idempotent)。 */
  async ensure(workspaceId: string): Promise<ChatRuntime> {
    const existing = this.runtimes.get(workspaceId)
    if (existing && !existing.isDead()) return existing
    if (existing?.isDead()) this.runtimes.delete(workspaceId)

    const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
    // MVP:resumeSid 始终 null,每次新会话。v0.2 加 chat-session.json 持久化(单独于 review)
    const rt = new ChatRuntime(workspaceId, this.window, wsPath, null)
    this.runtimes.set(workspaceId, rt)
    return rt
  }

  get(workspaceId: string): ChatRuntime | null {
    const rt = this.runtimes.get(workspaceId)
    if (rt?.isDead()) {
      this.runtimes.delete(workspaceId)
      return null
    }
    return rt ?? null
  }

  kill(workspaceId: string): void {
    const rt = this.runtimes.get(workspaceId)
    if (rt) {
      rt.destroy()
      this.runtimes.delete(workspaceId)
    }
  }

  dispose(): void {
    for (const [, rt] of this.runtimes) {
      rt.destroy()
    }
    this.runtimes.clear()
  }
}
