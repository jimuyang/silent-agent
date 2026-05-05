// [main · 桥接层 · import 'electron']
// Per-workspace 主区布局(.silent/runtime/layout.json)。
// 数据小(只一棵 LayoutNode 树),直接 fs read/write JSON。

import { ipcMain } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { IPC } from '@shared/ipc'
import type { LayoutNode, WorkspaceLayout } from '@shared/types'
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
  if (depth > 16) return null // 防御深度,避免恶意 / 损坏数据
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

export async function readLayout(wsPath: string): Promise<WorkspaceLayout> {
  try {
    const raw = await readFile(workspaceLayoutFile(wsPath), 'utf8')
    const parsed = JSON.parse(raw) as { root?: unknown }
    const root = sanitizeNode(parsed.root)
    return root ? { root } : {}
  } catch {
    // 不存在 / 损坏 → 空 layout(renderer 派生默认)
    return {}
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

  ipcMain.handle(
    IPC.LAYOUT_SET,
    async (
      event,
      payload: { workspaceId: string; layout: Partial<WorkspaceLayout> },
    ) => {
      const agentId = agentIdFromEvent(event)
      const wsPath = await storage.resolveWorkspacePath(agentId, payload.workspaceId)
      const current = await readLayout(wsPath)
      const merged: WorkspaceLayout = {}
      if ('root' in payload.layout) {
        const root = sanitizeNode(payload.layout.root)
        if (root) merged.root = root
      } else if (current.root) {
        merged.root = current.root
      }
      await writeLayout(wsPath, merged)
      return merged
    },
  )
}
