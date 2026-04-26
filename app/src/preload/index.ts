// [preload] 在 renderer 的 JS 执行前加载的桥接脚本。
// 因为 contextIsolation=true,renderer 不能直接调 Node / Electron API。
// 我们在这里用 contextBridge 把"白名单"方法挂到 renderer 的 window.xxx 上。

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import { IPC, ptyChannel } from '../shared/ipc'
import type {
  AgentMeta,
  ChatMessage,
  CreateSessionArgs,
  SessionMeta,
  TabMeta,
} from '../shared/types'

// open tab 的 args,按 type 判别
type OpenTabArgs =
  | { type: 'browser'; url: string }
  | { type: 'terminal'; cwd?: string; shell?: string; cols?: number; rows?: number }
  | { type: 'file'; path: string }

// [preload] 这个 api 对象就是 renderer 能看到的 window.api。
// 每个方法内部 ipcRenderer.invoke(channel, args),对应 main 里 ipcMain.handle(channel, ...)。
// 保持纯函数入口,types 从 shared/ 导入,main 和 renderer 就契约对齐了。
const api = {
  ping: () =>
    ipcRenderer.invoke(IPC.PING) as Promise<{ pong: boolean; at: string }>,

  agent: {
    current: () => ipcRenderer.invoke(IPC.AGENT_CURRENT) as Promise<AgentMeta>,
    list: () => ipcRenderer.invoke(IPC.AGENT_LIST) as Promise<AgentMeta[]>,
  },

  session: {
    list: () => ipcRenderer.invoke(IPC.SESSION_LIST) as Promise<SessionMeta[]>,
    create: (args: CreateSessionArgs) =>
      ipcRenderer.invoke(IPC.SESSION_CREATE, args) as Promise<SessionMeta>,
    addWorkspace: (path: string, name?: string) =>
      ipcRenderer.invoke(IPC.SESSION_ADD_WORKSPACE, { path, name }) as Promise<SessionMeta>,
    rename: (id: string, name: string) =>
      ipcRenderer.invoke(IPC.SESSION_RENAME, { id, name }) as Promise<void>,
    delete: (id: string) =>
      ipcRenderer.invoke(IPC.SESSION_DELETE, id) as Promise<void>,
    loadMessages: (id: string) =>
      ipcRenderer.invoke(IPC.SESSION_LOAD_MESSAGES, id) as Promise<ChatMessage[]>,
  },

  tab: {
    list: (sessionId: string) =>
      ipcRenderer.invoke(IPC.TAB_LIST, sessionId) as Promise<TabMeta[]>,
    open: (sessionId: string, args: OpenTabArgs) =>
      ipcRenderer.invoke(IPC.TAB_OPEN, { sessionId, args }) as Promise<TabMeta>,
    close: (tabId: string) =>
      ipcRenderer.invoke(IPC.TAB_CLOSE, tabId) as Promise<void>,
    focus: (tabId: string) =>
      ipcRenderer.invoke(IPC.TAB_FOCUS, tabId) as Promise<void>,
    hideAll: () => ipcRenderer.invoke(IPC.TAB_HIDE_ALL) as Promise<void>,
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC.TAB_SET_BOUNDS, bounds) as Promise<void>,
    navigate: (tabId: string, url: string) =>
      ipcRenderer.invoke(IPC.TAB_NAVIGATE, { tabId, url }) as Promise<void>,
    switchSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC.TAB_SWITCH_SESSION, sessionId) as Promise<TabMeta[]>,
    popupTypeMenu: () =>
      ipcRenderer.invoke(IPC.TAB_POPUP_TYPE_MENU) as Promise<
        'browser' | 'terminal' | 'file' | 'file-new' | null
      >,
  },

  // 文件相关:原生 picker + 读写 + 在 workspace 下新建
  file: {
    pickOpen: () => ipcRenderer.invoke(IPC.FILE_PICK_OPEN) as Promise<string | null>,
    read: (path: string) => ipcRenderer.invoke(IPC.FILE_READ, path) as Promise<string>,
    write: (path: string, content: string) =>
      ipcRenderer.invoke(IPC.FILE_WRITE, { path, content }) as Promise<void>,
    createInSession: (sessionId: string, filename: string) =>
      ipcRenderer.invoke(IPC.FILE_CREATE_IN_SESSION, { sessionId, filename }) as Promise<string>,
    listDir: (absPath: string) =>
      ipcRenderer.invoke(IPC.FILE_LIST_DIR, absPath) as Promise<
        Array<{ name: string; isDir: boolean }>
      >,
  },

  // 终端相关: renderer ↔ main pty
  terminal: {
    write: (tabId: string, data: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_WRITE, { tabId, data }) as Promise<void>,
    resize: (tabId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, { tabId, cols, rows }) as Promise<void>,
    getBuffer: (tabId: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_GET_BUFFER, tabId) as Promise<string>,
    // 订阅 pty 数据流。返回 unsubscribe 函数,组件卸载时调。
    onData: (tabId: string, handler: (data: string) => void) => {
      const channel = ptyChannel.data(tabId)
      const listener = (_e: unknown, data: string) => handler(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.off(channel, listener)
    },
    onExit: (tabId: string, handler: (exitCode: number) => void) => {
      const channel = ptyChannel.exit(tabId)
      const listener = (_e: unknown, code: number) => handler(code)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.off(channel, listener)
    },
  },
}

// 本项目 main 里强制 contextIsolation: true,只走这个分支;
// exposeInMainWorld(name, value) → window[name] = value(在隔离的 renderer context 里)
try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}

// renderer 侧通过 env.d.ts 引用这个类型来获得 window.api 的自动补全
export type SilentAgentAPI = typeof api
