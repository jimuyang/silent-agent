// [main · 纯业务,不 import 'electron']
//
// 进程级 WorkspaceVCS 缓存。每个 wsPath 一个 instance,首次 vcsFor 时通过 factory
// 构造(包含 git init 等准备工作),后续直接复用。
//
// app 退出 / 单元测试结束时调 disposeAllVcs() 清 idle timer / debounce timer,
// 防止 timer 把 process 拉住不退出。

import { createWorkspaceVCS } from './impl'
import type { WorkspaceVCS } from './interface'

const cache = new Map<string, Promise<WorkspaceVCS>>()

/**
 * 拿某个 workspace 的 VCS 实例。首次调用会触发 git init / .gitignore append 等。
 * Promise 缓存:并发调用复用同一构造。
 */
export function vcsFor(wsPath: string): Promise<WorkspaceVCS> {
  let p = cache.get(wsPath)
  if (!p) {
    p = createWorkspaceVCS(wsPath)
    cache.set(wsPath, p)
  }
  return p
}

/** 清掉某 wsPath 的实例(workspace 删除时调) */
export async function disposeVcs(wsPath: string): Promise<void> {
  const p = cache.get(wsPath)
  if (!p) return
  cache.delete(wsPath)
  try {
    const vcs = await p
    await vcs.dispose()
  } catch {
    /* ignore */
  }
}

/** 清所有(app 退出 / 测试结束) */
export async function disposeAllVcs(): Promise<void> {
  const entries = Array.from(cache.values())
  cache.clear()
  await Promise.allSettled(
    entries.map(async (p) => {
      try {
        const vcs = await p
        await vcs.dispose()
      } catch {
        /* ignore */
      }
    }),
  )
}
