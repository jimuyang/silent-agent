// [main · 纯业务, 不 import 'electron']
// StorageAdapter 是所有数据落盘的抽象契约。
// MVP: LocalFsAdapter 用本地文件系统实现。
// 未来: CloudSyncAdapter wraps LocalFsAdapter,双写 + 本地优先。

import type {
  AgentMeta,
  ChatMessage,
  CreateWorkspaceArgs,
  WorkspaceEvent,
  WorkspaceMeta,
  TabMeta,
} from '@shared/types'

export interface StorageAdapter {
  // ----- Agents -----
  listAgents(): Promise<AgentMeta[]>
  getAgent(agentId: string): Promise<AgentMeta>
  ensureDefaultAgent(): Promise<AgentMeta>

  // ----- Workspaces (scoped by agentId) -----
  listWorkspaces(agentId: string): Promise<WorkspaceMeta[]>
  getWorkspace(agentId: string, workspaceId: string): Promise<WorkspaceMeta>
  createWorkspace(agentId: string, args: CreateWorkspaceArgs): Promise<WorkspaceMeta>
  /**
   * 把一个已有的外部文件夹纳为 workspace(类比 `git init`)。
   * 会在该文件夹下建 `.silent/` + meta.yaml + 其他内部文件,并登记到 agent 的 workspaces 索引。
   * 返回的 WorkspaceMeta.path 是传入的 wsPath(绝对路径)。
   */
  addWorkspace(agentId: string, wsPath: string, name?: string): Promise<WorkspaceMeta>
  /** 把 workspaceId 解析到绝对 workspace path(默认位置或外部) */
  resolveWorkspacePath(agentId: string, workspaceId: string): Promise<string>
  renameWorkspace(agentId: string, workspaceId: string, name: string): Promise<void>
  deleteWorkspace(agentId: string, workspaceId: string): Promise<void>
  touchWorkspace(agentId: string, workspaceId: string): Promise<void>

  // ----- Messages -----
  loadMessages(agentId: string, workspaceId: string): Promise<ChatMessage[]>
  appendMessage(agentId: string, workspaceId: string, msg: ChatMessage): Promise<void>

  // ----- Events (workspace 级单一时间线) -----
  appendEvent(agentId: string, workspaceId: string, event: WorkspaceEvent): Promise<void>

  // ----- Tabs (per workspace) -----
  getTabs(agentId: string, workspaceId: string): Promise<TabMeta[]>
  setTabs(agentId: string, workspaceId: string, tabs: TabMeta[]): Promise<void>

  // ----- App state -----
  getAppState(): Promise<AppState>
  setAppState(patch: Partial<AppState>): Promise<AppState>
}

export interface AppState {
  lastAgentId?: string
  lastWorkspaceId?: Record<string, string>  // agentId → workspaceId
  windowBounds?: { x: number; y: number; width: number; height: number }
}
