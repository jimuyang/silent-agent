// [main · 桥接层 · import 'electron']
// Per-workspace 多窗口布局(.silent/runtime/layout.json)。
// 数据小,直接 fs read/write JSON。
//
// 数据模型:WorkspaceLayout = { windows: WindowLayout[] }。
// 旧格式 `{ root: LayoutNode }` 自动迁移成 `{ windows:[{id:'window-main',isMain:true,root}] }`。

import { ipcMain } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { IPC } from '@shared/ipc'
import { MAIN_WINDOW_ID } from '@shared/consts'
import type { LayoutNode, WindowLayout, WorkspaceLayout } from '@shared/types'
import type { StorageAdapter } from '../storage/adapter'
import { workspaceLayoutFile } from '../storage/paths'
import { agentIdFromEvent } from './context'

const RATIO_MIN = 0.1
const RATIO_MAX = 0.9

function clampRatio(r: unknown): number {
  if (typeof r !== 'number' || !Number.isFinite(r)) return 0.5
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, r))
}

/** 递归校验 + 修剪 LayoutNode。结构非法的子树丢弃,合理性由 renderer 后续 reconcile 兜底。 */
function sanitizeNode(raw: unknown, depth = 0): LayoutNode | null {
  if (depth > 16) return null
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { kind?: unknown }

  if (obj.kind === 'pane') {
    const p = (raw as { pane?: unknown }).pane
    if (!p || typeof p !== 'object') return null
    const pp = p as { id?: unknown; tabIds?: unknown; activeTabId?: unknown }
    if (typeof pp.id !== 'string' || !Array.isArray(pp.tabIds)) return null
    return {
      kind: 'pane',
      pane: {
        id: pp.id,
        tabIds: pp.tabIds.filter((t): t is string => typeof t === 'string'),
        activeTabId: typeof pp.activeTabId === 'string' ? pp.activeTabId : null,
      },
    }
  }

  if (obj.kind === 'split') {
    const s = (raw as { split?: unknown }).split
    const c = (raw as { children?: unknown }).children
    if (!s || typeof s !== 'object' || !Array.isArray(c) || c.length !== 2) return null
    const ss = s as { id?: unknown; direction?: unknown; ratio?: unknown }
    if (typeof ss.id !== 'string') return null
    if (ss.direction !== 'row' && ss.direction !== 'column') return null
    const left = sanitizeNode(c[0], depth + 1)
    const right = sanitizeNode(c[1], depth + 1)
    if (!left || !right) return null
    return {
      kind: 'split',
      split: { id: ss.id, direction: ss.direction, ratio: clampRatio(ss.ratio) },
      children: [left, right],
    }
  }

  return null
}

function sanitizeBounds(raw: unknown): WindowLayout['bounds'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  if (
    typeof r.x !== 'number' ||
    typeof r.y !== 'number' ||
    typeof r.width !== 'number' ||
    typeof r.height !== 'number'
  )
    return undefined
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function sanitizeWindow(raw: unknown): WindowLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as { id?: unknown; isMain?: unknown; root?: unknown; bounds?: unknown }
  if (typeof w.id !== 'string') return null
  const root = sanitizeNode(w.root)
  if (!root) return null
  return {
    id: w.id,
    isMain: Boolean(w.isMain),
    root,
    bounds: sanitizeBounds(w.bounds),
  }
}

function sanitizeWindows(raw: unknown): WindowLayout[] {
  if (!Array.isArray(raw)) return []
  const out: WindowLayout[] = []
  for (const w of raw) {
    const s = sanitizeWindow(w)
    if (s) out.push(s)
  }
  // 保证最多一个 isMain
  let mainSeen = false
  for (const w of out) {
    if (w.isMain) {
      if (mainSeen) w.isMain = false
      else mainSeen = true
    }
  }
  return out
}

export async function readLayout(wsPath: string): Promise<WorkspaceLayout> {
  try {
    const raw = await readFile(workspaceLayoutFile(wsPath), 'utf8')
    const parsed = JSON.parse(raw) as { root?: unknown; windows?: unknown }

    // 迁移:旧格式 `{ root: LayoutNode }` → `{ windows: [main 唯一窗口] }`
    if (parsed.root !== undefined && parsed.windows === undefined) {
      const root = sanitizeNode(parsed.root)
      return { windows: root ? [{ id: MAIN_WINDOW_ID, isMain: true, root }] : [] }
    }

    return { windows: sanitizeWindows(parsed.windows) }
  } catch {
    // 不存在 / 损坏 → 空 windows(renderer 派生默认主 window)
    return { windows: [] }
  }
}

async function writeLayout(wsPath: string, layout: WorkspaceLayout): Promise<void> {
  const file = workspaceLayoutFile(wsPath)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(layout, null, 2), 'utf8')
}

