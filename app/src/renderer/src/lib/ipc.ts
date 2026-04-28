// [renderer]
// 薄包装 window.api,让组件 import 的时候更短,也便于将来加统一日志/错误处理。
// 本身不做任何业务逻辑。

export const ipc = {
  ping: () => window.api.ping(),
  agent: window.api.agent,
  workspace: window.api.workspace,
  tab: window.api.tab,
  terminal: window.api.terminal,
  file: window.api.file,
  review: window.api.review,
  chat: window.api.chat,
}

export type IpcClient = typeof ipc
