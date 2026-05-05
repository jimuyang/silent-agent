import { useEffect, useRef, useState } from 'react'
import type { BrowserTabState, TabMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

/** 上层(App)在 context menu 选择后要执行的语义动作 */
export type ContextMenuChoice = 'split-right' | 'split-down' | 'close' | null

interface TabBarProps {
  /** 已经按 pane.tabIds 过滤好,顺序就是渲染顺序(per-pane TabBar) */
  tabs: TabMeta[]
  activeTabId: string | null
  paneId: string

  /** 是否显示文件树 toggle 按钮(只在主 pane) */
  showFileTreeToggle?: boolean
  /** 是否显示 [+] 新 tab 按钮(只在主 pane) */
  showNewTabButton?: boolean
  fileTreeOpen?: boolean
  onToggleFileTree?: () => void

  onFocusTab: (id: string) => void
  onCloseTab: (id: string) => void
  onContextMenuAction: (choice: ContextMenuChoice, tabId: string) => void
  onOpenBrowser: (url: string) => Promise<void>
  onOpenTerminal: () => Promise<void>
  onOpenFile: () => Promise<void>
  onNewFile: (filename: string) => Promise<void>
  /** 右上角"⊞ 拆右"按钮(把当前 active 拆出右侧 pane) */
  onSplitRight: () => void
  /** "⊟ 拆下"按钮(纵向分栏) */
  onSplitDown: () => void
}

type NewMode = null | 'browser-url' | 'file-new-name'

export default function TabBar({
  tabs,
  activeTabId,
  paneId,
  showFileTreeToggle = false,
  showNewTabButton = false,
  fileTreeOpen = false,
  onToggleFileTree,
  onFocusTab,
  onCloseTab,
  onContextMenuAction,
  onOpenBrowser,
  onOpenTerminal,
  onOpenFile,
  onNewFile,
  onSplitRight,
  onSplitDown,
}: TabBarProps) {
  const [mode, setMode] = useState<NewMode>(null)
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'browser-url' || mode === 'file-new-name') inputRef.current?.focus()
  }, [mode])

  async function handleTabContextMenu(e: React.MouseEvent, t: TabMeta) {
    e.preventDefault()
    const choice = await ipc.tab.popupContextMenu({
      // silent-chat / pinned 不可关
      canClose: !t.pinned && t.type !== 'silent-chat',
    })
    if (choice && choice !== null) {
      onContextMenuAction(choice, t.id)
    }
  }

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
    const raw = url.trim()
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
  }

  return (
    <div className="tabs" data-pane-id={paneId}>
      {showFileTreeToggle && (
        <button
          className={`tab-filetree-toggle ${fileTreeOpen ? 'active' : ''}`}
          title={fileTreeOpen ? '收起工作区文件' : '展开工作区文件'}
          onClick={() => onToggleFileTree?.()}
        >
          📁
        </button>
      )}
      {showNewTabButton && (
        <div className="tab-new-wrap">
          <button className="tab-new" title="新建 tab" onClick={handleNewTabClick}>
            ＋
          </button>
        </div>
      )}

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
        const title = tabDisplayTitle(t)
        return (
          <div
            key={t.id}
            className={`tab ${isActive ? 'active' : ''} ${t.pinned ? 'pinned' : ''}`}
            title={title}
            onClick={() => onFocusTab(t.id)}
            onContextMenu={(e) => handleTabContextMenu(e, t)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(
                'application/x-silent-tab',
                JSON.stringify({ tabId: t.id, fromPaneId: paneId }),
              )
            }}
          >
            <span className="tab-name">
              {tabEmoji(t)} {title}
            </span>
            {!t.pinned && t.type !== 'silent-chat' && (
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

      {/* 右上角:⊞ 拆右 / ⊟ 拆下 */}
      <button
        className="tab-split-toggle"
        title="拆出右栏 (split right)"
        onClick={onSplitRight}
      >
        ⊞
      </button>
      <button
        className="tab-split-toggle"
        title="拆出下栏 (split down)"
        onClick={onSplitDown}
      >
        ⊟
      </button>
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
