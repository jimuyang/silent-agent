// 两端(main + renderer)共用的数据类型定义。
// 保持运行时无依赖(只能 type-only import/export)。

// ============ Agent ============

export interface AgentMeta {
  id: string                // slug, 如 'silent-default'
  name: string              // 展示名, 如 'Silent Agent'
  avatar?: string           // emoji 或字母, 首字母显示
  model: string             // 'claude-sonnet-4-6' / 'claude-opus-4-7'
  systemPrompt: string
  createdAt: string         // ISO
  lastActiveAt: string      // ISO
}

// ============ Session ============

/**
 * @deprecated v0.2 删除。所有 session 都是"工作区",不再分 chat/workspace。
 * 保留字段只是为了旧数据兼容,不再用于代码分支逻辑。
 */
export type SessionType = 'chat' | 'workspace'

export interface SessionMeta {
  id: string                // '260423-a1b2-logid'
  /** @deprecated v0.2 删 */
  type: SessionType
  name: string
  /**
   * Session 的物理路径(绝对)。未设置时走默认 `~/.silent-agent/agents/<aid>/sessions/<id>/`。
   * 设置时指向任意外部文件夹 —— 那个文件夹里的 .silent/ 就是本 session 的数据。
   */
  path?: string
  /** 可选外部文件夹,作为 cwd / 观察锚(当 path 就是 linkedFolder 自身时不用额外填) */
  linkedFolder?: string
  createdAt: string
  lastActiveAt: string
}

export interface CreateSessionArgs {
  /** @deprecated 保留参数兼容,默认 'chat' */
  type?: SessionType
  name?: string             // 不传则自动起名
  linkedFolder?: string
}

// ============ Message ============

export type MessageRole = 'user' | 'agent' | 'tool'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string           // MVP 先纯文本;后续加 StructuredContent (tool_use / tool_result)
  createdAt: string
}

// ============ Session Event (统一事件流) ============

// 所有事件汇入 sessions/<sid>/events.jsonl,单一时间线
export type EventSource =
  | 'session'   // session 生命周期(open/close)
  | 'tab'       // tab 生命周期(open/close/focus)
  | 'browser'   // 浏览器内动作(navigate/request/submit/click)
  | 'shell'     // 终端内动作(exec/exit)
  | 'file'      // 文件 save / edit
  | 'chat'      // 用户 / agent chat turn
  | 'agent'     // agent 工具调用 / 内部动作
  | 'linked'    // linkedFolder probe 结果

export interface SessionEvent {
  ts: string                              // ISO
  source: EventSource
  action: string                          // open | close | focus | navigate | exec | ...
  tabId?: string                          // session / linked 级事件可无
  target?: string                         // URL / command / path
  meta?: Record<string, unknown>
}

// @deprecated 保留只为兼容代码(v0.2 前删除)
export type ObservationSource = 'browser' | 'files' | 'shell'
export type ObservationEvent = SessionEvent

// ============ Tab ============

export type TabType = 'browser' | 'terminal' | 'file' | 'silent-chat'

export interface TabMeta {
  id: string
  sessionId: string
  type: TabType
  title: string
  pinned?: boolean          // silent-chat 是 true
  /**
   * Tab 的"数据位置"。一等字段,按 type 约定:
   * - `silent-chat`: 相对 session 目录 → 'messages.jsonl'
   * - `browser`: 相对 session 目录 → 'tabs/<tid>'(产物子目录,将来装 snapshots/)
   * - `terminal`: 相对 session 目录 → 'tabs/<tid>'(装 buffer.log + snapshots/)
   * - `file`: 绝对路径 或 相对 session 目录(用户 open 的文件)
   */
  path: string
  state: BrowserTabState | TerminalTabState | FileTabState | null
}

export interface BrowserTabState {
  url: string
  canGoBack?: boolean
  canGoForward?: boolean
  favicon?: string
}

export interface TerminalTabState {
  cwd: string
  shell: string
  cols: number
  rows: number
}

export interface FileTabState {
  // path 已提升为 TabMeta.path,这里只剩 mode
  mode: 'edit' | 'preview'
}

// ============ Push card (UI only, Phase 7 用) ============

export interface PushCard {
  id: string
  kind: 'observe' | 'learn' | 'channel'
  title: string
  body: string
  confidence?: number
  source?: string
  createdAt: string
}

// ============ Connection (v0.2 实装, MVP 占位) ============

export type ConnectionMode = 'exclusive' | 'shared'

export interface Attachment {
  connectionId: string
  capability: string
  agentId: string
  role: 'owner' | 'consumer'
}

export interface ConnectionStatus {
  id: string                // 'feishu' / 'gmail'
  connected: boolean
  capabilities: Array<{ kind: string; mode: ConnectionMode }>
}
