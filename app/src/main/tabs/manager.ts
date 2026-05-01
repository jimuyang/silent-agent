// [main · 桥接层 · import 'electron']
// TabManager 管每个 Workspace 的 tabs。一个 Window 一个 manager,绑定到一个 agentId。
// 运行时状态:workspaceId → { tabId → BrowserTabRuntime }
// 磁盘状态:workspace 根 + .silent/state/tabs.json
// 两者需要保持一致:运行时变化(open/close/navigate)→ 立刻落盘。

import { randomBytes } from 'node:crypto'
import type { BrowserWindow } from 'electron'

import { basename, join } from 'node:path'
import { mkdir } from 'node:fs/promises'

import type {
  BrowserTabState,
  FileTabState,
  TabMeta,
  TerminalTabState,
} from '@shared/types'
import {
  SILENT_CHAT_TAB_ID,
  SILENT_CHAT_TAB_PATH,
  tabRelPath,
} from '@shared/consts'
import type { StorageAdapter } from '../storage/adapter'
import * as P from '../storage/paths'
import { appendEventAt } from '../storage/events'
import { captureBrowserSnapshot } from '../snapshots/browser'
import { BrowserTabRuntime } from './browser-tab'
import { TerminalTabRuntime } from './terminal-tab'

export interface OpenBrowserArgs {
  type: 'browser'
  url: string
}

export interface OpenTerminalArgs {
  type: 'terminal'
  cwd?: string
  shell?: string
  cols?: number
  rows?: number
  /**
   * 可选:用 customCommand 替代 shell 启动 pty。MVP 场景:
   *   { file: 'claude', args: ['--resume', sessionId] }
   * 让 review 之后的 chat 直接进 CC 续接会话。
   */
  command?: { file: string; args: string[] }
}

export interface OpenFileArgs {
  type: 'file'
  path: string
}

export type OpenTabArgs = OpenBrowserArgs | OpenTerminalArgs | OpenFileArgs

/** 两种 runtime 的共同接口,便于 manager 统一管理 */
export type TabRuntime = BrowserTabRuntime | TerminalTabRuntime

// id 形如 `browser-a1b2c3` / `terminal-d4e5f6` / `file-aabbcc`,一眼看出类型
function newTabId(type: 'browser' | 'terminal' | 'file'): string {
  return `${type}-${randomBytes(3).toString('hex')}`
}

export class TabManager {
  // workspaceId → tabId → runtime
  private runtimes = new Map<string, Map<string, TabRuntime>>()
  // current 只跟踪有 native view 的 runtime(即 browser),
  // 用于在 setBounds 时 follow。terminal / file / silent-chat 不参与。
  private current: BrowserTabRuntime | null = null
  private currentBounds = { x: 0, y: 0, width: 0, height: 0 }

  constructor(
    private readonly window: BrowserWindow,
    private readonly storage: StorageAdapter,
    private readonly agentId: () => string,
  ) {}

  // ---- public API ----

  async list(workspaceId: string): Promise<TabMeta[]> {
    // 以磁盘为准(运行时可能有但还没 flush)
    return this.storage.getTabs(this.agentId(), workspaceId)
  }

