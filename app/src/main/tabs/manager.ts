// [main · 桥接层 · import 'electron']
// TabManager 管每个 Workspace 的 tabs。一个 Window 一个 manager,绑定到一个 agentId。
// 运行时状态:workspaceId → { tabId → BrowserTabRuntime }
// 磁盘状态:workspace 根 + .silent/state/tabs.json
// 两者需要保持一致:运行时变化(open/close/navigate)→ 立刻落盘。

import { randomBytes } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'

import { basename, join } from 'node:path'
import { mkdir } from 'node:fs/promises'

import type {
  BrowserTabState,
  FileTabState,
  LayoutNode,
  TabMeta,
  TerminalTabState,
  WorkspaceLayout,
} from '@shared/types'
import {
  MAIN_WINDOW_ID,
  SILENT_CHAT_TAB_ID,
  SILENT_CHAT_TAB_PATH,
  tabRelPath,
} from '@shared/consts'
import { IPC } from '@shared/ipc'
import { collapseEmptyPanes, listPanes, removeTabFromTree } from '@shared/layout-tree'
import type { StorageAdapter } from '../storage/adapter'
import * as P from '../storage/paths'
import { captureBrowserSnapshot } from '../snapshots/browser'
import { vcsFor } from '../vcs/registry'
import type { EmitInput } from '../vcs/interface'
import { BrowserTabRuntime } from './browser-tab'
import { TerminalTabRuntime } from './terminal-tab'
import { mutateLayoutAtomic, readLayout } from '../ipc/layout'

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
   * 把 tab 拆到一个独立 BrowserWindow:
   * - browser:WC 跨 contentView 迁(removeChildView + addChildView + setWindow)
   * - 其他类型(silent-chat / terminal / file):runtime 在 main 进程跟 window 无关,
   *   detached renderer 通过 tabId 走同套 IPC 即可拿到 pty 数据 / 文件内容 / chat 流
   *
   * 返回新 BrowserWindow 的 id(renderer 暂没用,但 IPC handler 透传以便日后用)。
   * 关 detached window → 自动 manager.close(tabId)。
   */
  async detach(tabId: string): Promise<number> {
    const found = this.findRuntime(tabId)
    // file / silent-chat 没 runtime,也可以 detach(仅起新窗口渲染)
    const workspaceId =
      found?.workspaceId ?? (await this.findWorkspaceIdByTab(tabId))
    if (!workspaceId) throw new Error(`detach: tab not found: ${tabId}`)

    // silent-chat / pinned 不允许 detach —— silent-chat 是 workspace 唯一,绑 main_chat
    // 上下文;detached window 关掉 = 这个 chat 的呈现就丢了,UX 糟糕。块在源头。
    if (tabId === SILENT_CHAT_TAB_ID) {
      throw new Error('detach: silent-chat tab is pinned to its workspace and cannot be detached')
    }
    const meta = found?.runtime.meta
    if (meta?.pinned) {
      throw new Error(`detach: pinned tab ${tabId} cannot be detached`)
    }

    const detachedWin = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 600,
      minHeight: 400,
      show: false,
      autoHideMenuBar: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 12 },
      backgroundColor: '#0f1013',
      title: 'Silent Agent',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        contextIsolation: true,
      },
    })
    detachedWin.on('ready-to-show', () => detachedWin.show())

    // 原子改 layout:**一次 read-modify-write** 同时(1) 从所有现有 window 的 root 摘掉
    // tabId(2) 加新 detached window。避免跟 renderer 端 setWindowRoot 并发读写产生
    // lost-update race(实测会让 main.root 里残留已 detach 的 tab)。
    const windowId = `window-${randomBytes(4).toString('hex')}`
    const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
    const paneId = `pane-detached-${randomBytes(3).toString('hex')}`
    const updated = await mutateLayoutAtomic(wsPath, (current) => {
      // 从所有 window 摘掉 tabId(防御性 — 通常只主窗口里有)
      for (const win of current.windows) {
        win.root = collapseEmptyPanes(removeTabFromTree(win.root, tabId))
      }
      // 追加 detached window
      current.windows.push({
        id: windowId,
        isMain: false,
        root: {
          kind: 'pane',
          pane: { id: paneId, tabIds: [tabId], activeTabId: tabId },
        },
      })
      return current
    })

    // 关窗 → 同样原子移除 detached + close tab(非 pinned 走删 tabs.json)
    detachedWin.on('closed', () => {
      void mutateLayoutAtomic(wsPath, (current) => {
        current.windows = current.windows.filter((w) => w.id !== windowId)
        return current
      }).catch((e) => console.warn('[detach] removeWindow on close:', e))
      this.close(tabId).catch((e) => console.warn('[detach] close after window close:', e))
    })
    void updated  // suppress unused

    // browser 才需要迁 WC;其他类型 native view 不存在
    if (found && found.runtime instanceof BrowserTabRuntime) {
      found.runtime.setWindow(detachedWin)
    }

    // 加载 renderer,Phase C 起 detached 窗口直接复用 App 组件,通过 windowId 找自己的
    // WindowLayout.root 渲染(可 split / 多 tab)
    this.loadDetachedRenderer(detachedWin, windowId, workspaceId)
    return detachedWin.id
  }

  /**
   * 在 workspace 上打开一个全新的独立窗口 — 不动现有 tab,空 pane 起手。
   * 用例:用户右键 workspace → "在新窗口打开"。
   *
   * 跟 detach 共用 createDetachedBrowserWindow / mutateLayoutAtomic 路径,只是 root
   * 初始化为单空 pane(用户自己开 tab 填进去)。
   */
  async openWorkspaceInNewWindow(workspaceId: string): Promise<number> {
    const win = this.createDetachedBrowserWindow()
    const windowId = `window-${randomBytes(4).toString('hex')}`
    const paneId = `pane-detached-${randomBytes(3).toString('hex')}`
    const wsPath = await this.storage.resolveWorkspacePath(this.agentId(), workspaceId)
    await mutateLayoutAtomic(wsPath, (current) => {
      current.windows.push({
        id: windowId,
        isMain: false,
        root: {
          kind: 'pane',
          pane: { id: paneId, tabIds: [], activeTabId: null },
        },
      })
      return current
    })
    win.on('closed', () => {
      void mutateLayoutAtomic(wsPath, (current) => {
        current.windows = current.windows.filter((w) => w.id !== windowId)
        return current
      }).catch((e) => console.warn('[openInNewWindow] removeWindow on close:', e))
    })
    this.loadDetachedRenderer(win, windowId, workspaceId)
    return win.id
  }

  /** detach / openWorkspaceInNewWindow 共用 — 用一致的 webPreferences 起 detached 窗口 */
  private createDetachedBrowserWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 600,
      minHeight: 400,
      show: false,
      autoHideMenuBar: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 12 },
      backgroundColor: '#0f1013',
      title: 'Silent Agent',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        contextIsolation: true,
      },
    })
    win.on('ready-to-show', () => win.show())
    return win
  }

  /** 给 detached BrowserWindow 加载 renderer 入口,URL 带 windowId + workspaceId */
  private loadDetachedRenderer(win: BrowserWindow, windowId: string, workspaceId: string) {
    const params = `?windowId=${encodeURIComponent(windowId)}&workspaceId=${encodeURIComponent(workspaceId)}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${params}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: params.slice(1) })
    }
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
      // pinned(silent-chat 等)的 runtime tab 也不能 destroy —— 防御 detach 后关窗等路径
      if (runtime.meta.pinned) {
        console.warn('[TabManager.close] refused: pinned tab', tabId)
        return
      }
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
    const agentId = this.agentId()
    const workspaces = await this.storage.listWorkspaces(agentId)
    for (const w of workspaces) {
      const tabs = await this.storage.getTabs(agentId, w.id)
      const t = tabs.find((x) => x.id === tabId)
      if (t) {
        // pinned(尤其 silent-chat)绝不能从 tabs.json 删 —— 它是 workspace 唯一,
        // 绑定 main_chat agent。误删后 ensureSilentChatTab 下次切 workspace 才会补,
        // 中间会丢失 chat 上下文呈现。
        if (t.pinned) {
          console.warn('[TabManager.close] refused: pinned tab', tabId)
          return
        }
        await this.storage.setTabs(agentId, w.id, tabs.filter((x) => x.id !== tabId))
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
    // self-heal:pinned tab(silent-chat 等)如果 tabs.json 在但 layout 里没,补到 main
    // window 的 first pane。reconcileTree 不再"补漏"非 pinned tab,但 pinned tab 是
    // workspace 唯一、不可 detach,只可能属于主窗口,所以补回安全。
    await this.healPinnedTabsInLayout(wsPath, tabs)
    const layout = await readLayout(wsPath)
    return { tabs, layout }
  }

  /**
   * 确保 tabs.json 里所有 pinned tab(目前主要是 silent-chat)都挂在 main window 某个 pane 上。
   * 若 main window 不存在,创建一个;若主 window 的 root 是空 pane,把 pinned tabIds 塞进去;
   * 若已存在某 pane 含此 tab,跳过。原子改 layout.json。
   */
  private async healPinnedTabsInLayout(
    wsPath: string,
    tabs: TabMeta[],
  ): Promise<void> {
    const pinned = tabs.filter((t) => t.pinned)
    if (pinned.length === 0) return

    await mutateLayoutAtomic(wsPath, (current) => {
      // 收集所有 window 树里已出现的 tabId
      const present = new Set<string>()
      for (const w of current.windows) {
        for (const p of listPanes(w.root)) {
          for (const id of p.tabIds) present.add(id)
        }
      }
      const missing = pinned.filter((t) => !present.has(t.id))
      if (missing.length === 0) return current

      // 找 / 建 main window
      let mainIdx = current.windows.findIndex((w) => w.isMain)
      if (mainIdx < 0) {
        current.windows.push({
          id: MAIN_WINDOW_ID,
          isMain: true,
          root: {
            kind: 'pane',
            pane: {
              id: `pane-${randomBytes(3).toString('hex')}`,
              tabIds: [],
              activeTabId: null,
            },
          },
        })
        mainIdx = current.windows.length - 1
      }
      const mainWin = current.windows[mainIdx]!
      // 拿 main window 的 first pane(树最左叶子);若已是空 pane / 含其他 tab 都直接追加
      const firstLeaf = listPanes(mainWin.root)[0]
      if (firstLeaf) {
        for (const t of missing) {
          if (!firstLeaf.tabIds.includes(t.id)) firstLeaf.tabIds.push(t.id)
        }
        if (!firstLeaf.activeTabId && firstLeaf.tabIds.length > 0) {
          firstLeaf.activeTabId = firstLeaf.tabIds[0] ?? null
        }
      }
      return current
    })
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
