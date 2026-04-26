// [renderer]
// TerminalPane = 一个终端 tab 的内容视图。
// xterm.js 在 renderer 渲染 UI,node-pty 在 main 跑真 shell 进程。
// 连接方式:
//   - 初始挂载:先拿 main 端 rolling buffer(切走再切回能看到历史)
//   - 订阅 pty.data.<tabId>(preload 封装成 window.api.terminal.onData 返回 unsubscribe)
//   - 用户键入 → term.onData → ipc.terminal.write(tabId, chunk)
//   - ResizeObserver + fit addon → ipc.terminal.resize(tabId, cols, rows)

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

import type { TabMeta, TerminalTabState } from '@shared/types'
import { ipc } from '../lib/ipc'

interface TerminalPaneProps {
  tab: TabMeta
}

export default function TerminalPane({ tab }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const state = (tab.state as TerminalTabState | null) ?? undefined
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"SF Mono", ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 1.3,
      theme: {
        background: '#0a0b0f',
        foreground: '#d0d0d6',
        cursor: '#d0d0d6',
        selectionBackground: 'rgba(91, 140, 255, 0.25)',
      },
      cols: state?.cols ?? 100,
      rows: state?.rows ?? 30,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    // 回填历史 buffer(切 tab 前 pty 输出)
    ipc.terminal
      .getBuffer(tab.id)
      .then((buf) => {
        if (buf) term.write(buf)
      })
      .catch((e) => console.warn('[TerminalPane] getBuffer', e))

    // 订阅 pty 新数据
    const offData = ipc.terminal.onData(tab.id, (chunk) => term.write(chunk))
    const offExit = ipc.terminal.onExit(tab.id, (code) => {
      term.write(`\r\n\x1b[33m[pty exited ${code}]\x1b[0m\r\n`)
    })

    // 用户输入 → 写回 pty
    const dataSub = term.onData((data) => {
      ipc.terminal.write(tab.id, data).catch((e) => console.warn('[TerminalPane] write', e))
    })

    // 首次 fit,随后 ResizeObserver 跟
    const doFit = () => {
      try {
        fit.fit()
        const { cols, rows } = term
        ipc.terminal.resize(tab.id, cols, rows).catch(() => {})
      } catch {
        /* not yet measured */
      }
    }
    doFit()
    const ro = new ResizeObserver(doFit)
    ro.observe(el)

    return () => {
      ro.disconnect()
      dataSub.dispose()
      offData()
      offExit()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [tab.id])

  return (
    <div className="pane terminal-pane">
      <div ref={containerRef} className="terminal-host" />
    </div>
  )
}
