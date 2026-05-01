// [main · 桥接层 · import 'electron']
// 一个 BrowserTabRuntime 对应磁盘上的一个 TabMeta(browser 类型)
// + 运行时的一个 WebContentsView(Chromium 渲染器,内嵌在 BrowserWindow 里)。
//
// WebContentsView 是 Electron 36+ 推荐的内嵌 web 视图 API, 替代已废弃的 BrowserView。
// 它是 native overlay,不是 DOM, 所以渲染时盖在 React 上面,我们通过 setBounds 定位。

import { WebContentsView, BrowserWindow } from 'electron'
import type { BrowserTabState, TabMeta } from '@shared/types'

const OFFSCREEN = { x: -99999, y: 0, width: 0, height: 0 }

export class BrowserTabRuntime {
  readonly view: WebContentsView
  meta: TabMeta

  constructor(public readonly window: BrowserWindow, meta: TabMeta) {
    this.meta = meta
    const state = (meta.state as BrowserTabState | null) ?? { url: 'about:blank' }

    // 新建 WebContentsView。webPreferences 可加但默认已经 contextIsolation,对观察足够。
    this.view = new WebContentsView()

    // 加入窗口 content view 层级(不加看不到)
    window.contentView.addChildView(this.view)

    // 默认隐到窗外,等 focus 才显示
    this.view.setBounds(OFFSCREEN)

    // 加载初始 URL
    this.view.webContents.loadURL(state.url).catch((e) => {
      console.warn('[browser-tab] loadURL failed:', e?.message)
    })

    // title 变化 → 同步到 meta (onTabTitle 回调由 manager 注入)
    this.view.webContents.on('page-title-updated', (_e, title) => {
      this.meta.title = title || state.url
      this.onTitleChanged?.(this.meta.title)
    })

    // navigation 变化 → 更新 state.url + 发 workspace 事件
    this.view.webContents.on('did-navigate', (_e, url) => {
      ;(this.meta.state as BrowserTabState).url = url
      this.onUrlChanged?.(url)
      this.onWorkspaceEvent?.({
        source: 'browser',
        action: 'navigate',
        target: url,
        meta: { summary: `navigate → ${hostFromUrl(url)}` },
      })
    })
    this.view.webContents.on('did-navigate-in-page', (_e, url) => {
      ;(this.meta.state as BrowserTabState).url = url
      this.onUrlChanged?.(url)
      this.onWorkspaceEvent?.({
        source: 'browser',
        action: 'navigate-in-page',
        target: url,
        meta: { summary: `navigate-in-page → ${url}` },
      })
    })
    this.view.webContents.on('did-finish-load', () => {
      this.onWorkspaceEvent?.({
        source: 'browser',
        action: 'load-finish',
        target: this.view.webContents.getURL(),
        meta: { title: this.view.webContents.getTitle() },
      })
    })
  }

  /** 由 manager 注入, title/url 变化时回调触发持久化 */
  onTitleChanged?: (title: string) => void
  onUrlChanged?: (url: string) => void
  /** 由 manager 注入,把 observation 事件写进 workspace 级 events.jsonl */
  onWorkspaceEvent?: (evt: {
    source: 'browser'
    action: string
    target?: string
    meta?: Record<string, unknown>
  }) => void

  show(bounds: { x: number; y: number; width: number; height: number }) {
    this.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    })
  }

  hide() {
    this.view.setBounds(OFFSCREEN)
  }

  navigate(url: string) {
    ;(this.meta.state as BrowserTabState).url = url
    this.view.webContents.loadURL(url).catch((e) => {
      console.warn('[browser-tab] navigate failed:', e?.message)
    })
  }

  destroy() {
    try {
      this.window.contentView.removeChildView(this.view)
    } catch {
      /* already removed */
    }
    // WebContentsView 没有显式 dispose;丢弃引用 + GC
    const wc = this.view.webContents
    if (!wc.isDestroyed()) {
      wc.close?.()
    }
  }
}

/** URL → host(失败时回退原串截断) */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || url.slice(0, 80)
  } catch {
    return url.slice(0, 80)
  }
}
