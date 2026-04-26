// IPC channel 名称常量, main 和 renderer 都 import 这里, 避免打字错。
// 命名约定:资源.动作 (agent.current / session.create)。
// 非 Electron 专属 - 这里只是字符串表, 两端各取所需。

export const IPC = {
  // smoke
  PING: 'ping',

  // agent
  AGENT_CURRENT: 'agent.current',
  AGENT_LIST: 'agent.list',

  // session
  SESSION_LIST: 'session.list',
  SESSION_CREATE: 'session.create',
  SESSION_ADD_WORKSPACE: 'session.addWorkspace',
  SESSION_RENAME: 'session.rename',
  SESSION_DELETE: 'session.delete',
  SESSION_LOAD_MESSAGES: 'session.loadMessages',

  // tab
  TAB_LIST: 'tab.list',
  TAB_OPEN: 'tab.open',
  TAB_CLOSE: 'tab.close',
  TAB_FOCUS: 'tab.focus',
  TAB_SET_BOUNDS: 'tab.setBounds',
  TAB_HIDE_ALL: 'tab.hideAll',
  TAB_NAVIGATE: 'tab.navigate',
  TAB_SWITCH_SESSION: 'tab.switchSession',
  TAB_POPUP_TYPE_MENU: 'tab.popupTypeMenu',

  // terminal (main ↔ renderer, per-tab 事件信道是动态拼 tabId,不在这里枚举)
  TERMINAL_WRITE: 'terminal.write',
  TERMINAL_RESIZE: 'terminal.resize',
  TERMINAL_GET_BUFFER: 'terminal.getBuffer',

  // file
  FILE_READ: 'file.read',
  FILE_WRITE: 'file.write',
  FILE_PICK_OPEN: 'file.pickOpen',
  FILE_CREATE_IN_SESSION: 'file.createInSession',
  FILE_LIST_DIR: 'file.listDir',
} as const

// 动态 event channel:main → renderer 每个终端的数据流
export const ptyChannel = {
  data: (tabId: string) => `pty.data.${tabId}` as const,
  exit: (tabId: string) => `pty.exit.${tabId}` as const,
}

export type IpcChannel = typeof IPC[keyof typeof IPC]
