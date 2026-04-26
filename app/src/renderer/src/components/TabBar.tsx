import { useEffect, useRef, useState } from 'react'
import type { BrowserTabState, TabMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

interface TabBarProps {
  tabs: TabMeta[]
  activeTabId: string | null
  onFocusTab: (id: string) => void
  onCloseTab: (id: string) => void
  onOpenBrowser: (url: string) => Promise<void>
  onOpenTerminal: () => Promise<void>
  onOpenFile: () => Promise<void>
  onNewFile: (filename: string) => Promise<void>
  fileTreeOpen?: boolean
  onToggleFileTree?: () => void
}

// NOTE: 原 React dropdown + hideAll 绕道方案(因 WebContentsView native overlay 遮挡有闪烁)
// 已注释在下方保留,改用原生 Menu.popup。如未来想回到纯 React 方案再启用。
type NewMode = null | 'browser-url' | 'file-new-name'

export default function TabBar({
  tabs,
  activeTabId,
  onFocusTab,
  onCloseTab,
  onOpenBrowser,
  onOpenTerminal,
  onOpenFile,
  onNewFile,
  fileTreeOpen = false,
  onToggleFileTree,
}: TabBarProps) {
  const [mode, setMode] = useState<NewMode>(null)
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // const menuRef = useRef<HTMLDivElement>(null)  // [DEPRECATED] React dropdown 方案

  useEffect(() => {
    if (mode === 'browser-url' || mode === 'file-new-name') inputRef.current?.focus()
  }, [mode])

  // ===== [DEPRECATED] React dropdown 方案的 WebContentsView 隐藏兼容 =====
  // 菜单或 URL 输入打开时,临时隐藏 WebContentsView —— 否则 Chromium 原生 overlay
  // 会盖住 React 的 dropdown(native 层在 DOM 层之上,z-index 无效)。
  // 问题:hideAll 本身会让 browser 内容瞬间消失,出现可见闪烁。
  // 替代:改用原生 OS 菜单(Menu.popup 在窗口之外绘制,无此问题)。
  // useEffect(() => {
  //   if (mode !== null) {
  //     ipc.tab.hideAll().catch(() => {})
  //   } else if (activeTabId) {
  //     ipc.tab.focus(activeTabId).catch(() => {})
  //   }
  // }, [mode, activeTabId])

  // ===== [DEPRECATED] 点菜单外关闭,React dropdown 专用 =====
  // useEffect(() => {
  //   if (mode !== 'menu') return
  //   const onDoc = (e: MouseEvent) => {
  //     if (!menuRef.current?.contains(e.target as Node)) setMode(null)
  //   }
  //   const t = setTimeout(() => document.addEventListener('click', onDoc), 0)
  //   return () => {
  //     clearTimeout(t)
  //     document.removeEventListener('click', onDoc)
  //   }
  // }, [mode])

  async function submitUrl() {
    const raw = url.trim()
    if (!raw) {
      setMode(null)
      return
    }
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    await onOpenBrowser(normalized)
    setMode(null)
    setUrl('')
  }

  async function submitNewFile() {
    const raw = url.trim()  // 复用 url state 存文件名
    if (!raw) {
      setMode(null)
      return
    }
    await onNewFile(raw)
    setMode(null)
    setUrl('')
  }

  function cancel() {
    setMode(null)
    setUrl('')
  }

  // [+] 按钮 → 调用主进程弹原生菜单,拿到用户选择后走相应分支
  async function handleNewTabClick() {
    const choice = await ipc.tab.popupTypeMenu()
    if (choice === 'browser') {
      setUrl('')
      setMode('browser-url')
    } else if (choice === 'terminal') {
      await onOpenTerminal()
    } else if (choice === 'file') {
      await onOpenFile()
    } else if (choice === 'file-new') {
      setUrl('')
      setMode('file-new-name')
    }
    // choice === null → 用户 Esc / 点外面取消,no-op
  }

  return (
    <div className="tabs">
      {/* 文件树 toggle(leftmost, [+] 左边),pin 住常驻 */}
      <button
        className={`tab-filetree-toggle ${fileTreeOpen ? 'active' : ''}`}
        title={fileTreeOpen ? '收起工作区文件' : '展开工作区文件'}
        onClick={() => onToggleFileTree?.()}
      >
        📁
      </button>
      <div className="tab-new-wrap">
        <button className="tab-new" title="新建 tab" onClick={handleNewTabClick}>
          ＋
        </button>

        {/* ===== [DEPRECATED] React dropdown 菜单,保留参考 =====
        {mode === 'menu' && (
          <div className="tab-menu" ref={menuRef}>
            <button
              className="tab-menu-item"
              onClick={() => {
                setUrl('')
                setMode('browser-url')
              }}
            >
              <span className="mi-icon">🌐</span>
              <span className="mi-label">浏览器</span>
              <span className="mi-hint">输入 URL</span>
            </button>
            <button
              className="tab-menu-item"
              onClick={async () => {
                await onOpenTerminal()
                setMode(null)
              }}
            >
              <span className="mi-icon">🖥</span>
              <span className="mi-label">终端</span>
              <span className="mi-hint">$HOME · zsh</span>
            </button>
            <button className="tab-menu-item disabled" disabled>
              <span className="mi-icon">📄</span>
              <span className="mi-label">文件</span>
              <span className="mi-hint">Phase 4</span>
            </button>
          </div>
        )}
        ===== */}
      </div>

      {mode === 'browser-url' && (
        <div className="tab-create-input-wrap">
          <input
            ref={inputRef}
            className="tab-create-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL · Enter 打开 · Esc 取消"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitUrl()
              else if (e.key === 'Escape') cancel()
            }}
            onBlur={() => {
              if (!url) cancel()
            }}
          />
        </div>
      )}

      {mode === 'file-new-name' && (
        <div className="tab-create-input-wrap">
          <input
            ref={inputRef}
            className="tab-create-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="文件名如 notes.md · Enter 新建 · Esc 取消"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewFile()
              else if (e.key === 'Escape') cancel()
            }}
            onBlur={() => {
              if (!url) cancel()
            }}
          />
        </div>
      )}

      {tabs.map((t) => {
        const isActive = t.id === activeTabId
        const isSilentChat = t.type === 'silent-chat'
        const title = tabDisplayTitle(t)
        return (
          <div
            key={t.id}
            className={`tab ${isActive ? 'active' : ''} ${t.pinned ? 'pinned' : ''}`}
            title={title}
            onClick={() => onFocusTab(t.id)}
            style={isSilentChat ? { marginLeft: 'auto' } : undefined}
          >
            <span className="tab-name">
              {tabEmoji(t)} {title}
            </span>
            {!t.pinned && (
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(t.id)
                }}
              >
                ×
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function tabEmoji(t: TabMeta): string {
  switch (t.type) {
    case 'browser':
      return '🌐'
    case 'terminal':
      return '🖥'
    case 'file':
      return '📄'
    case 'silent-chat':
      return '🤖'
    default:
      return ''
  }
}

function tabDisplayTitle(t: TabMeta): string {
  if (t.type === 'browser') {
    const url = (t.state as BrowserTabState | null)?.url ?? ''
    try {
      if (t.title && t.title !== url) return t.title
      const u = new URL(url)
      return u.hostname + u.pathname.replace(/\/$/, '')
    } catch {
      return t.title || url || 'loading'
    }
  }
  return t.title
}