  async open(workspaceId: string, args: OpenTabArgs): Promise<TabMeta> {
    console.log('[TabManager.open]', workspaceId, JSON.stringify(args))
    let meta: TabMeta
    if (args.type === 'browser') {
      const id = newTabId('browser')
      meta = {
        id,
        workspaceId,
        type: 'browser',
        title: args.url,
        path: tabRelPath(id),                  // .silent/tabs/<id>(Phase 5d 后装 snapshots)
        state: { url: args.url } satisfies BrowserTabState,
      }
      await this.ensureTabDir(workspaceId, id)
    } else if (args.type === 'terminal') {
      // 默认 cwd:args.cwd > workspace.linkedFolder > workspace 根 > $HOME
      const wsMeta = await this.storage.getWorkspace(this.agentId(), workspaceId)
      const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
      const defaultCwd = wsMeta.linkedFolder || wsPath
      const state: TerminalTabState = {
        cwd: args.cwd || defaultCwd,
        shell: args.shell || process.env.SHELL || '/bin/zsh',
        cols: args.cols || 100,
        rows: args.rows || 30,
      }
      const id = newTabId('terminal')
      // 标题:custom command 时显示命令名(`claude` / `python` 等),否则显示 cwd
      const title = args.command
        ? `${args.command.file}${args.command.args[0] ? ` · ${args.command.args.slice(0, 2).join(' ')}` : ''}`
        : `Terminal · ${state.cwd.replace(process.env.HOME || '', '~')}`
      meta = {
        id,
        workspaceId,
        type: 'terminal',
        title,
        path: tabRelPath(id),                  // .silent/tabs/<id>(Phase 5c buffer.log + 后续 snapshots)
        state,
      }
      await this.ensureTabDir(workspaceId, id)
    } else if (args.type === 'file') {
      const state: FileTabState = { mode: 'edit' }
      meta = {
        id: newTabId('file'),
        workspaceId,
        type: 'file',
        title: basename(args.path),
        path: args.path,                       // 用户选的文件路径,可外部可内部
        state,
      }
      // file tab 没有 runtime 也没有产物子目录
      await this.persist(workspaceId, meta)
      await this.emit(workspaceId, {
        source: 'tab',
        action: 'open',
        tabId: meta.id,
        meta: { type: 'file', path: meta.path },
      })
      return meta
    } else {
      throw new Error(`tab type not supported yet: ${(args as { type: string }).type}`)
    }

    const customCommand = args.type === 'terminal' ? args.command : undefined
    const runtime = await this.createRuntime(workspaceId, meta, { customCommand })
    this.ensureBucket(workspaceId).set(meta.id, runtime)

    await this.persist(workspaceId)
    await this.emit(workspaceId, {
      source: 'tab',
      action: 'open',
      tabId: meta.id,
      meta: { type: meta.type, ...(meta.type === 'browser' && { url: (meta.state as BrowserTabState).url }) },
    })
    return meta
  }

  /** emit 事件到 workspace 的 events.jsonl。 */
  private async emit(
    workspaceId: string,
    evt: Parameters<typeof appendEventAt>[1],
  ): Promise<void> {
    try {
      const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
      await appendEventAt(wsPath, evt)
    } catch (e) {
      console.warn('[TabManager] emit event', e)
    }
  }

  /**
   * 处理 BrowserTabRuntime 抛出来的 workspace event。
   * 两类触发抓 ariaSnapshot:
   *   - `load-finish` 整页加载完成
   *   - `navigate-in-page` SPA pushState 路由变化
   * 两类都**等 500ms** 再抓:整页 did-finish-load 等价 window.onload,
   * 但 React/Vue/SWR/RQ 等异步取数据还没回来;SPA route change 后框架也要时间挂载组件。
   * 抓取结果 enrich 到 event.meta(summary + detailPath);失败仅 console.warn 不阻断 emit。
   */
  private async handleBrowserEvent(
    workspaceId: string,
    tabId: string,
    runtime: BrowserTabRuntime,
    evt: { source: 'browser'; action: string; target?: string; meta?: Record<string, unknown> },
  ): Promise<void> {
    let enriched = evt
    const shouldSnapshot = evt.action === 'load-finish' || evt.action === 'navigate-in-page'
    if (shouldSnapshot) {
      try {
        await new Promise((r) => setTimeout(r, 500))
        if (runtime.view.webContents.isDestroyed()) {
          await this.emit(workspaceId, { ...evt, tabId })
          return
        }
        const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
        const url = evt.target ?? runtime.view.webContents.getURL()
        const title = (evt.meta?.title as string | undefined) ?? runtime.view.webContents.getTitle()
        const snap = await captureBrowserSnapshot(runtime.view.webContents, wsPath, tabId, url, title)
        if (snap) {
          enriched = {
            ...evt,
            meta: {
              ...(evt.meta ?? {}),
              summary: snap.summary,
              detailPath: snap.detailPath,
            },
          }
        }
      } catch (e) {
        console.warn('[TabManager] browser snapshot failed:', (e as Error).message)
      }
    }
    await this.emit(workspaceId, { ...enriched, tabId })
  }

  /** 为 browser/terminal 创建 .silent/tabs/<tid>/ 产物目录(snapshot / buffer 放这儿) */
  private async ensureTabDir(workspaceId: string, tabId: string): Promise<void> {
    const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
    await mkdir(P.workspaceTabDir(wsPath, tabId), { recursive: true })
  }

