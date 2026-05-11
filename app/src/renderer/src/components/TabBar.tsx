import { useEffect, useRef, useState } from 'react'
import type { BrowserTabState, TabMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

/** 上层(App)在 context menu 选择后要执行的语义动作 */
export type ContextMenuChoice = 'split-right' | 'split-down' | 'detach' | 'close' | null

/** drag-drop tab 跨 pane:从源 pane 取走 tab,放到目标 pane */
export interface TabDropPayload {
  tabId: string
  fromPaneId: string
}

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
  /** 接收跨 pane drop —— payload.fromPaneId 是源,this paneId 是目标 */
  onTabDrop: (payload: TabDropPayload) => void
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
  onTabDrop,
}: TabBarProps) {
  const [mode, setMode] = useState<NewMode>(null)
  const [url, setUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /** 解析 dataTransfer。返回 null 表示不是我们的 tab drag(忽略) */
  function parseTabPayload(e: React.DragEvent): TabDropPayload | null {
    const raw = e.dataTransfer.getData('application/x-silent-tab')
    if (!raw) return null
    try {
      const p = JSON.parse(raw) as TabDropPayload
      if (typeof p.tabId !== 'string' || typeof p.fromPaneId !== 'string') return null
      return p
    } catch {
      return null
    }
  }

  function handleDragOver(e: React.DragEvent) {
    // 必须 preventDefault 才会触发 drop;dropEffect=move 让光标显示移动而非复制
    if (e.dataTransfer.types.includes('application/x-silent-tab')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!dragOver) setDragOver(true)
    }
  }

  function handleDrop(e: React.DragEvent) {
    const payload = parseTabPayload(e)
    setDragOver(false)
    if (!payload) return
    e.preventDefault()
    // 同 pane 拖回:no-op(MVP 不做同 pane 重排序)
    if (payload.fromPaneId === paneId) return
    onTabDrop(payload)
  }

  useEffect(() => {
    if (mode === 'browser-url' || mode === 'file-new-name') inputRef.current?.focus()
  }, [mode])

  async function handleTabContextMenu(e: React.MouseEvent, t: TabMeta) {
    e.preventDefault()
    // silent-chat / pinned 不可关、不可 detach(detach 后关窗会丢 chat 上下文呈现)
    const canCloseOrDetach = !t.pinned && t.type !== 'silent-chat'
    const choice = await ipc.tab.popupContextMenu({
      canClose: canCloseOrDetach,
      canDetach: canCloseOrDetach,
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
    <div
      className={`tabs ${dragOver ? 'drag-over' : ''}`}
      data-pane-id={paneId}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
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
            onDragEnd={(e) => {
              // 没成功 drop 进任何 zone 且鼠标落在窗口外 → detach 到新 BrowserWindow。
              // dropEffect 'none' = 既没被 TabBar / pane body 接住,也没被取消(Esc 也是 'none',
              // 但 Esc 时鼠标在窗口内 → 不触发)
              if (e.dataTransfer.dropEffect !== 'none') return
              // silent-chat / pinned 不允许 detach(同右键菜单一致)
              if (t.pinned || t.type === 'silent-chat') return
              const { clientX: x, clientY: y } = e
              const outOfWindow =
                x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight
              if (outOfWindow) onContextMenuAction('detach', t.id)
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
