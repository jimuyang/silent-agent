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

// --- Sessions (scoped by agent) ---
export const sessionsDir = (agentId: string) => join(agentDir(agentId), 'sessions')
export const sessionsIndexFile = (agentId: string) => join(sessionsDir(agentId), '_index.json')

export const sessionDir = (agentId: string, sessionId: string) =>
  join(sessionsDir(agentId), sessionId)

/**
 * Session 内部管理文件集中目录(= `<sessionDir>/.silent`)。
 * `.silent/` 是 workspace 标记(见 `shared/consts.ts SILENT_DIR`),
 * 类似 `.git/` —— 任意文件夹里有它就是一个 Silent Agent 工作区。
 */
export const sessionInternalDir = (agentId: string, sessionId: string) =>
  join(sessionDir(agentId, sessionId), SILENT_DIR)

export const sessionMetaFile = (agentId: string, sessionId: string) =>
  join(sessionInternalDir(agentId, sessionId), FILES.META)
export const sessionMessagesFile = (agentId: string, sessionId: string) =>
  join(sessionInternalDir(agentId, sessionId), FILES.MESSAGES)
export const sessionEventsFile = (agentId: string, sessionId: string) =>
  join(sessionInternalDir(agentId, sessionId), FILES.EVENTS)
export const sessionContextDir = (agentId: string, sessionId: string) =>
  join(sessionInternalDir(agentId, sessionId), SUBDIRS.CONTEXT)
export const sessionContextFile = (
  agentId: string,
  sessionId: string,
  source: 'browser' | 'files' | 'shell',
) => join(sessionContextDir(agentId, sessionId), `${source}.jsonl`)
export const sessionStateDir = (agentId: string, sessionId: string) =>
  join(sessionInternalDir(agentId, sessionId), SUBDIRS.STATE)
export const sessionTabsFile = (agentId: string, sessionId: string) =>
  join(sessionStateDir(agentId, sessionId), FILES.TABS_INDEX)

/** 某 tab 的产物目录:browser snapshot / terminal buffer.log 放这 */
export const sessionTabDir = (agentId: string, sessionId: string, tabId: string) =>
  join(sessionInternalDir(agentId, sessionId), SUBDIRS.TABS, tabId)

// ===== Workspace-level paths(取任意绝对路径作为 session 根)=====
// 上面的 sessionXxx(agentId, sessionId) 针对"app 默认托管位置",
// 这些 workspaceXxx(wsPath) 是通用版,可用于任何外部文件夹。
// LocalFsAdapter 内部会先把 sessionId 解析成 wsPath,再调这些。

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
