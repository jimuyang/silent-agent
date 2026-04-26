// [main · 桥接层 · import 'electron']
// TabManager 管每个 Session 的 tabs。一个 Window 一个 manager,绑定到一个 agentId。
// 运行时状态:sessionId → { tabId → BrowserTabRuntime }
// 磁盘状态:agents/<aid>/sessions/<sid>/state/tabs.json
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
  // sessionId → tabId → runtime
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

  async list(sessionId: string): Promise<TabMeta[]> {
    // 以磁盘为准(运行时可能有但还没 flush)
    return this.storage.getTabs(this.agentId(), sessionId)
  }

  async open(sessionId: string, args: OpenTabArgs): Promise<TabMeta> {
    let meta: TabMeta
    if (args.type === 'browser') {
      const id = newTabId('browser')
      meta = {
        id,
        sessionId,
        type: 'browser',
        title: args.url,
        path: tabRelPath(id),                  // .silent/tabs/<id>(Phase 5d 后装 snapshots)
        state: { url: args.url } satisfies BrowserTabState,
      }
      await this.ensureTabDir(sessionId, id)
    } else if (args.type === 'terminal') {
      // 默认 cwd:args.cwd > session.linkedFolder > session 自身目录 > $HOME
      const sessionMeta = await this.storage.getSession(this.agentId(), sessionId)
      const defaultCwd =
        sessionMeta.linkedFolder || P.sessionDir(this.agentId(), sessionId)
      const state: TerminalTabState = {
        cwd: args.cwd || defaultCwd,
        shell: args.shell || process.env.SHELL || '/bin/zsh',
        cols: args.cols || 100,
        rows: args.rows || 30,
      }
      const id = newTabId('terminal')
      meta = {
        id,
        sessionId,
        type: 'terminal',
        title: `Terminal · ${state.cwd.replace(process.env.HOME || '', '~')}`,
        path: tabRelPath(id),                  // .silent/tabs/<id>(Phase 5c buffer.log + 后续 snapshots)
        state,
      }
      await this.ensureTabDir(sessionId, id)
    } else if (args.type === 'file') {
      const state: FileTabState = { mode: 'edit' }
      meta = {
        id: newTabId('file'),
        sessionId,
        type: 'file',
        title: basename(args.path),
        path: args.path,                       // 用户选的文件路径,可外部可内部
        state,
      }
      // file tab 没有 runtime 也没有产物子目录
      await this.persist(sessionId, meta)
      await this.emit(sessionId, {
        source: 'tab',
        action: 'open',
        tabId: meta.id,
        meta: { type: 'file', path: meta.path },
      })
      return meta
    } else {
      throw new Error(`tab type not supported yet: ${(args as { type: string }).type}`)
    }

    const runtime = await this.createRuntime(sessionId, meta)
    this.ensureBucket(sessionId).set(meta.id, runtime)

    await this.persist(sessionId)
    await this.emit(sessionId, {
      source: 'tab',
      action: 'open',
      tabId: meta.id,
      meta: { type: meta.type, ...(meta.type === 'browser' && { url: (meta.state as BrowserTabState).url }) },
    })
    return meta
  }

  /** emit 事件到 session 的 events.jsonl。 */
  private async emit(
    sessionId: string,
    evt: Parameters<typeof appendEventAt>[1],
  ): Promise<void> {
    try {
      const wsPath = await this.storage.resolveSessionPath(this.agentId(), sessionId)
      await appendEventAt(wsPath, evt)
    } catch (e) {
      console.warn('[TabManager] emit event', e)
    }
  }

  /** 为 browser/terminal 创建 .silent/tabs/<tid>/ 产物目录(snapshot / buffer 放这儿) */
  private async ensureTabDir(sessionId: string, tabId: string): Promise<void> {
    const wsPath = await this.storage.resolveSessionPath(this.agentId(), sessionId)
    await mkdir(P.workspaceTabDir(wsPath, tabId), { recursive: true })
  }

  async close(tabId: string): Promise<void> {
    const found = this.findRuntime(tabId)
    if (found) {
      const { sessionId, runtime } = found
      if (runtime instanceof BrowserTabRuntime && this.current === runtime) {
        this.current = null
      }
      runtime.destroy()
      this.runtimes.get(sessionId)?.delete(tabId)
      await this.persist(sessionId)
      await this.emit(sessionId, { source: 'tab', action: 'close', tabId })
      return
    }
    // 无 runtime(file / silent-chat):扫所有 session 的 tabs.json,找到并删
    // silent-chat pinned 不会走到这里(close UI 不显示 × 按钮)
    const agentId = this.agentId()
    const sessions = await this.storage.listSessions(agentId)
    for (const s of sessions) {
      const tabs = await this.storage.getTabs(agentId, s.id)
      if (tabs.some((t) => t.id === tabId)) {
        await this.storage.setTabs(agentId, s.id, tabs.filter((t) => t.id !== tabId))
        await this.emit(s.id, { source: 'tab', action: 'close', tabId })
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
    const sid = found?.sessionId ?? (await this.findSessionIdByTab(tabId))
    if (sid) {
      await this.emit(sid, { source: 'tab', action: 'focus', tabId })
    }
  }

  /** 反查 tab 所属 session:先查 runtime map(browser/terminal),不命中扫 tabs.json(silent-chat/file)。 */
  private async findSessionIdByTab(tabId: string): Promise<string | null> {
    for (const [sid, bucket] of this.runtimes) {
      if (bucket.has(tabId)) return sid
    }
    const agentId = this.agentId()
    const sessions = await this.storage.listSessions(agentId)
    for (const s of sessions) {
      const tabs = await this.storage.getTabs(agentId, s.id)
      if (tabs.some((t) => t.id === tabId)) return s.id
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
    await this.persist(found.sessionId)
  }

  /** 切会话:把运行时限定到新 sessionId 下的 tabs;其他隐藏。 */
  async switchSession(sessionId: string): Promise<TabMeta[]> {
    this.hideAll()
    // 迁移:老 session 可能没有 silent-chat tab,补一个
    await this.ensureSilentChatTab(sessionId)
    // 若还未从磁盘恢复 native runtime(只有 browser 等有 view 的类型),恢复一次
    if (!this.runtimes.has(sessionId)) {
      await this.restoreSession(sessionId)
    }
    return this.storage.getTabs(this.agentId(), sessionId)
  }

  /** 幂等:确保某 session 的 tabs.json 里有一个 silent-chat tab。 */
  private async ensureSilentChatTab(sessionId: string): Promise<void> {
    const disk = await this.storage.getTabs(this.agentId(), sessionId)
    if (disk.some((t) => t.type === 'silent-chat')) return
    disk.push({
      id: SILENT_CHAT_TAB_ID,
      sessionId,
      type: 'silent-chat',
      title: 'Silent Chat',
      pinned: true,
      path: SILENT_CHAT_TAB_PATH,
      state: null,
    })
    await this.storage.setTabs(this.agentId(), sessionId, disk)
  }

  // ---- internals ----

  private ensureBucket(sessionId: string): Map<string, TabRuntime> {
    let m = this.runtimes.get(sessionId)
    if (!m) {
      m = new Map()
      this.runtimes.set(sessionId, m)
    }
    return m
  }

  private findRuntime(
    tabId: string,
  ): { sessionId: string; runtime: TabRuntime } | null {
    for (const [sid, bucket] of this.runtimes) {
      const r = bucket.get(tabId)
      if (r) return { sessionId: sid, runtime: r }
    }
    return null
  }

  /** 找 terminal runtime 专用(type-safe) */
  findTerminal(tabId: string): TerminalTabRuntime | null {
    const found = this.findRuntime(tabId)
    if (found && found.runtime instanceof TerminalTabRuntime) return found.runtime
    return null
  }

  private async createRuntime(sessionId: string, meta: TabMeta): Promise<TabRuntime> {
    if (meta.type === 'browser') {
      const rt = new BrowserTabRuntime(this.window, meta)
      rt.onTitleChanged = () => this.persist(sessionId).catch(console.warn)
      rt.onUrlChanged = () => this.persist(sessionId).catch(console.warn)
      rt.onSessionEvent = (evt) => {
        this.emit(sessionId, { ...evt, tabId: meta.id }).catch(() => {})
      }
      return rt
    }
    if (meta.type === 'terminal') {
      const wsPath = await this.storage.resolveSessionPath(this.agentId(), sessionId)
      const bufferLogPath = join(P.workspaceTabDir(wsPath, meta.id), 'buffer.log')
      const rt = new TerminalTabRuntime(this.window, meta, bufferLogPath)
      rt.onSessionEvent = (evt) => {
        this.emit(sessionId, { ...evt, tabId: meta.id }).catch(() => {})
      }
      return rt
    }
    throw new Error(`createRuntime: unsupported type ${meta.type}`)
  }

  /** 从磁盘恢复某 session 的 tabs(懒加载,首次 switchSession 时触发)。
   *  silent-chat 无 runtime 跳过;browser / terminal 都恢复。 */
  private async restoreSession(sessionId: string): Promise<void> {
    const metas = await this.storage.getTabs(this.agentId(), sessionId)
    const bucket = this.ensureBucket(sessionId)
    for (const meta of metas) {
      if (meta.type !== 'browser' && meta.type !== 'terminal') continue
      if (bucket.has(meta.id)) continue
      bucket.set(meta.id, await this.createRuntime(sessionId, meta))
    }
  }

  /** 把某 session 的当前 runtime 状态写回磁盘。
   * 注意:silent-chat / file 等无 runtime 的 tab 从磁盘 existing 里保留,
   * 否则 persist 会把它抹掉。排序:运行时 tabs(browser/terminal)在前,
   * file tabs 中,silent-chat 永远最右。
   * appendNonRuntime:新增的无 runtime tab(如刚创建的 file tab)可通过这个参数注入。
   */
  private async persist(sessionId: string, appendNonRuntime?: TabMeta): Promise<void> {
    const existing = await this.storage.getTabs(this.agentId(), sessionId)
    const files = existing.filter((t) => t.type === 'file')
    const silent = existing.filter((t) => t.type === 'silent-chat')
    if (appendNonRuntime?.type === 'file') files.push(appendNonRuntime)
    const bucket = this.runtimes.get(sessionId)
    const runtimeTabs: TabMeta[] = bucket
      ? Array.from(bucket.values()).map((r) => r.meta)
      : []
    await this.storage.setTabs(this.agentId(), sessionId, [
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