  async close(tabId: string): Promise<void> {
    const found = this.findRuntime(tabId)
    if (found) {
      const { workspaceId, runtime } = found
      if (runtime instanceof BrowserTabRuntime && this.current === runtime) {
        this.current = null
      }
      runtime.destroy()
      this.runtimes.get(workspaceId)?.delete(tabId)
      await this.persist(workspaceId)
      await this.emit(workspaceId, { source: 'tab', action: 'close', tabId })
      return
    }
    // 无 runtime(file / silent-chat):扫所有 workspace 的 tabs.json,找到并删
    // silent-chat pinned 不会走到这里(close UI 不显示 × 按钮)
    const agentId = this.agentId()
    const workspaces = await this.storage.listWorkspaces(agentId)
    for (const w of workspaces) {
      const tabs = await this.storage.getTabs(agentId, w.id)
      if (tabs.some((t) => t.id === tabId)) {
        await this.storage.setTabs(agentId, w.id, tabs.filter((t) => t.id !== tabId))
        await this.emit(w.id, { source: 'tab', action: 'close', tabId })
        return
      }
    }
  }

  async focus(tabId: string): Promise<void> {
    this.hideAll()
    const found = this.findRuntime(tabId)
    // terminal 没有 native view, show 是 no-op 也不更新 current
    if (found?.runtime instanceof BrowserTabRuntime) {
      found.runtime.show(this.currentBounds)
      this.current = found.runtime
    }
    const wid = found?.workspaceId ?? (await this.findWorkspaceIdByTab(tabId))
    if (wid) {
      await this.emit(wid, { source: 'tab', action: 'focus', tabId })
    }
  }

  /** 反查 tab 所属 workspace:先查 runtime map(browser/terminal),不命中扫 tabs.json(silent-chat/file)。 */
  private async findWorkspaceIdByTab(tabId: string): Promise<string | null> {
    for (const [wid, bucket] of this.runtimes) {
      if (bucket.has(tabId)) return wid
    }
    const agentId = this.agentId()
    const workspaces = await this.storage.listWorkspaces(agentId)
    for (const w of workspaces) {
      const tabs = await this.storage.getTabs(agentId, w.id)
      if (tabs.some((t) => t.id === tabId)) return w.id
    }
    return null
  }

  hideAll(): void {
    for (const [, bucket] of this.runtimes) {
      for (const [, r] of bucket) r.hide()
    }
    this.current = null
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.currentBounds = bounds
    if (this.current) this.current.show(bounds)
  }

  async navigate(tabId: string, url: string): Promise<void> {
    const found = this.findRuntime(tabId)
    if (!found) return
    if (!(found.runtime instanceof BrowserTabRuntime)) return
    found.runtime.navigate(url)
    await this.persist(found.workspaceId)
  }

  /** 切工作区:把运行时限定到新 workspaceId 下的 tabs;其他隐藏。 */
  async switchWorkspace(workspaceId: string): Promise<TabMeta[]> {
    this.hideAll()
    // 迁移:老 workspace 可能没有 silent-chat tab,补一个
    await this.ensureSilentChatTab(workspaceId)
    // 若还未从磁盘恢复 native runtime(只有 browser 等有 view 的类型),恢复一次
    if (!this.runtimes.has(workspaceId)) {
      await this.restoreWorkspace(workspaceId)
    }
    return this.storage.getTabs(this.agentId(), workspaceId)
  }

  /** 幂等:确保某 workspace 的 tabs.json 里有一个 silent-chat tab。 */
  private async ensureSilentChatTab(workspaceId: string): Promise<void> {
    const disk = await this.storage.getTabs(this.agentId(), workspaceId)
    if (disk.some((t) => t.type === 'silent-chat')) return
    disk.push({
      id: SILENT_CHAT_TAB_ID,
      workspaceId,
      type: 'silent-chat',
      title: 'Silent Chat',
      pinned: true,
      path: SILENT_CHAT_TAB_PATH,
      state: null,
    })
    await this.storage.setTabs(this.agentId(), workspaceId, disk)
  }

  // ---- internals ----

  private ensureBucket(workspaceId: string): Map<string, TabRuntime> {
    let m = this.runtimes.get(workspaceId)
    if (!m) {
      m = new Map()
      this.runtimes.set(workspaceId, m)
    }
    return m
  }

