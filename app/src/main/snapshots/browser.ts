// [main · 桥接层 · import 'electron']
//
// browser tab snapshot 子系统(Phase 5d):
// 在 BrowserTabRuntime 的 `did-finish-load` 后,通过 Playwright `locator.ariaSnapshot()`
// 把当前页面 a11y 树抓成 YAML,写两份:
//   1. .silent/runtime/tabs/<tid>/snapshots/NNN-<ts>.md   (历史切片,.gitignore)
//   2. .silent/tabs/<tid>/latest.md                        (当前真状态,进 git)
//
// 选 ariaSnapshot 而非 Defuddle:它同时保留页面**结构 + 交互元素**(form/button/link/textbox),
// agent 既能"看"页面也能"act"(未来 browser.click 用 role+name 做 selector)。
// 详见 design/08-vcs.md §6 / 调研笔记 silent-agent-多agent隔离与opencode/。

import type { WebContents } from 'electron'
import { mkdir, readdir, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

import { tabRuntimeDir, RUNTIME_SUBDIRS } from '@shared/consts'
import * as P from '../storage/paths'
import { pageForWebContents } from './playwright-cdp'

const ARIA_TIMEOUT_MS = 1500
/** YAML aria 树极少短于 50 字符;低于此阈值多半是 about:blank / 内部页 */
const MIN_SNAPSHOT_LENGTH = 50

export interface SnapshotResult {
  /** 相对 workspace 根的路径,适合直接放进 events.jsonl `meta.detailPath` */
  detailPath: string
  /** 一行 LLM-readable 简介,< 200 字符,放 events.jsonl `meta.summary` */
  summary: string
  /** YAML 字符数(粗) */
  contentLength: number
}

/**
 * `did-finish-load` 之后调用。返回 null 表示跳过(loading 骨架 / 内部页 / 抽取失败 / CDP 未连)。
 *
 * - 通过 Playwright connectOverCDP 找到 webContents 对应的 page
 * - `page.locator('html').ariaSnapshot()` 抓全页 a11y YAML
 * - 1.5s 超时;失败 / 太短(< 50 字符)直接 null
 * - 写 NNN 历史切片 + cp 到 `latest.md`(进 git,git log -p 看页面演化)
 */
export async function captureBrowserSnapshot(
  webContents: WebContents,
  wsPath: string,
  tabId: string,
  url: string,
  title: string,
): Promise<SnapshotResult | null> {
  if (webContents.isDestroyed()) return null

  // ---- 1. 找到对应的 Playwright Page ----
  const page = await pageForWebContents(url)
  if (!page) return null

  // ---- 2. 抓 ariaSnapshot,带超时保护 ----
  let yaml = ''
  try {
    yaml = await Promise.race([
      page.locator('html').ariaSnapshot(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('ariaSnapshot timeout')), ARIA_TIMEOUT_MS),
      ),
    ])
  } catch (e) {
    console.warn('[browser-snapshot] ariaSnapshot failed:', (e as Error).message)
    return null
  }

  yaml = yaml.trim()
  if (yaml.length < MIN_SNAPSHOT_LENGTH) return null

  // ---- 3. 落盘 ----
  const ts = new Date().toISOString()
  // : 在跨平台文件名里不友好,丢掉毫秒段也让文件名更清爽
  const tsSafe = ts.replace(/:/g, '-').replace(/\..+$/, '')

  const snapshotsAbsDir = P.workspaceTabSnapshotsDir(wsPath, tabId)
  const tabGitAbsDir = P.workspaceTabGitDir(wsPath, tabId)
  await mkdir(snapshotsAbsDir, { recursive: true })
  await mkdir(tabGitAbsDir, { recursive: true })

  const nnn = String(await nextSnapshotNumber(snapshotsAbsDir)).padStart(3, '0')
  const filename = `${nnn}-${tsSafe}.md`
  const snapshotAbs = join(snapshotsAbsDir, filename)
  const latestAbs = P.workspaceTabLatestMd(wsPath, tabId)

  const fileContent = buildSnapshotFile({ url, title, ts, yaml })
  await writeFile(snapshotAbs, fileContent, 'utf8')
  // copy 不是 symlink:design/08-vcs.md 显式约定,git diff 才能看到 latest.md 的真实内容演化
  await copyFile(snapshotAbs, latestAbs)

  // 相对 workspace 根的 detailPath,对外稳定可移植
  const detailPath = `${tabRuntimeDir(tabId)}/${RUNTIME_SUBDIRS.SNAPSHOTS}/${filename}`

  // 节点数粗略 = YAML 行数(每行一个节点)
  const nodeCount = yaml.split('\n').length
  const titleSnippet = (title || url).slice(0, 80)
  const summary = `load: ${titleSnippet} (${nodeCount} aria nodes)`.slice(0, 199)

  return { detailPath, summary, contentLength: yaml.length }
}

// -------- helpers --------

/** 数现有 snapshots/NNN-*.md,返回下一个序号(从 1 起步)。 */
async function nextSnapshotNumber(dir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return 1
  }
  let max = 0
  for (const name of entries) {
    const m = /^(\d+)-/.exec(name)
    if (!m) continue
    const n = Number(m[1])
    if (n > max) max = n
  }
  return max + 1
}

/** Markdown front matter + ariaSnapshot YAML 代码块。LLM 单文件可读 + git diff 友好。 */
function buildSnapshotFile(args: {
  url: string
  title: string
  ts: string
  yaml: string
}): string {
  // title 用 JSON.stringify 处理引号 / 换行,保证单行 + 合法 YAML scalar
  return [
    '---',
    `url: ${args.url}`,
    `title: ${JSON.stringify(args.title || '')}`,
    `ts: ${args.ts}`,
    'kind: aria-snapshot',
    '---',
    '',
    '```yaml',
    args.yaml,
    '```',
    '',
  ].join('\n')
}
