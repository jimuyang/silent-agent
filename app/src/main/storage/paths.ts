// [main · 纯业务, 不 import 'electron']
// ~/.silent-agent/ 下所有路径的集中定义。
// 为什么不用 electron 的 app.getPath('userData'):那个路径平台依赖且和 macOS 应用签名绑定,
// 当前设计目标是"可见、可 grep、可 git"的家目录路径 ~/.silent-agent/,更符合 everything-is-file 原则。
//
// ★ 二分约定:`.silent/` 顶层 = git tracked,`.silent/runtime/` 子目录 = .gitignore 整目录。
// 详见 design/02-architecture.md / design/08-vcs.md。

import { homedir } from 'node:os'
import { join } from 'node:path'

import { SILENT_DIR, RUNTIME_DIR, RUNTIME_SUBDIRS, FILES } from '@shared/consts'

export const ROOT = join(homedir(), '.silent-agent')

// --- App level ---
export const appStateFile = () => join(ROOT, 'app-state.json')
export const appConfigFile = () => join(ROOT, 'app-config.yaml')
export const logsDir = () => join(ROOT, 'logs')

// --- Connections (MVP 占位, v0.2 实装) ---
export const connectionsDir = () => join(ROOT, 'connections')
export const connectionsIndexFile = () => join(connectionsDir(), '_index.json')

// --- Agents ---
export const agentsDir = () => join(ROOT, 'agents')
export const agentsIndexFile = () => join(agentsDir(), '_index.json')

export const agentDir = (agentId: string) => join(agentsDir(), agentId)
export const agentMetaFile = (agentId: string) => join(agentDir(agentId), 'meta.yaml')
export const agentMemoryDir = (agentId: string) => join(agentDir(agentId), 'memory')
export const agentSkillsDir = (agentId: string) => join(agentDir(agentId), 'skills')
export const agentKnowledgeDir = (agentId: string) => join(agentDir(agentId), 'knowledge')

// --- Workspaces (scoped by agent, 默认托管位置) ---
// 用户也可通过 addWorkspace 把任意外部路径登记为 workspace,
// 那种情况下不走默认位置,LocalFsAdapter 内的 _index.json entry 自带 path。

export const workspacesDir = (agentId: string) => join(agentDir(agentId), 'workspaces')
export const workspacesIndexFile = (agentId: string) => join(workspacesDir(agentId), '_index.json')

/** 默认托管位置下,某 workspace 的根目录(同 `<workspacesDir>/<wid>/`)。 */
export const managedWorkspaceDir = (agentId: string, workspaceId: string) =>
  join(workspacesDir(agentId), workspaceId)

// ===== Workspace-level paths(取任意绝对路径作为 workspace 根)=====
// LocalFsAdapter 内部把 workspaceId 解析成 wsPath 后,所有 .silent/ 内的产物
// 都走这组 wsPath-based helpers,跟"默认托管 vs 外挂"无关。
//
// 二分:
// - `workspaceInternalDir` (`.silent/`)            : git tracked 顶层
// - `workspaceRuntimeDir`  (`.silent/runtime/`)    : runtime / .gitignore

/** `.silent/` —— workspace 标识目录 + git tracked 顶层 */
export const workspaceInternalDir = (wsPath: string) => join(wsPath, SILENT_DIR)

/** `.silent/runtime/` —— 整目录 .gitignore(logs / cache / 历史切片) */
export const workspaceRuntimeDir = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), RUNTIME_DIR)

// ----- 进 git 的文件(.silent/ 顶层)-----

/** `.silent/meta.yaml` —— workspace 配置(进 git) */
export const workspaceMetaFile = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), FILES.META)

/** `.silent/tabs/<tid>/` —— browser/terminal tab 的 git tracked 目录(放 latest.* ) */
export const workspaceTabGitDir = (wsPath: string, tabId: string) =>
  join(workspaceInternalDir(wsPath), 'tabs', tabId)

