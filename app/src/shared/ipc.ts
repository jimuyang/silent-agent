// IPC channel 名称常量, main 和 renderer 都 import 这里, 避免打字错。
// 命名约定:资源.动作 (agent.current / workspace.create)。
// 非 Electron 专属 - 这里只是字符串表, 两端各取所需。

export const IPC = {
  // smoke
  PING: 'ping',

  // agent
  AGENT_CURRENT: 'agent.current',
  AGENT_LIST: 'agent.list',

  // workspace
  WORKSPACE_LIST: 'workspace.list',
  WORKSPACE_CREATE: 'workspace.create',
  WORKSPACE_ADD: 'workspace.add',
  WORKSPACE_RENAME: 'workspace.rename',
  WORKSPACE_DELETE: 'workspace.delete',
  WORKSPACE_LOAD_MESSAGES: 'workspace.loadMessages',

  // layout(per-workspace 主区分栏比例 / 后续布局状态)
  LAYOUT_GET: 'layout.get',
  LAYOUT_SET: 'layout.set',

  // tab
  TAB_LIST: 'tab.list',
  TAB_OPEN: 'tab.open',
  /** 复制一个 tab(用同 url / cwd / path 起一个新 tab,silent-chat 不可复制) */
  TAB_DUPLICATE: 'tab.duplicate',
  /** 把 tab 拆到独立 BrowserWindow:browser 类型迁移 WebContentsView 跨 window */
  TAB_DETACH: 'tab.detach',
  TAB_CLOSE: 'tab.close',
  TAB_FOCUS: 'tab.focus',
  /** Per-tab bounds:多 BrowserView 并排各自定位 */
  TAB_SET_BOUNDS_FOR: 'tab.setBoundsFor',
  /** 单 tab 隐藏(BrowserPane unmount 时清理 native overlay) */
  TAB_HIDE_TAB: 'tab.hideTab',
  TAB_NAVIGATE: 'tab.navigate',
  TAB_SWITCH_WORKSPACE: 'tab.switchWorkspace',
  TAB_POPUP_TYPE_MENU: 'tab.popupTypeMenu',
  TAB_POPUP_CONTEXT_MENU: 'tab.popupContextMenu',
  // main → renderer push:main 内部主动建了 tab(如 window.open 拦截 → 起 sibling tab)
  // 时通知 renderer 把它加到 tab list 并切过去。renderer 自发起的 TAB_OPEN 不走这条。
  TAB_OPENED: 'tab.opened',

  // terminal (main ↔ renderer, per-tab 事件信道是动态拼 tabId,不在这里枚举)
  TERMINAL_WRITE: 'terminal.write',
  TERMINAL_RESIZE: 'terminal.resize',
  TERMINAL_GET_BUFFER: 'terminal.getBuffer',

  // file
  FILE_READ: 'file.read',
  FILE_WRITE: 'file.write',
  FILE_PICK_OPEN: 'file.pickOpen',
  FILE_CREATE_IN_WORKSPACE: 'file.createInWorkspace',
  FILE_LIST_DIR: 'file.listDir',

  // review (MVP: spawn `claude -p` 在 workspace 跑 review)
  REVIEW_RUN: 'review.run',

  // chat (MVP: 每个 workspace 嵌一个长驻 `claude --continue`,作为该工作区的主 agent 入口,
  // 在 SilentChat 问答区直连;review 的"在主 agent 中继续"通过 chat.inject 喂消息进来)
  CHAT_SPAWN: 'chat.spawn',
  CHAT_KILL: 'chat.kill',
  CHAT_WRITE: 'chat.write',
  CHAT_RESIZE: 'chat.resize',
  CHAT_GET_BUFFER: 'chat.getBuffer',
  CHAT_INJECT: 'chat.inject',
} as const

// 动态 event channel:main → renderer 每个终端的数据流
export const ptyChannel = {
  data: (tabId: string) => `pty.data.${tabId}` as const,
  exit: (tabId: string) => `pty.exit.${tabId}` as const,
}

// chat(per-workspace claude pty)的事件信道,按 workspaceId 拼
export const chatChannel = {
  data: (workspaceId: string) => `chat.data.${workspaceId}` as const,
  exit: (workspaceId: string) => `chat.exit.${workspaceId}` as const,
}

export type IpcChannel = typeof IPC[keyof typeof IPC]
