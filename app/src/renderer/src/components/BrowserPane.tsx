import { useEffect, useRef } from 'react'
import { ipc } from '../lib/ipc'

/**
 * 浏览器 pane 占位 DOM。真网页由 main 端 WebContentsView 原生 overlay 覆盖上来。
 *
 * 分栏后:每个 BrowserPane 是某个具体 tabId 的占位,通过 setBoundsFor(tabId, rect)
 * 把对应的 WebContentsView 推到该 div 的位置。两个 BrowserPane 同时挂(双 pane)
 * 各自走 setBoundsFor,两个 view 同时可见、互不干扰。
 *
 * 生命周期:
 *   - mount      → setBoundsFor(tabId, rect)  让对应 view 显示并定位
 *   - resize     → setBoundsFor(tabId, rect)  跟随尺寸
 *   - unmount    → hideTab(tabId)             清理 native overlay,防遗留
 */
export default function BrowserPane({ tabId }: { tabId: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const sync = () => {
      const r = el.getBoundingClientRect()
      ipc.tab
        .setBoundsFor(tabId, { x: r.x, y: r.y, width: r.width, height: r.height })
        .catch((e) => console.warn('[BrowserPane] setBoundsFor', e))
    }

    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      ipc.tab.hideTab(tabId).catch((e) => console.warn('[BrowserPane] hideTab', e))
    }
  }, [tabId])

  return (
    <div className="pane browser-pane" ref={ref}>
      <div className="pane-placeholder">
        <div className="big-icon">🌐</div>
        <div className="title">加载中…</div>
        <div className="desc">Chromium WebContentsView 正在接管这块区域。</div>
      </div>
    </div>
  )
}
