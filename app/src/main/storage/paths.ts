// [main · 纯业务, 不 import 'electron']
// ~/.silent-agent/ 下所有路径的集中定义。
// 为什么不用 electron 的 app.getPath('userData'):那个路径平台依赖且和 macOS 应用签名绑定,
// 当前设计目标是"可见、可 grep、可 git"的家目录路径 ~/.silent-agent/,更符合 everything-is-file 原则。

import { homedir } from 'node:os'
import { join } from 'node:path'

import { SILENT_DIR, FILES, SUBDIRS } from '@shared/consts'

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

export const workspaceInternalDir = (wsPath: string) => join(wsPath, SILENT_DIR)
export const workspaceMetaFile = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), FILES.META)
export const workspaceMessagesFile = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), FILES.MESSAGES)
export const workspaceEventsFile = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), FILES.EVENTS)
export const workspaceStateDir = (wsPath: string) =>
  join(workspaceInternalDir(wsPath), SUBDIRS.STATE)
export const workspaceTabsFile = (wsPath: string) =>
  join(workspaceStateDir(wsPath), FILES.TABS_INDEX)
export const workspaceTabDir = (wsPath: string, tabId: string) =>
  join(workspaceInternalDir(wsPath), SUBDIRS.TABS, tabId)
