// [main · 纯业务, 不 import 'electron']
// Session 业务层。封装创建 / 查询 / 消息读写。

import { randomUUID } from 'node:crypto'

import type { ChatMessage, CreateSessionArgs, SessionMeta } from '@shared/types'
import type { StorageAdapter } from '../storage/adapter'

export class SessionService {
  constructor(private storage: StorageAdapter) {}

  list(agentId: string): Promise<SessionMeta[]> {
    return this.storage.listSessions(agentId)
  }

  get(agentId: string, sessionId: string): Promise<SessionMeta> {
    return this.storage.getSession(agentId, sessionId)
  }

  async create(agentId: string, args: CreateSessionArgs): Promise<SessionMeta> {
    return this.storage.createSession(agentId, args)
  }

  /** 把任意已有文件夹纳为 session(类比 git init) */
  async addWorkspace(
    agentId: string,
    wsPath: string,
    name?: string,
  ): Promise<SessionMeta> {
    return this.storage.addWorkspace(agentId, wsPath, name)
  }

  rename(agentId: string, sessionId: string, name: string): Promise<void> {
    return this.storage.renameSession(agentId, sessionId, name)
  }

  delete(agentId: string, sessionId: string): Promise<void> {
    return this.storage.deleteSession(agentId, sessionId)
  }

  loadMessages(agentId: string, sessionId: string): Promise<ChatMessage[]> {
    return this.storage.loadMessages(agentId, sessionId)
  }

  async appendMessage(
    agentId: string,
    sessionId: string,
    msg: Omit<ChatMessage, 'id' | 'createdAt'> & Partial<Pick<ChatMessage, 'id' | 'createdAt'>>,
  ): Promise<ChatMessage> {
    const full: ChatMessage = {
      id: msg.id ?? randomUUID(),
      createdAt: msg.createdAt ?? new Date().toISOString(),
      role: msg.role,
      content: msg.content,
    }
    await this.storage.appendMessage(agentId, sessionId, full)
    return full
  }

  /**
   * 启动 guard:某个 agent 如果一条 session 都没有,建一个 welcome chat。
   * 返回该 agent 的第一条 session(新的或已存在的)。
   */
  async ensureHasSession(agentId: string): Promise<SessionMeta> {
    const existing = await this.list(agentId)
    if (existing.length > 0) return existing[0]!

    const welcome = await this.create(agentId, {
      type: 'chat',
      name: '欢迎',
    })
    await this.appendMessage(agentId, welcome.id, {
      role: 'agent',
      content:
        '欢迎使用 Silent Agent v0.1。壳已就绪,文件系统已初始化。\n\n' +
        '现在左栏列表是真实的(来自磁盘),新建会话会落到 ~/.silent-agent/ 下。\n' +
        '后续会加浏览器 / 终端 / 文件 tab,再接 Claude API。',
    })
    return welcome
  }
}
