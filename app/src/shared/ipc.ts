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

  // tab
  TAB_LIST: 'tab.list',
  TAB_OPEN: 'tab.open',
  TAB_CLOSE: 'tab.close',
  TAB_FOCUS: 'tab.focus',
  TAB_SET_BOUNDS: 'tab.setBounds',
  TAB_HIDE_ALL: 'tab.hideAll',
  TAB_NAVIGATE: 'tab.navigate',
  TAB_SWITCH_WORKSPACE: 'tab.switchWorkspace',
  TAB_POPUP_TYPE_MENU: 'tab.popupTypeMenu',

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
} as const

// 动态 event channel:main → renderer 每个终端的数据流
export const ptyChannel = {
  data: (tabId: string) => `pty.data.${tabId}` as const,
  exit: (tabId: string) => `pty.exit.${tabId}` as const,
}

export type IpcChannel = typeof IPC[keyof typeof IPC]
