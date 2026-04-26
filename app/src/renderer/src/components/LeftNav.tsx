import { useEffect, useRef, useState } from 'react'
import type { AgentMeta, SessionMeta } from '@shared/types'

interface LeftNavProps {
  agent: AgentMeta | null
  sessions: SessionMeta[]
  activeSessionId: string | null
  /** 窄模式:文件树打开时,LeftNav 折到 100px 左右,session 变 2 行卡片 */
  narrow?: boolean
  onSelectSession: (id: string) => void
  onCreateSession: (name: string | undefined) => Promise<void> | void
  /** 点击 session 行的 `ws` tip:toggle 文件树 */
  onToggleFileTree?: (sessionId: string) => void
}

export default function LeftNav({
  agent,
  sessions,
  activeSessionId,
  narrow = false,
  onSelectSession,
  onCreateSession,
  onToggleFileTree,
}: LeftNavProps) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  async function submit() {
    const name = draft.trim()
    setCreating(false)
    setDraft('')
    await onCreateSession(name || undefined)
  }

  function cancel() {
    setCreating(false)
    setDraft('')
  }

  return (
    <aside className={`left ${narrow ? 'narrow' : ''}`}>
      <div className="left-section">
        <AgentHeader agent={agent} />

        <div style={{ marginBottom: 6 }}>
          <div className="section-head" style={{ paddingBottom: 2 }}>
            📡 {narrow ? '渠道' : '消息渠道'}
          </div>
          <div className="nav-item">
            <span className="ni-icon">💬</span>
            <span className="ni-text">飞书 IM</span>
          </div>
          <div className="nav-item">
            <span className="ni-icon">📧</span>
            <span className="ni-text">邮箱</span>
          </div>
        </div>

        <div style={{ marginBottom: 6 }}>
          <div className="section-head" style={{ paddingBottom: 2 }}>
            📆 工作流
          </div>
          <div className="nav-item">
            <span className="ni-icon">📅</span>
            <span className="ni-text">日程</span>
          </div>
          <div className="nav-item">
            <span className="ni-icon">☑️</span>
            <span className="ni-text">TODO</span>
          </div>
        </div>

        <div>
          <div className="section-head" style={{ paddingBottom: 2 }}>
            📚 知识库
          </div>
          <div className="nav-item">
            <span className="ni-icon">🛠</span>
            <span className="ni-text">Skills</span>
            <span className="ni-meta">0</span>
          </div>
          <div className="nav-item">
            <span className="ni-icon">🧠</span>
            <span className="ni-text">Memory</span>
          </div>
          <div className="nav-item">
            <span className="ni-icon">⚙️</span>
            <span className="ni-text">Preferences</span>
          </div>
        </div>

        <div className="standalone-nav">
          <div className="nav-item">
            <span className="ni-icon">🏪</span>
            <span className="ni-text">技能商店</span>
            <span className="ni-meta">→</span>
          </div>
        </div>
      </div>

      <div className="left-section">
        <div className="section-head">
          <span>💬 会话</span>
          <button
            className="btn-plus"
            title="新建会话"
            onClick={() => setCreating(true)}
          >
            ＋
          </button>
        </div>

        {creating && (
          <div className="session-create-row">
            <input
              ref={inputRef}
              className="session-create-input"
              placeholder="会话名字 · Enter 建 · Esc 取消"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                else if (e.key === 'Escape') cancel()
              }}
              onBlur={() => {
                if (!draft) cancel()
              }}
            />
          </div>
        )}

        {!creating && sessions.length === 0 && (
          <div style={{ padding: '8px', color: 'var(--text-dim2)', fontSize: 11 }}>
            无会话
          </div>
        )}

        {sessions.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            narrow={narrow}
            onSelect={() => onSelectSession(s.id)}
            onToggleFileTree={onToggleFileTree}
          />
        ))}
      </div>
    </aside>
  )
}

function SessionItem({
  session,
  active,
  narrow,
  onSelect,
  onToggleFileTree,
}: {
  session: SessionMeta
  active: boolean
  narrow: boolean
  onSelect: () => void
  onToggleFileTree?: (sessionId: string) => void
}) {
  return (
    <div
      className={`session-item ${active ? 'active' : ''}`}
      onClick={onSelect}
      title={session.path || session.id}
    >
      <div className="si-line1">
        <span className="si-name">{session.name}</span>
        {/* ws tip 可点击 toggle 文件树 */}
        <span
          className="si-tag ws-tip"
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
            onToggleFileTree?.(session.id)
          }}
          title="点击查看工作区文件"
        >
          ws
        </span>
        {active && <span className="live-dot" />}
      </div>
      {narrow && (
        <div className="si-line2">{formatLine2(session)}</div>
      )}
    </div>
  )
}

function formatLine2(s: SessionMeta): string {
  // 外部挂载路径优先(短显示);否则显示"N 分钟/小时/天前"
  if (s.linkedFolder) return abbrevPath(s.linkedFolder)
  return relativeTime(s.lastActiveAt)
}

function abbrevPath(p: string): string {
  const home = '/Users/bytedance'
  if (p.startsWith(home)) return '~' + p.slice(home.length)
  return p
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const delta = Math.max(0, Date.now() - then)
  const min = Math.floor(delta / 60000)
  if (min < 1) return '刚才'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  return new Date(iso).toISOString().slice(0, 10)
}

function AgentHeader({ agent }: { agent: AgentMeta | null }) {
  return (
    <div className="agent-id">
      <div className="agent-avatar">{agent?.avatar ?? 'S'}</div>
      <div>
        <div className="agent-name">{agent?.name ?? '…'}</div>
        <div className="agent-tag">v0.1 · {agent ? '待命' : '启动中'}</div>
      </div>
    </div>
  )
}
