import { useEffect, useRef } from 'react'
import { ipc } from '../lib/ipc'

/**
 * 浏览器 pane 占位 DOM。真网页由 main 端 WebContentsView 原生 overlay 覆盖上来。
 * 这里只做两件事:
 *   1) ResizeObserver 同步 div 的 getBoundingClientRect 给 main.setBounds,让 view 跟尺寸
 *   2) 当没有 browser tab 焦点时(组件被 App 按类型切走),main 端已经 hideAll 了
 */
export default function BrowserPane() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const sync = () => {
      const r = el.getBoundingClientRect()
      ipc.tab
        .setBounds({ x: r.x, y: r.y, width: r.width, height: r.height })
        .catch((e) => console.warn('[BrowserPane] setBounds', e))
    }

    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

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
