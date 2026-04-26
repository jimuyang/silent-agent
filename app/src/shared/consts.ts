// 跨 main / renderer 共用的路径常量。
// 所有涉及 session 内部目录布局的字符串都走这里,单一真相源。
// 改这里就等于全局改,不要把这些 string 散落到多处。

/**
 * Workspace / Session 的**标记目录**。任意文件夹里有 .silent/,就是一个 Silent Agent 工作区,
 * 类似 git 的 .git/ 之于 repo。Silent Agent 的所有内部产物都在这下面。
 */
export const SILENT_DIR = '.silent'

/** .silent/ 下 browser/terminal tab 的产物子目录名 */
export const TABS_SUBDIR = 'tabs'

/** .silent/ 下的关键文件名 */
export const FILES = {
  /** 会话元数据 */
  META: 'meta.yaml',
  /** silent-chat tab 的对话全文 */
  MESSAGES: 'messages.jsonl',
  /** Session 级单一事件时间线 */
  EVENTS: 'events.jsonl',
  /** Tab 索引 */
  TABS_INDEX: 'tabs.json',
} as const

/** .silent/ 下子目录名 */
export const SUBDIRS = {
  TABS: 'tabs',
  STATE: 'state',
  CONTEXT: 'context',
} as const

/** silent-chat 作为 tab 的保留 id + path 常量(path 相对 session 根) */
export const SILENT_CHAT_TAB_ID = 'silent-chat'
export const SILENT_CHAT_TAB_PATH = `${SILENT_DIR}/${FILES.MESSAGES}`

/** 构造一个 tab 产物子目录的相对 path(用于 TabMeta.path) */
export function tabRelPath(tabId: string): string {
  return `${SILENT_DIR}/${TABS_SUBDIR}/${tabId}`
}

/** Agent 下的 session 索引文件名(存所有已知 workspace 条目:id + 可选外部 path) */
export const SESSIONS_INDEX_FILENAME = '_index.json'