  private findRuntime(
    tabId: string,
  ): { workspaceId: string; runtime: TabRuntime } | null {
    for (const [wid, bucket] of this.runtimes) {
      const r = bucket.get(tabId)
      if (r) return { workspaceId: wid, runtime: r }
    }
    return null
  }

  /** 找 terminal runtime 专用(type-safe) */
  findTerminal(tabId: string): TerminalTabRuntime | null {
    const found = this.findRuntime(tabId)
    if (found && found.runtime instanceof TerminalTabRuntime) return found.runtime
    return null
  }

  private async createRuntime(
    workspaceId: string,
    meta: TabMeta,
    opts?: { customCommand?: { file: string; args: string[] } },
  ): Promise<TabRuntime> {
    if (meta.type === 'browser') {
      const rt = new BrowserTabRuntime(this.window, meta)
      rt.onTitleChanged = () => this.persist(workspaceId).catch(console.warn)
      rt.onUrlChanged = () => this.persist(workspaceId).catch(console.warn)
      rt.onWorkspaceEvent = (evt) => {
        // Phase 5d: load-finish 时,先抽 Defuddle snapshot 落 NNN.md + latest.md,
        // 再把 detailPath / summary 注入 events.jsonl 的 meta(2 层 schema · Layer 1)
        void this.handleBrowserEvent(workspaceId, meta.id, rt, evt)
      }
      return rt
    }
    if (meta.type === 'terminal') {
      const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
      const bufferLogPath = join(P.workspaceTabDir(wsPath, meta.id), 'buffer.log')
      // customCommand 是 transient 选项,不进 meta 也不持久化:仅首次 spawn 时使用。
      // 重启 app 后 restoreWorkspace 走默认 shell(CC 会话上下文已经在 ~/.claude 里, 用户重新跑命令即可恢复)
      const rt = new TerminalTabRuntime(this.window, meta, bufferLogPath, wsPath, opts?.customCommand)
      rt.onWorkspaceEvent = (evt) => {
        this.emit(workspaceId, { ...evt, tabId: meta.id }).catch(() => {})
      }
      return rt
    }
    throw new Error(`createRuntime: unsupported type ${meta.type}`)
  }

  /** 从磁盘恢复某 workspace 的 tabs(懒加载,首次 switchWorkspace 时触发)。
   *  silent-chat 无 runtime 跳过;browser / terminal 都恢复。 */
  private async restoreWorkspace(workspaceId: string): Promise<void> {
    const metas = await this.storage.getTabs(this.agentId(), workspaceId)
    const bucket = this.ensureBucket(workspaceId)
    for (const meta of metas) {
      if (meta.type !== 'browser' && meta.type !== 'terminal') continue
      if (bucket.has(meta.id)) continue
      bucket.set(meta.id, await this.createRuntime(workspaceId, meta))
    }
  }

  /** 把某 workspace 的当前 runtime 状态写回磁盘。
   * 注意:silent-chat / file 等无 runtime 的 tab 从磁盘 existing 里保留,
   * 否则 persist 会把它抹掉。排序:运行时 tabs(browser/terminal)在前,
   * file tabs 中,silent-chat 永远最右。
   * appendNonRuntime:新增的无 runtime tab(如刚创建的 file tab)可通过这个参数注入。
   */
  private async persist(workspaceId: string, appendNonRuntime?: TabMeta): Promise<void> {
    const existing = await this.storage.getTabs(this.agentId(), workspaceId)
    const files = existing.filter((t) => t.type === 'file')
    const silent = existing.filter((t) => t.type === 'silent-chat')
    if (appendNonRuntime?.type === 'file') files.push(appendNonRuntime)
    const bucket = this.runtimes.get(workspaceId)
    const runtimeTabs: TabMeta[] = bucket
      ? Array.from(bucket.values()).map((r) => r.meta)
      : []
    await this.storage.setTabs(this.agentId(), workspaceId, [
      ...runtimeTabs,
      ...files,
      ...silent,
    ])
  }

  /** App 退出时调一下,清理原生 view。 */
  dispose(): void {
    for (const [, bucket] of this.runtimes) {
      for (const [, r] of bucket) r.destroy()
    }
    this.runtimes.clear()
    this.current = null
  }
}
