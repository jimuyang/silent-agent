// [preload] 在 renderer 的 JS 执行前加载的桥接脚本。
// 因为 contextIsolation=true,renderer 不能直接调 Node / Electron API。
// 我们在这里用 contextBridge 把"白名单"方法挂到 renderer 的 window.xxx 上。

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import { IPC, ptyChannel, chatChannel } from '../shared/ipc'
import type {
  AgentMeta,
  ChatMessage,
  CreateWorkspaceArgs,
  ReviewResult,
  WorkspaceLayout,
  WorkspaceMeta,
  TabMeta,
} from '../shared/types'

// open tab 的 args,按 type 判别
type OpenTabArgs =
  | { type: 'browser'; url: string }
  | { type: 'terminal'; cwd?: string; shell?: string; cols?: number; rows?: number; command?: { file: string; args: string[] } }
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

  workspace: {
    list: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST) as Promise<WorkspaceMeta[]>,
    create: (args: CreateWorkspaceArgs) =>
      ipcRenderer.invoke(IPC.WORKSPACE_CREATE, args) as Promise<WorkspaceMeta>,
    add: (path: string, name?: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_ADD, { path, name }) as Promise<WorkspaceMeta>,
    rename: (id: string, name: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_RENAME, { id, name }) as Promise<void>,
    delete: (id: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_DELETE, id) as Promise<void>,
    loadMessages: (id: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_LOAD_MESSAGES, id) as Promise<ChatMessage[]>,
    /** 在新 BrowserWindow 打开 workspace —— fresh 空 pane(用户右键 → "在新窗口打开") */
    openInNewWindow: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.WORKSPACE_OPEN_IN_NEW_WINDOW, workspaceId) as Promise<number>,
    /** 右键 workspace item 弹原生菜单。resolve 用户选项;cancel/click-away 时为 null */
    popupContextMenu: () =>
      ipcRenderer.invoke(IPC.WORKSPACE_POPUP_CONTEXT_MENU) as Promise<
        'open-in-new-window' | null
      >,
  },

  tab: {
    list: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.TAB_LIST, workspaceId) as Promise<TabMeta[]>,
    open: (workspaceId: string, args: OpenTabArgs) =>
      ipcRenderer.invoke(IPC.TAB_OPEN, { workspaceId, args }) as Promise<TabMeta>,
    duplicate: (tabId: string) =>
      ipcRenderer.invoke(IPC.TAB_DUPLICATE, tabId) as Promise<TabMeta>,
    detach: (tabId: string) =>
      ipcRenderer.invoke(IPC.TAB_DETACH, tabId) as Promise<number>,
    close: (tabId: string) =>
      ipcRenderer.invoke(IPC.TAB_CLOSE, tabId) as Promise<void>,
    focus: (tabId: string) =>
      ipcRenderer.invoke(IPC.TAB_FOCUS, tabId) as Promise<void>,
    hideTab: (tabId: string) => ipcRenderer.invoke(IPC.TAB_HIDE_TAB, tabId) as Promise<void>,
    setBoundsFor: (
      tabId: string,
      bounds: { x: number; y: number; width: number; height: number },
    ) => ipcRenderer.invoke(IPC.TAB_SET_BOUNDS_FOR, { tabId, bounds }) as Promise<void>,
    navigate: (tabId: string, url: string) =>
      ipcRenderer.invoke(IPC.TAB_NAVIGATE, { tabId, url }) as Promise<void>,
    switchWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.TAB_SWITCH_WORKSPACE, workspaceId) as Promise<{
        tabs: TabMeta[]
        layout: WorkspaceLayout
      }>,
    popupTypeMenu: () =>
      ipcRenderer.invoke(IPC.TAB_POPUP_TYPE_MENU) as Promise<
        'browser' | 'terminal' | 'file' | 'file-new' | null
      >,
    popupContextMenu: (state: { canClose: boolean; canDetach?: boolean }) =>
      ipcRenderer.invoke(IPC.TAB_POPUP_CONTEXT_MENU, state) as Promise<
        'split-right' | 'split-down' | 'detach' | 'close' | null
      >,
    // 订阅 main 主动建 tab 的事件(目前唯一来源:browser-tab window.open 拦截 → sibling tab)。
    // 返回 unsubscribe 函数,组件卸载时调。
    onOpened: (
      handler: (payload: {
        workspaceId: string
        meta: TabMeta
        /** 触发 window.open 的源 tab id —— 让 renderer 把新 tab 落到源 tab 所在的 pane */
        parentTabId?: string
      }) => void,
    ) => {
      const listener = (
        _e: unknown,
        payload: { workspaceId: string; meta: TabMeta; parentTabId?: string },
      ) => handler(payload)
      ipcRenderer.on(IPC.TAB_OPENED, listener)
      return () => {
        ipcRenderer.off(IPC.TAB_OPENED, listener)
      }
    },
  },

  // 文件相关:原生 picker + 读写 + 在 workspace 下新建
  file: {
    pickOpen: () => ipcRenderer.invoke(IPC.FILE_PICK_OPEN) as Promise<string | null>,
    read: (path: string) => ipcRenderer.invoke(IPC.FILE_READ, path) as Promise<string>,
    write: (path: string, content: string) =>
      ipcRenderer.invoke(IPC.FILE_WRITE, { path, content }) as Promise<void>,
    createInWorkspace: (workspaceId: string, filename: string) =>
      ipcRenderer.invoke(IPC.FILE_CREATE_IN_WORKSPACE, { workspaceId, filename }) as Promise<string>,
    listDir: (absPath: string) =>
      ipcRenderer.invoke(IPC.FILE_LIST_DIR, absPath) as Promise<
        Array<{ name: string; isDir: boolean }>
      >,
  },

  // 多窗口布局(per-workspace,持久化到 .silent/runtime/layout.json)
  layout: {
    get: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.LAYOUT_GET, workspaceId) as Promise<WorkspaceLayout>,
    set: (workspaceId: string, layout: Partial<WorkspaceLayout>) =>
      ipcRenderer.invoke(IPC.LAYOUT_SET, { workspaceId, layout }) as Promise<WorkspaceLayout>,
    /** 细粒度:只改一个 window 的 root,避免多 window 并发写互覆盖 */
    setWindowRoot: (workspaceId: string, windowId: string, root: import('../shared/types').LayoutNode) =>
      ipcRenderer.invoke(IPC.LAYOUT_SET_WINDOW_ROOT, { workspaceId, windowId, root }) as Promise<WorkspaceLayout>,
  },

  // Review: spawn `claude -p` 在 workspace 跑 review,返回 markdown 建议 + session id
  review: {
    run: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.REVIEW_RUN, workspaceId) as Promise<ReviewResult>,
  },

  // Chat: 每个 workspace 一个长驻 `claude --continue` pty,作为该 workspace 的主 agent。
  // SilentChat 问答区直连;review 的"在主 agent 中继续"通过 chat.inject 喂消息。
  chat: {
    spawn: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.CHAT_SPAWN, workspaceId) as Promise<string>,
    write: (workspaceId: string, data: string) =>
      ipcRenderer.invoke(IPC.CHAT_WRITE, { workspaceId, data }) as Promise<boolean>,
    resize: (workspaceId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.CHAT_RESIZE, { workspaceId, cols, rows }) as Promise<void>,
    getBuffer: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.CHAT_GET_BUFFER, workspaceId) as Promise<string>,
    inject: (workspaceId: string, text: string) =>
      ipcRenderer.invoke(IPC.CHAT_INJECT, { workspaceId, text }) as Promise<boolean>,
    kill: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.CHAT_KILL, workspaceId) as Promise<void>,
    onData: (workspaceId: string, handler: (data: string) => void) => {
      const channel = chatChannel.data(workspaceId)
      const listener = (_e: unknown, data: string) => handler(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.off(channel, listener)
    },
    onExit: (workspaceId: string, handler: (exitCode: number) => void) => {
      const channel = chatChannel.exit(workspaceId)
      const listener = (_e: unknown, code: number) => handler(code)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.off(channel, listener)
    },
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