export function registerLayoutIpc(storage: StorageAdapter) {
  ipcMain.handle(IPC.LAYOUT_GET, async (event, workspaceId: string) => {
    const agentId = agentIdFromEvent(event)
    const wsPath = await storage.resolveWorkspacePath(agentId, workspaceId)
    return readLayout(wsPath)
  })

  // 整盘覆盖(供 main 内部 / 极少用)。renderer 一般走 setWindowRoot 细粒度。
  ipcMain.handle(
    IPC.LAYOUT_SET,
    async (
      event,
      payload: { workspaceId: string; layout: Partial<WorkspaceLayout> },
    ) => {
      const agentId = agentIdFromEvent(event)
      const wsPath = await storage.resolveWorkspacePath(agentId, payload.workspaceId)
      const current = await readLayout(wsPath)
      const merged: WorkspaceLayout = {
        windows:
          payload.layout.windows !== undefined
            ? sanitizeWindows(payload.layout.windows)
            : current.windows,
      }
      await writeLayout(wsPath, merged)
      return merged
    },
  )

  // 细粒度:只改一个 window 的 root。renderer 标配。走 mutateLayoutAtomic 进串行链,
  // 跟 main 端 detach / close 等修改互斥,防 read-modify-write 丢更新。
  ipcMain.handle(
    IPC.LAYOUT_SET_WINDOW_ROOT,
    async (
      event,
      payload: { workspaceId: string; windowId: string; root: LayoutNode },
    ) => {
      const agentId = agentIdFromEvent(event)
      const wsPath = await storage.resolveWorkspacePath(agentId, payload.workspaceId)
      const sanitized = sanitizeNode(payload.root)
      if (!sanitized) return readLayout(wsPath)
      return mutateLayoutAtomic(wsPath, (current) => {
        const idx = current.windows.findIndex((w) => w.id === payload.windowId)
        if (idx >= 0) {
          current.windows[idx] = { ...current.windows[idx]!, root: sanitized }
        } else {
          current.windows.push({
            id: payload.windowId,
            isMain: payload.windowId === MAIN_WINDOW_ID,
            root: sanitized,
          })
        }
        return current
      })
    },
  )
}

/**
 * 启动 sweep:layout.json 里 `isMain:false` 的 detached window 在 app 重启那刻一定是 phantom
 * (没有"启动恢复 detached BrowserWindow"逻辑)。把它们的 tabId 全部捞回 main window 的
 * first pane,再删掉 phantom 条目。没 main window 就建一个空 pane,捞回来填进去。
 * 幂等:没 phantom 时不写盘。
 */
export async function sweepPhantomWindows(wsPath: string): Promise<void> {
  const current = await readLayout(wsPath)
  const phantoms = current.windows.filter((w) => !w.isMain)
  if (phantoms.length === 0) return

  // 收集 phantom 树里所有 tabId(保持顺序,后追加到 main pane 末尾)
  const rescued: string[] = []
  const walk = (n: LayoutNode) => {
    if (n.kind === 'pane') {
      for (const id of n.pane.tabIds) if (!rescued.includes(id)) rescued.push(id)
    } else {
      walk(n.children[0])
      walk(n.children[1])
    }
  }
  for (const w of phantoms) walk(w.root)

  // 找 / 建 main
  let main = current.windows.find((w) => w.isMain)
  if (!main) {
    main = {
      id: MAIN_WINDOW_ID,
      isMain: true,
      root: {
        kind: 'pane',
        pane: { id: `pane-${Math.random().toString(36).slice(2, 8)}`, tabIds: [], activeTabId: null },
      },
    }
    current.windows.unshift(main)
  }
  // 主 pane = main window 树最左/最上叶子。直接 mutate(listPanes-style 走法)
  let leaf: LayoutNode = main.root
  while (leaf.kind === 'split') leaf = leaf.children[0]
  if (leaf.kind === 'pane') {
    for (const id of rescued) {
      if (!leaf.pane.tabIds.includes(id)) leaf.pane.tabIds.push(id)
    }
    if (!leaf.pane.activeTabId && leaf.pane.tabIds.length > 0) {
      leaf.pane.activeTabId = leaf.pane.tabIds[0] ?? null
    }
  }

  // 删 phantom 条目,只保留 main
  current.windows = current.windows.filter((w) => w.isMain)
  await writeLayout(wsPath, current)
}

/** main-internal:detach 时往 layout 加一个 detached window 条目 */
export async function addWindowToLayout(
  wsPath: string,
  windowLayout: WindowLayout,
): Promise<void> {
  const current = await readLayout(wsPath)
  // 同 id 已存在则覆盖
  const idx = current.windows.findIndex((w) => w.id === windowLayout.id)
  if (idx >= 0) current.windows[idx] = windowLayout
  else current.windows.push(windowLayout)
  await writeLayout(wsPath, current)
}

/** main-internal:关 detached window 时移除条目 */
export async function removeWindowFromLayout(
  wsPath: string,
  windowId: string,
): Promise<void> {
  const current = await readLayout(wsPath)
  const next = current.windows.filter((w) => w.id !== windowId)
  if (next.length === current.windows.length) return
  await writeLayout(wsPath, { windows: next })
}

/**
 * main-internal:原子的 read-modify-write。用一把进程内 promise lock 串行化对 layout.json
 * 的写,避免 detach / renderer setWindowRoot / window close 等多路径并发交错丢更新。
 *
 * 注:跨进程(renderer ↔ main 同写)仍可能 race —— 但 renderer 只走 setWindowRoot
 * (那个 handler 本身已 await readLayout + writeLayout 同步;实际是单个 ipcMain.handle
 * 一帧内完成),且 main 端 detach 路径已通过本函数序列化。整体 race 窗口大幅收窄。
 */
let __layoutWriteChain: Promise<unknown> = Promise.resolve()
export function mutateLayoutAtomic(
  wsPath: string,
  mutate: (current: WorkspaceLayout) => WorkspaceLayout,
): Promise<WorkspaceLayout> {
  const next = __layoutWriteChain.then(async () => {
    const current = await readLayout(wsPath)
    const updated = mutate(current)
    await writeLayout(wsPath, updated)
    return updated
  })
  // 错误不阻塞后续链(catch 后再 resolve)
  __layoutWriteChain = next.catch(() => undefined)
  return next as Promise<WorkspaceLayout>
}
