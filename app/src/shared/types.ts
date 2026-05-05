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

// ============ Workspace ============
//
// app 层一等公民。**任意目录 + `.silent/`** 即一个 workspace,类比 .git/。
// 默认建在 `~/.silent-agent/agents/<aid>/workspaces/<wid>/`,
// 也可通过 addWorkspace 把任意已有目录注册为 workspace(写 `.silent/` 进去)。

export interface WorkspaceMeta {
  id: string                // '260423-a1b2-logid'
  name: string
  /**
   * Workspace 物理路径(绝对)。未设置时走默认 `~/.silent-agent/agents/<aid>/workspaces/<id>/`。
   * 设置时指向任意外部文件夹 —— 那个文件夹里的 .silent/ 就是本 workspace 的数据。
   */
  path?: string
  /** 可选外部文件夹,作为 cwd / 观察锚(当 path 就是 linkedFolder 自身时不用额外填) */
  linkedFolder?: string
  createdAt: string
  lastActiveAt: string
}

export interface CreateWorkspaceArgs {
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

// ============ Workspace Layout(递归 split 树 · Level 2) ============

/**
 * Pane —— 叶子节点,装一组 tab。
 *
 * 数据模型:
 *   workspace ─┬─ tabs.json (TabMeta[])      tab 元数据(URL / 路径 / title / ...)
 *              └─ layout.json
 *                  └─ root: LayoutNode       递归 split 树,叶子 = pane
 *
 * 每个 tab 必须且仅出现在一个 pane.tabIds 里(全树范围)。tab 在 pane 间移动
 * = pop 源 pane.tabIds + push 目标 pane.tabIds。
 */
export interface PaneMeta {
  id: string
  /** 本 pane 拥有的 tab id 列表(顺序就是 TabBar 渲染顺序) */
  tabIds: string[]
  /** 当前 active 的 tab id;null 表示空 pane(应自动合并/移除) */
  activeTabId: string | null
}

/**
 * Split —— 内部节点,把空间一分为二。
 *
 *   direction = 'row'    → 子节点左右排列(横向分栏)
 *   direction = 'column' → 子节点上下排列(纵向分栏)
 *   ratio                → 第一个 child 占的比例 ∈ [0.1, 0.9]
 *   children             → 长度 2;每个仍是 LayoutNode(叶子或 split,可递归)
 */
export interface SplitMeta {
  id: string
  direction: 'row' | 'column'
  ratio: number
}

export type LayoutNode =
  | { kind: 'pane'; pane: PaneMeta }
  | { kind: 'split'; split: SplitMeta; children: [LayoutNode, LayoutNode] }

/**
 * Workspace 主区布局(.silent/runtime/layout.json)
 *
 * `root` 缺失时,renderer 派生默认:
 *   - 有 silent-chat:row split, ratio=0.69, [非chat tabs] | [silent-chat]
 *   - 没有 silent-chat:单 pane,所有 tabs
 */
export interface WorkspaceLayout {
  root?: LayoutNode
}

// ============ Workspace Event (统一事件流) ============

// 所有事件汇入 `<workspace>/.silent/events.jsonl`,单一时间线
export type EventSource =
  | 'workspace' // workspace 生命周期(open/close/idle)
  | 'tab'       // tab 生命周期(open/close/focus)
  | 'browser'   // 浏览器内动作(navigate/load-finish/click/...)
  | 'shell'     // 终端内动作(exec/exit/pty-exit)
  | 'file'      // 文件 save / edit(MVP 不主动 emit,git 懒发现)
  | 'chat'      // 用户 / main_chat agent 对话 turn(Phase 6k/6l 接入)
  | 'agent'     // agent tool 调用(Phase 6 main_chat 主权 tool 集)
  | 'review'    // main_review 产出 suggestion + 用户接收/驳回(Phase 7)
  | 'user'      // 用户裸操作(clipboard / 录制模式手势,Phase 7 / v0.2)
  | 'linked'    // linkedFolder probe 结果(5g 可选)

/**
 * 已知 action 名 — `(source, action)` 二元组的真相源。
 *
 * - 用法:`emit({ source: 'browser', action: EventActions.browser.LOAD_FINISH, ... })`
 * - 用 `as const` + `EventActionFor<S>` 让 IDE 补全 + 抓 typo
 * - `WorkspaceEvent.action` 字段类型仍是 `string`(forward-compat)—— 加新 action
 *   只需补到这里,旧调用点零改动
 *
 * 状态标记:
 *   ✅ 已实装  🟡 设计预留尚未 emit  🔵 计划在某 Phase 接入
 */
export const EventActions = {
  workspace: {
    OPEN: 'open',           // 🟡 workspace 切换/启动 (Phase 5b 后续)
    CLOSE: 'close',         // 🟡
    IDLE: 'idle',           // 🔵 IdleTimer 30s 兜底(auto-commit 启用时;MVP off)
  },
  tab: {
    OPEN: 'open',           // ✅ tab.open(browser/terminal/file)
    CLOSE: 'close',         // ✅
    FOCUS: 'focus',         // ✅
  },
  browser: {
    NAVIGATE: 'navigate',                  // ✅ webContents did-navigate
    NAVIGATE_IN_PAGE: 'navigate-in-page',  // ✅ did-navigate-in-page (SPA route)
    LOAD_FINISH: 'load-finish',            // ✅ did-finish-load + ariaSnapshot
    CLICK: 'click',                         // 🟡 计划:executeJavaScript 注入 listener
    REQUEST: 'request',                     // 🟡 计划:webRequest.onCompleted
    SUBMIT: 'submit',                       // 🟡 计划:form submit
  },
  shell: {
    EXEC: 'exec',           // ✅ OSC 133;C preexec
    EXIT: 'exit',           // ✅ OSC 133;D precmd(per-cmd snapshot)
    PTY_EXIT: 'pty-exit',   // ✅ pty 进程死亡(shell 整个退出,不是单条命令)
  },
  file: {
    SAVE: 'save',           // 🟡 设计预留;实际由 git status 懒发现,不主动 emit
    EDIT: 'edit',           // 🟡 同上
  },
  chat: {
    USER_TURN: 'user-turn',               // 🔵 Phase 6k/6l (CC SessionStop hook)
    ASSISTANT_TURN: 'assistant-turn',     // 🔵
    TURN_END: 'turn-end',                 // 🔵 Tier 1 auto-commit 触发候选
    TOOL_USE: 'tool-use',                 // 🔵
    TOOL_RESULT: 'tool-result',           // 🔵
  },
  agent: {
    TOOL_USE: 'tool-use',                 // 🔵 Phase 6 main_chat 主权 tool
    TOOL_RESULT: 'tool-result',           // 🔵
  },
  review: {
    SURFACED: 'surfaced',                 // 🔵 Phase 7 main_review 推建议
    ACCEPTED: 'accepted',                 // 🔵 用户接受
    REJECTED: 'rejected',                 // 🔵 用户驳回
  },
  user: {
    CLIPBOARD_COPY: 'clipboard.copy',     // 🔵 Phase 7 / v0.2 (按需 — Clipboard 行为捕获)
    CLIPBOARD_PASTE: 'clipboard.paste',   // 🔵
    RECORDING_START: 'recording.start',   // 🔵 Phase 7 / v0.2 (按需 — Recording 模式)
    RECORDING_STOP: 'recording.stop',     // 🔵
  },
  linked: {
    PROBE: 'probe',                       // 🔵 Phase 5g (可选)
  },
} as const

/** `EventActionFor<'browser'>` = `'navigate' | 'navigate-in-page' | 'load-finish' | 'click' | ...` */
export type EventActionFor<S extends EventSource> = S extends keyof typeof EventActions
  ? (typeof EventActions)[S][keyof (typeof EventActions)[S]]
  : string

export interface WorkspaceEvent {
  ts: string                              // ISO
  source: EventSource
  /** 已知 action 见 `EventActions[source]`;字段类型保持 string 以便 forward-compat */
  action: string
  tabId?: string                          // workspace / linked 级事件可无
  target?: string                         // URL / command / path
  meta?: Record<string, unknown>
}

// ============ Tab ============

export type TabType = 'browser' | 'terminal' | 'file' | 'silent-chat'

export interface TabMeta {
  id: string
  workspaceId: string
  type: TabType
  title: string
  pinned?: boolean          // silent-chat 是 true
  /**
   * Tab 的"数据位置"。一等字段,按 type 约定:
   * - `silent-chat`: 相对 workspace 根 → '.silent/messages.jsonl'
   * - `browser`: 相对 workspace 根 → '.silent/tabs/<tid>'(产物子目录,将来装 snapshots/)
   * - `terminal`: 相对 workspace 根 → '.silent/tabs/<tid>'(装 buffer.log + snapshots/)
   * - `file`: 绝对路径 或 相对 workspace 根(用户 open 的文件)
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

// ============ Review (MVP: spawn `claude -p`) ============

export interface ReviewResult {
  ok: boolean
  sessionId?: string        // CC session id, 后续 --resume 用
  suggestion?: string       // CC 输出的 markdown 建议(最终 result)
  error?: string
  durationMs?: number
}
