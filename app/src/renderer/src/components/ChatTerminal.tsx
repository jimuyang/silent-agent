// [renderer]
// ChatTerminal = 嵌入在 SilentChat panel 问答区的 xterm,
// 后端是该 workspace 的 ChatRuntime(claude pty),通过 ipc.chat 直连。
// 跟 TerminalPane 几乎一样,差别:用 workspaceId 作 key(不是 tab.id)、走 chat.* IPC。

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

import { ipc } from '../lib/ipc'

interface ChatTerminalProps {
  workspaceId: string
}

export default function ChatTerminal({ workspaceId }: ChatTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

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
      cols: 100,
      rows: 30,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term

    let offData: (() => void) | undefined
    let offExit: (() => void) | undefined

    // 先确保 main 端 ChatRuntime 已 spawn,再回填 buffer + 订阅
    ;(async () => {
      try {
        await ipc.chat.spawn(workspaceId)
      } catch (e) {
        console.error('[ChatTerminal] spawn failed', e)
        term.write(`\r\n\x1b[31m[chat spawn failed: ${(e as Error).message}]\x1b[0m\r\n`)
        return
      }
      try {
        const buf = await ipc.chat.getBuffer(workspaceId)
        if (buf) term.write(buf)
      } catch {
        /* ok, no history */
      }
      offData = ipc.chat.onData(workspaceId, (chunk) => term.write(chunk))
      offExit = ipc.chat.onExit(workspaceId, (code) => {
        term.write(`\r\n\x1b[33m[claude exited ${code}]\x1b[0m\r\n`)
      })
    })()

    // 用户输入 → 写到 pty
    const dataSub = term.onData((data) => {
      ipc.chat.write(workspaceId, data).catch((e) =>
        console.warn('[ChatTerminal] write', e),
      )
    })

    const doFit = () => {
      try {
        fit.fit()
        const { cols, rows } = term
        ipc.chat.resize(workspaceId, cols, rows).catch(() => {})
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
      offData?.()
      offExit?.()
      term.dispose()
      termRef.current = null
    }
  }, [workspaceId])

  return (
    <div className="chat-terminal-host" ref={containerRef} />
  )
}
