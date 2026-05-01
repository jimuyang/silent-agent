// [main · 桥接层 · import 'electron']
//
// Playwright connectOverCDP 单例。给 snapshot 子系统提供「按 URL 找到对应 Page」能力。
// Electron 启动时通过 `app.commandLine.appendSwitch('remote-debugging-port', '9222')`
// 暴露 CDP,Playwright 通过这个 HTTP 端点 attach 到所有 webContents(包括 BrowserWindow / WebContentsView)。
//
// 设计依据 design/08-vcs.md §6 + 调研笔记 silent-agent-多agent隔离与opencode/02-opencode-evaluation。

import { chromium, type Browser, type Page } from 'playwright-core'

const CDP_ENDPOINT = 'http://127.0.0.1:9222'
const CONNECT_TIMEOUT_MS = 3000

let browserPromise: Promise<Browser> | null = null

/**
 * 懒初始化 CDP browser 连接。Promise 缓存:多次调用复用同一连接。
 * 失败时清掉缓存,下次调用重试 — 让连接错误不卡死后续 capture。
 */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .connectOverCDP(CDP_ENDPOINT, { timeout: CONNECT_TIMEOUT_MS })
      .catch((e) => {
        browserPromise = null
        throw e
      })
  }
  return browserPromise
}

/**
 * 找到 URL 对应的 Playwright Page。
 *
 * - 遍历所有 BrowserContext 的所有 Page,URL 完全相等命中
 * - 同 URL 多 tab(罕见)按 contexts 数组首个命中返回
 * - 找不到 / 连不上 CDP → 返回 null,调用方降级处理(snapshot 跳过)
 */
export async function pageForWebContents(url: string): Promise<Page | null> {
  let browser: Browser
  try {
    browser = await getBrowser()
  } catch (e) {
    console.warn('[playwright-cdp] connectOverCDP failed:', (e as Error).message)
    return null
  }
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      try {
        if (page.url() === url) return page
      } catch {
        // page closed mid-iteration,跳过
      }
    }
  }
  return null
}

/** App 退出时清理 CDP 连接(可选,主要让 dev hot-restart 时不留挂连接) */
export async function disposeCdpBrowser(): Promise<void> {
  if (!browserPromise) return
  try {
    const b = await browserPromise
    await b.close()
  } catch {
    /* ignore */
  } finally {
    browserPromise = null
  }
}
