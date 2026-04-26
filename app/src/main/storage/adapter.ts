// [main · 纯业务, 不 import 'electron']
// StorageAdapter 是所有数据落盘的抽象契约。
// MVP: LocalFsAdapter 用本地文件系统实现。
// 未来: CloudSyncAdapter wraps LocalFsAdapter,双写 + 本地优先。

import type {
  AgentMeta,
  ChatMessage,
  CreateSessionArgs,
  ObservationEvent,
  ObservationSource,
  SessionMeta,
  TabMeta,
} from '@shared/types'

export interface StorageAdapter {
  // ----- Agents -----
  listAgents(): Promise<AgentMeta[]>
  getAgent(agentId: string): Promise<AgentMeta>
  ensureDefaultAgent(): Promise<AgentMeta>

  // ----- Sessions (scoped by agentId) -----
  listSessions(agentId: string): Promise<SessionMeta[]>
  getSession(agentId: string, sessionId: string): Promise<SessionMeta>
  createSession(agentId: string, args: CreateSessionArgs): Promise<SessionMeta>
  /**
   * 把一个已有的外部文件夹纳为 session(类比 `git init`)。
   * 会在该文件夹下建 `.silent/` + meta.yaml + 其他内部文件,并登记到 agent 的 sessions 索引。
   * 返回的 SessionMeta.path 是传入的 wsPath(绝对路径)。
   */
  addWorkspace(agentId: string, wsPath: string, name?: string): Promise<SessionMeta>
  /** 把 sessionId 解析到绝对 workspace path(默认位置或外部) */
  resolveSessionPath(agentId: string, sessionId: string): Promise<string>
  renameSession(agentId: string, sessionId: string, name: string): Promise<void>
  deleteSession(agentId: string, sessionId: string): Promise<void>
  touchSession(agentId: string, sessionId: string): Promise<void>

  // ----- Messages -----
  loadMessages(agentId: string, sessionId: string): Promise<ChatMessage[]>
  appendMessage(agentId: string, sessionId: string, msg: ChatMessage): Promise<void>

  // ----- Observation -----
  appendObservation(
    agentId: string,
    sessionId: string,
    source: ObservationSource,
    event: ObservationEvent,
  ): Promise<void>

  // ----- Tabs (per session) -----
  getTabs(agentId: string, sessionId: string): Promise<TabMeta[]>
  setTabs(agentId: string, sessionId: string, tabs: TabMeta[]): Promise<void>

  // ----- App state -----
  getAppState(): Promise<AppState>
  setAppState(patch: Partial<AppState>): Promise<AppState>
}

export interface AppState {
  lastAgentId?: string
  lastSessionId?: Record<string, string>  // agentId → sessionId
  windowBounds?: { x: number; y: number; width: number; height: number }
}
