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
  WorkspaceLayout,
} from '@shared/types'
import {
  SILENT_CHAT_TAB_ID,
  SILENT_CHAT_TAB_PATH,
  tabRelPath,
} from '@shared/consts'
import { IPC } from '@shared/ipc'
import type { StorageAdapter } from '../storage/adapter'
import * as P from '../storage/paths'
import { captureBrowserSnapshot } from '../snapshots/browser'
import { vcsFor } from '../vcs/registry'
import type { EmitInput } from '../vcs/interface'
import { BrowserTabRuntime } from './browser-tab'
import { TerminalTabRuntime } from './terminal-tab'
import { readLayout } from '../ipc/layout'

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
        meta: {
          type: 'file',
          path: meta.path,
          summary: `open file → ${basename(meta.path)}`,
        },
      })
      return meta
    } else {
      throw new Error(`tab type not supported yet: ${(args as { type: string }).type}`)
    }

    const customCommand = args.type === 'terminal' ? args.command : undefined
    const runtime = await this.createRuntime(workspaceId, meta, { customCommand })
    this.ensureBucket(workspaceId).set(meta.id, runtime)

    await this.persist(workspaceId)
    const openSummary =
      meta.type === 'browser'
        ? `open browser → ${(meta.state as BrowserTabState).url}`
        : meta.type === 'terminal'
          ? `open terminal in ${(meta.state as TerminalTabState).cwd.replace(process.env.HOME || '', '~')}`
          : `open ${meta.type}`
    await this.emit(workspaceId, {
      source: 'tab',
      action: 'open',
      tabId: meta.id,
      meta: {
        type: meta.type,
        summary: openSummary,
        ...(meta.type === 'browser' && { url: (meta.state as BrowserTabState).url }),
      },
    })
    return meta
  }

  /**
   * emit 事件 → workspace VCS:append events.jsonl + 命中规则可能触发 git commit。
   * 走 vcs.emit 单一入口(design/08-vcs.md G3),调用方不感知 commit 细节。
   */
  private async emit(workspaceId: string, evt: EmitInput): Promise<void> {
    try {
      const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
      const vcs = await vcsFor(wsPath)
      await vcs.emit(evt)
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

  /**
   * 复制一个 tab —— 用相同 type + 关键 state(URL / cwd / path)起一个新 tab。
   * 用例:1-tab pane split 时,复制当前 tab 让新 pane 有内容。
   *
   *   - browser:复制当前 URL
   *   - terminal:复制 spawn cwd / shell / cols / rows
   *   - file:复制路径(开同文件第二个实例)
   *   - silent-chat:不可复制(每 workspace 唯一,绑定 main_chat agent)
   */
  async duplicate(tabId: string): Promise<TabMeta> {
    // 先在 runtime map 里找(browser / terminal)
    const found = this.findRuntime(tabId)
    if (found) {
      return await this.duplicateMeta(found.workspaceId, found.runtime.meta)
    }
    // 无 runtime(file / silent-chat)— 扫所有 workspace 的 tabs.json
    const agentId = this.agentId()
    const workspaces = await this.storage.listWorkspaces(agentId)
    for (const w of workspaces) {
      const list = await this.storage.getTabs(agentId, w.id)
      const t = list.find((x) => x.id === tabId)
      if (t) return await this.duplicateMeta(w.id, t)
    }
    throw new Error(`duplicate: tab not found: ${tabId}`)
  }

  private async duplicateMeta(workspaceId: string, meta: TabMeta): Promise<TabMeta> {
    switch (meta.type) {
      case 'browser': {
        const state = (meta.state as BrowserTabState | null) ?? { url: 'about:blank' }
        return await this.open(workspaceId, { type: 'browser', url: state.url })
      }
      case 'terminal': {
        const state = meta.state as TerminalTabState | null
        return await this.open(workspaceId, {
          type: 'terminal',
          cwd: state?.cwd,
          shell: state?.shell,
          cols: state?.cols,
          rows: state?.rows,
        })
      }
      case 'file':
        return await this.open(workspaceId, { type: 'file', path: meta.path })
      case 'silent-chat':
        throw new Error('silent-chat tab is unique per workspace and cannot be duplicated')
    }
  }

  async close(tabId: string): Promise<void> {
    const found = this.findRuntime(tabId)
    if (found) {
      const { workspaceId, runtime } = found
      runtime.destroy()
      this.runtimes.get(workspaceId)?.delete(tabId)
      await this.persist(workspaceId)
      await this.emit(workspaceId, {
        source: 'tab',
        action: 'close',
        tabId,
        meta: { summary: `close ${tabId}` },
      })
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
        await this.emit(w.id, {
          source: 'tab',
          action: 'close',
          tabId,
          meta: { summary: `close ${tabId}` },
        })
        return
      }
    }
  }

  /**
   * 焦点切换 — 只 emit `tab.focus` 事件,**不再管 view 可见性**。
   *
   * 自分栏支持后(per-tab bounds),renderer 自己通过 setBoundsFor / hideTab 控制
   * 哪些 BrowserView 显示在哪里:BrowserPane 组件 mount 时 setBoundsFor,unmount
   * 时 hideTab。一个 pane 切到另一个浏览器 tab → 旧的 unmount(自动 hide),新的
   * mount(自动 show + 同步 bounds)。两 pane 同时挂两个 browser 也兼容(各自
   * setBoundsFor 自己的 div rect)。
   */
  async focus(tabId: string): Promise<void> {
    const wid = await this.findWorkspaceIdByTab(tabId)
    if (wid) {
      await this.emit(wid, {
        source: 'tab',
        action: 'focus',
        tabId,
        meta: { summary: `focus → ${tabId}` },
      })
    }
  }

  /** Per-tab bounds:支持双 BrowserView 并排。仅对 browser tab 有效,其余 no-op。 */
  setBoundsFor(tabId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    const found = this.findRuntime(tabId)
    if (!found || !(found.runtime instanceof BrowserTabRuntime)) return
    found.runtime.show(bounds)
  }

  /** 隐藏单个 tab 的 native view(BrowserPane unmount 时清理)。 */
  hideTab(tabId: string): void {
    const found = this.findRuntime(tabId)
    if (!found || !(found.runtime instanceof BrowserTabRuntime)) return
    found.runtime.hide()
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
  }

  async navigate(tabId: string, url: string): Promise<void> {
    const found = this.findRuntime(tabId)
    if (!found) return
    if (!(found.runtime instanceof BrowserTabRuntime)) return
    found.runtime.navigate(url)
    await this.persist(found.workspaceId)
  }

  /**
   * 切工作区:把运行时限定到新 workspaceId 下的 tabs;其他隐藏。
   *
   * **返回 tabs 和 layout 一起**,renderer 一次 .then 拿全 → setTabs / setRoot 同 React 渲染
   * 提交批处理 → 不会有 race(独立 IPC 顺序不定 → reconcile 把 saved tree 误清空)。
   */
  async switchWorkspace(
    workspaceId: string,
  ): Promise<{ tabs: TabMeta[]; layout: WorkspaceLayout }> {
    this.hideAll()
    // 迁移:老 workspace 可能没有 silent-chat tab,补一个
    await this.ensureSilentChatTab(workspaceId)
    // 若还未从磁盘恢复 native runtime(只有 browser 等有 view 的类型),恢复一次
    if (!this.runtimes.has(workspaceId)) {
      await this.restoreWorkspace(workspaceId)
    }
    const tabs = await this.storage.getTabs(this.agentId(), workspaceId)
    const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
    const layout = await readLayout(wsPath)
    return { tabs, layout }
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

  /**
   * 处理 BrowserTabRuntime 的 window.open / target=_blank 事件:
   * 在同 workspace 起一个 sibling browser tab 加载该 URL,**推 renderer 让它把
   * 新 tab 加入 TabBar + 切过去**。focus 不在 main 这里调:让 renderer 通过
   * setActiveTabId 副作用自然触发(避免双 focus 事件 + 状态不同步)。
   * 失败仅 console.warn,不阻断主流程(防止 page 端的恶意 popup 风暴打挂 manager)。
   */
  private async handleWindowOpen(
    workspaceId: string,
    parentTabId: string,
    url: string,
  ): Promise<void> {
    try {
      const newMeta = await this.open(workspaceId, { type: 'browser', url })
      // [main] webContents.send 是 main → renderer 单向推,renderer 用 ipcRenderer.on 订阅
      // parentTabId 让 renderer 把新 tab 落到点击源 tab 所在的 pane(否则 reconcile 会用 focusedPane,可能跑到别的栏)
      this.window.webContents.send(IPC.TAB_OPENED, {
        workspaceId,
        meta: newMeta,
        parentTabId,
      })
    } catch (e) {
      console.warn(
        `[TabManager] handleWindowOpen failed (parent=${parentTabId}, url=${url}):`,
        (e as Error).message,
      )
    }
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
      rt.onWindowOpen = ({ url }) => {
        void this.handleWindowOpen(workspaceId, meta.id, url)
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
  }
}
