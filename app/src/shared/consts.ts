// 跨 main / renderer 共用的路径常量。
// 所有涉及 workspace 内部目录布局的字符串都走这里,单一真相源。
// 改这里就等于全局改,不要把这些 string 散落到多处。
//
// ★ 二分约定(参考 design/02-architecture.md / design/08-vcs.md):
// - `.silent/` 顶层 = git tracked(workspace 当前真状态:meta + tabs/<tid>/latest.{md,log})
// - `.silent/runtime/` 子目录 = .gitignore 整目录(events / main_chat / main_review / tabs.json /
//   snapshots/ / buffer.log / state/ 全部在 runtime 内)

/**
 * Workspace 的**标记目录**。任意文件夹里有 .silent/,就是一个 Silent Agent 工作区,
 * 类似 git 的 .git/ 之于 repo。Silent Agent 的所有内部产物都在这下面。
 */
export const SILENT_DIR = '.silent'

/** `.silent/runtime/` —— logs / cache / 历史切片,整目录 .gitignore */
export const RUNTIME_DIR = 'runtime'

/** tab 产物子目录名(在两层都用:`.silent/tabs/<tid>/` git tracked latest.* / `.silent/runtime/tabs/<tid>/` 历史) */
export const TABS_SUBDIR = 'tabs'

/** .silent/ 下的关键文件名(分两类:git tracked / runtime) */
export const FILES = {
  // ===== git tracked(.silent/ 顶层)=====
  /** workspace 配置:name / linkedFolder */
  META: 'meta.yaml',
  /** browser tab 当前页面(Defuddle 抽出),`.silent/tabs/<tid>/latest.md` */
  TAB_LATEST_MD: 'latest.md',
  /** terminal tab 最近命令输出,`.silent/tabs/<tid>/latest-cmd.log` */
  TAB_LATEST_CMD_LOG: 'latest-cmd.log',

  // ===== runtime(.silent/runtime/ 内,不进 git)=====
  /** main_chat agent 对话流(replaces 原 messages.jsonl) */
  MAIN_CHAT: 'main_chat.jsonl',
  /** main_review agent 对话流(新增) */
  MAIN_REVIEW: 'main_review.jsonl',
  /** Workspace 级事件时间线(2 层 schema 的 Layer 1) */
  EVENTS: 'events.jsonl',
  /** Tab 索引(UI 状态) */
  TABS_INDEX: 'tabs.json',
  /** Terminal pty raw 数据流 */
  BUFFER_LOG: 'buffer.log',
} as const

/** runtime 内的子目录 */
export const RUNTIME_SUBDIRS = {
  TABS: 'tabs',                    // runtime/tabs/<tid>/{snapshots,buffer.log}
  STATE: 'state',                  // runtime/state/{cookies,cache,last-active.json}
  SNAPSHOTS: 'snapshots',          // runtime/tabs/<tid>/snapshots/NNN-*.{md,log}
} as const

/** silent-chat 作为 tab 的保留 id + path 常量(path 相对 workspace 根)
 *  指向 main_chat agent 的对话流(在 runtime/ 内) */
export const SILENT_CHAT_TAB_ID = 'silent-chat'
export const SILENT_CHAT_TAB_PATH = `${SILENT_DIR}/${RUNTIME_DIR}/${FILES.MAIN_CHAT}`

/** browser/terminal tab 产物子目录(.silent/runtime/tabs/<tid>/,装 snapshots + buffer.log) */
export function tabRuntimeDir(tabId: string): string {
  return `${SILENT_DIR}/${RUNTIME_DIR}/${TABS_SUBDIR}/${tabId}`
}

/** 兼容旧名字 —— TabMeta.path 沿用此形态(指向 runtime 下的 tab 产物目录) */
export function tabRelPath(tabId: string): string {
  return tabRuntimeDir(tabId)
}

/** browser/terminal tab 在 git tracked 顶层的目录(装 latest.md / latest-cmd.log) */
export function tabGitDir(tabId: string): string {
  return `${SILENT_DIR}/${TABS_SUBDIR}/${tabId}`
}

/** Agent 下的 workspace 索引文件名(存所有已知 workspace 条目:id + 可选外部 path) */
export const WORKSPACES_INDEX_FILENAME = '_index.json'
