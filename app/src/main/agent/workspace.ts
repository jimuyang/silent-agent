// [main · 纯业务, 不 import 'electron']
// Workspace 业务层。封装创建 / 查询 / 消息读写。

import { randomUUID } from 'node:crypto'

import type { ChatMessage, CreateWorkspaceArgs, WorkspaceMeta } from '@shared/types'
import type { StorageAdapter } from '../storage/adapter'

export class WorkspaceService {
  constructor(private storage: StorageAdapter) {}

  list(agentId: string): Promise<WorkspaceMeta[]> {
    return this.storage.listWorkspaces(agentId)
  }

  get(agentId: string, workspaceId: string): Promise<WorkspaceMeta> {
    return this.storage.getWorkspace(agentId, workspaceId)
  }

  async create(agentId: string, args: CreateWorkspaceArgs): Promise<WorkspaceMeta> {
    return this.storage.createWorkspace(agentId, args)
  }

  /** 把任意已有文件夹纳为 workspace(类比 git init) */
  async addWorkspace(
    agentId: string,
    wsPath: string,
    name?: string,
  ): Promise<WorkspaceMeta> {
    return this.storage.addWorkspace(agentId, wsPath, name)
  }

  rename(agentId: string, workspaceId: string, name: string): Promise<void> {
    return this.storage.renameWorkspace(agentId, workspaceId, name)
  }

  delete(agentId: string, workspaceId: string): Promise<void> {
    return this.storage.deleteWorkspace(agentId, workspaceId)
  }

  loadMessages(agentId: string, workspaceId: string): Promise<ChatMessage[]> {
    return this.storage.loadMessages(agentId, workspaceId)
  }

  async appendMessage(
    agentId: string,
    workspaceId: string,
    msg: Omit<ChatMessage, 'id' | 'createdAt'> & Partial<Pick<ChatMessage, 'id' | 'createdAt'>>,
  ): Promise<ChatMessage> {
    const full: ChatMessage = {
      id: msg.id ?? randomUUID(),
      createdAt: msg.createdAt ?? new Date().toISOString(),
      role: msg.role,
      content: msg.content,
    }
    await this.storage.appendMessage(agentId, workspaceId, full)
    return full
  }

  /**
   * 启动 guard:某个 agent 如果一条 workspace 都没有,建一个 welcome chat。
   * 返回该 agent 的第一条 workspace(新的或已存在的)。
   */
  async ensureHasWorkspace(agentId: string): Promise<WorkspaceMeta> {
    const existing = await this.list(agentId)
    if (existing.length > 0) return existing[0]!

    const welcome = await this.create(agentId, { name: '欢迎' })
    await this.appendMessage(agentId, welcome.id, {
      role: 'agent',
      content:
        '欢迎使用 Silent Agent v0.1。壳已就绪,文件系统已初始化。\n\n' +
        '现在左栏列表是真实的(来自磁盘),新建工作区会落到 ~/.silent-agent/ 下。\n' +
        '后续会加浏览器 / 终端 / 文件 tab,再接 Claude API。',
    })
    return welcome
  }
}
