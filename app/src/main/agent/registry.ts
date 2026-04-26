// [main · 纯业务, 不 import 'electron']
// Agent 注册表:暴露 agent 列表 / 单个 agent / 默认 agent 的业务层 API。
// 所有 IO 经过 StorageAdapter,便于未来切换实现或 mock 测试。

import type { AgentMeta } from '@shared/types'
import type { StorageAdapter } from '../storage/adapter'

export class AgentRegistry {
  constructor(private storage: StorageAdapter) {}

  list(): Promise<AgentMeta[]> {
    return this.storage.listAgents()
  }

  get(agentId: string): Promise<AgentMeta> {
    return this.storage.getAgent(agentId)
  }

  /** 启动时调,保证至少有一个 agent 存在。返回 default agent meta。 */
  ensureDefault(): Promise<AgentMeta> {
    return this.storage.ensureDefaultAgent()
  }
}