/** `.silent/tabs/<tid>/latest.md` —— browser tab 当前页面(进 git) */
export const workspaceTabLatestMd = (wsPath: string, tabId: string) =>
  join(workspaceTabGitDir(wsPath, tabId), FILES.TAB_LATEST_MD)

/** `.silent/tabs/<tid>/latest-cmd.log` —— terminal tab 最近命令输出(进 git) */
export const workspaceTabLatestCmdLog = (wsPath: string, tabId: string) =>
  join(workspaceTabGitDir(wsPath, tabId), FILES.TAB_LATEST_CMD_LOG)

// ----- runtime 文件(.silent/runtime/ 内,不进 git)-----

/** `.silent/runtime/main_chat.jsonl` —— main_chat agent 对话流(replaces 原 messages.jsonl) */
export const workspaceMainChatFile = (wsPath: string) =>
  join(workspaceRuntimeDir(wsPath), FILES.MAIN_CHAT)

/** `.silent/runtime/main_review.jsonl` —— main_review agent 对话流 */
export const workspaceMainReviewFile = (wsPath: string) =>
  join(workspaceRuntimeDir(wsPath), FILES.MAIN_REVIEW)

/** `.silent/runtime/events.jsonl` —— workspace 时序日志 */
export const workspaceEventsFile = (wsPath: string) =>
  join(workspaceRuntimeDir(wsPath), FILES.EVENTS)

/** `.silent/runtime/tabs.json` —— UI 状态(disk 当前态恢复用) */
export const workspaceTabsFile = (wsPath: string) =>
  join(workspaceRuntimeDir(wsPath), FILES.TABS_INDEX)

/** `.silent/runtime/layout.json` —— 主区分栏比例 + 后续布局状态 */
export const workspaceLayoutFile = (wsPath: string) =>
  join(workspaceRuntimeDir(wsPath), FILES.LAYOUT)

/** `.silent/runtime/state/` —— runtime cache(cookies / last-active.json / cache/) */
export const workspaceStateDir = (wsPath: string) =>
  join(workspaceRuntimeDir(wsPath), RUNTIME_SUBDIRS.STATE)

/** `.silent/runtime/tabs/<tid>/` —— tab 历史产物目录(buffer.log + snapshots/) */
export const workspaceTabDir = (wsPath: string, tabId: string) =>
  join(workspaceRuntimeDir(wsPath), RUNTIME_SUBDIRS.TABS, tabId)

/** `.silent/runtime/tabs/<tid>/buffer.log` —— pty raw 流 */
export const workspaceTabBufferLog = (wsPath: string, tabId: string) =>
  join(workspaceTabDir(wsPath, tabId), FILES.BUFFER_LOG)

/** `.silent/runtime/tabs/<tid>/snapshots/` —— immutable NNN 切片 */
export const workspaceTabSnapshotsDir = (wsPath: string, tabId: string) =>
  join(workspaceTabDir(wsPath, tabId), RUNTIME_SUBDIRS.SNAPSHOTS)

// ----- 旧布局兼容(用于 migrate) -----

/** 旧布局:`.silent/messages.jsonl`(已 rename + 移到 runtime/main_chat.jsonl) */
export const legacyWorkspaceMessagesFile = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), 'messages.jsonl')

/** 旧布局:`.silent/events.jsonl`(已移到 runtime/events.jsonl) */
export const legacyWorkspaceEventsFile = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), 'events.jsonl')

/** 旧布局:`.silent/state/tabs.json`(已移到 runtime/tabs.json) */
export const legacyWorkspaceTabsFile = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), 'state', 'tabs.json')

/** 旧布局:`.silent/state/`(整体已搬到 runtime/state/) */
export const legacyWorkspaceStateDir = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), 'state')

/** 旧布局:`.silent/tabs/<tid>/`(部分搬到 runtime/tabs/<tid>/,如 buffer.log) */
export const legacyWorkspaceTabDir = (wsPath: string, tabId: string) =>
  join(workspaceInternalDir(wsPath), 'tabs', tabId)
