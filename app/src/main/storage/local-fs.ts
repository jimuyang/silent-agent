// [main · 纯业务, 不 import 'electron']
// LocalFsAdapter: StorageAdapter 的本地文件系统实现。
// 真相源: yaml / jsonl / md 文件,位于 ~/.silent-agent/。
// _index.json 是目录扫描的 cache,启动时读,不命中重建。

import { mkdir, readdir, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

import type { StorageAdapter, AppState } from './adapter'
import type {
  AgentMeta,
  ChatMessage,
  CreateSessionArgs,
  ObservationEvent,
  ObservationSource,
  SessionMeta,
  TabMeta,
} from '@shared/types'
import {
  SILENT_DIR,
  SILENT_CHAT_TAB_ID,
  SILENT_CHAT_TAB_PATH,
  tabRelPath,
} from '@shared/consts'
import * as P from './paths'
import { appendLine, readLines } from './jsonl'
import { readYaml, writeYamlAtomic, readJson, writeJsonAtomic } from './yaml'

const DEFAULT_AGENT_ID = 'silent-default'

/** _index.json 条目:有 path 是外部 workspace, 无 path 是默认托管位置 */
interface SessionIndexEntry {
  id: string
  path?: string
}
interface SessionIndex {
  entries: SessionIndexEntry[]
}

function nowIso() {
  return new Date().toISOString()
}

function shortHash(n = 4): string {
  return randomBytes(n).toString('hex').slice(0, n)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function yymmdd(d: Date): string {
  const y = String(d.getFullYear()).slice(2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${dd}`
}

/** 5a/SILENT_DIR 迁移工具:老 tabs.json 无 path 或老格式路径,统一到 .silent/ 下。 */
function derivePath(t: TabMeta): string {
  switch (t.type) {
    case 'silent-chat':
      return SILENT_CHAT_TAB_PATH
    case 'browser':
    case 'terminal':
      return tabRelPath(t.id)
    case 'file': {
      const legacyState = t.state as { path?: string } | null
      return legacyState?.path ?? ''
    }
    default:
      return ''
  }
}

/** 把老路径(`messages.jsonl` / `tabs/<tid>`)升级成 SILENT_DIR 前缀路径。 */
function upgradePath(t: TabMeta): TabMeta {
  const prefix = `${SILENT_DIR}/`
  if (!t.path) return { ...t, path: derivePath(t) }
  if (t.type === 'silent-chat' && !t.path.startsWith(prefix)) {
    return { ...t, path: SILENT_CHAT_TAB_PATH }
  }
  if ((t.type === 'browser' || t.type === 'terminal') && t.path.startsWith('tabs/')) {
    return { ...t, path: `${prefix}${t.path}` }
  }
  return t
}

export class LocalFsAdapter implements StorageAdapter {
  // ============ Agents ============

  async listAgents(): Promise<AgentMeta[]> {
    const idx = await readJson<{ ids: string[] }>(P.agentsIndexFile(), { ids: [] })
    // 读 meta 返回完整对象;_index.json 只是 id 列表作 cache
    const agents: AgentMeta[] = []
    for (const id of idx.ids) {
      try {
        agents.push(await this.getAgent(id))
      } catch {
        // meta 丢了, 跳过(_index.json 可能脏)
      }
    }
    // 如果 _index 是空但目录有, 重建
    if (agents.length === 0) {
      const rebuilt = await this.rebuildAgentsIndex()
      return rebuilt
    }
    return agents
  }

  async getAgent(agentId: string): Promise<AgentMeta> {
    return readYaml<AgentMeta>(P.agentMetaFile(agentId))
  }

  async ensureDefaultAgent(): Promise<AgentMeta> {
    try {
      return await this.getAgent(DEFAULT_AGENT_ID)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      return this.createDefaultAgent()
    }
  }

  private async createDefaultAgent(): Promise<AgentMeta> {
    const meta: AgentMeta = {
      id: DEFAULT_AGENT_ID,
      name: 'Silent Agent',
      avatar: 'S',
      model: 'claude-sonnet-4-6',
      systemPrompt:
        '你是 Silent Agent — 一个观察用户工作产物、帮助用户沉淀自动化的 AI 助理。' +
        '保持简洁、可操作、中文交流;行动前先说明意图,重要动作前确认。',
      createdAt: nowIso(),
      lastActiveAt: nowIso(),
    }
    await mkdir(P.agentMemoryDir(meta.id), { recursive: true })
    await mkdir(P.agentSkillsDir(meta.id), { recursive: true })
    await mkdir(P.agentKnowledgeDir(meta.id), { recursive: true })
    await mkdir(P.sessionsDir(meta.id), { recursive: true })
    await writeYamlAtomic(P.agentMetaFile(meta.id), meta)
    await this.addAgentToIndex(meta.id)
    return meta
  }

  private async rebuildAgentsIndex(): Promise<AgentMeta[]> {
    await mkdir(P.agentsDir(), { recursive: true })
    const entries = await readdir(P.agentsDir(), { withFileTypes: true }).catch(() => [])
    const ids = entries.filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name)
    await writeJsonAtomic(P.agentsIndexFile(), { ids })
    const agents: AgentMeta[] = []
    for (const id of ids) {
      try {
        agents.push(await this.getAgent(id))
      } catch {
        /* skip */
      }
    }
    return agents
  }

  private async addAgentToIndex(agentId: string): Promise<void> {
    const idx = await readJson<{ ids: string[] }>(P.agentsIndexFile(), { ids: [] })
    if (!idx.ids.includes(agentId)) {
      idx.ids.push(agentId)
      await writeJsonAtomic(P.agentsIndexFile(), idx)
    }
  }

  // ============ Sessions ============
  // _index.json 格式演进:
  //   老: { ids: string[] }                      (只记录 id, 物理位置=默认 sessionDir)
  //   新: { entries: [{id, path?}] }             (path 可选; 没填 → 默认位置, 有填 → 外部文件夹)
  // 读时自动 upgrade;只在有人 write 时持久化新格式。

  /** in-memory cache: sessionId → 绝对 workspace path */
  private pathCache = new Map<string, string>()

  private async readSessionsIndex(agentId: string): Promise<SessionIndex> {
    type LegacyIndex = { ids?: string[]; entries?: SessionIndexEntry[] }
    const raw = await readJson<LegacyIndex>(P.sessionsIndexFile(agentId), {})
    if (raw.entries) return { entries: raw.entries }
    // 迁移老格式
    if (raw.ids) return { entries: raw.ids.map((id) => ({ id })) }
    return { entries: [] }
  }

  private async writeSessionsIndex(agentId: string, idx: SessionIndex): Promise<void> {
    await writeJsonAtomic(P.sessionsIndexFile(agentId), idx)
  }

  /** 解析 sessionId 到绝对 workspace 路径。默认位置或外部皆可。 */
  async resolveSessionPath(agentId: string, sessionId: string): Promise<string> {
    const cached = this.pathCache.get(sessionId)
    if (cached) return cached
    const idx = await this.readSessionsIndex(agentId)
    const entry = idx.entries.find((e) => e.id === sessionId)
    const wsPath = entry?.path ?? P.sessionDir(agentId, sessionId)
    this.pathCache.set(sessionId, wsPath)
    return wsPath
  }

  async listSessions(agentId: string): Promise<SessionMeta[]> {
    let idx = await this.readSessionsIndex(agentId)
    const sessions: SessionMeta[] = []
    for (const entry of idx.entries) {
      const wsPath = entry.path ?? P.sessionDir(agentId, entry.id)
      this.pathCache.set(entry.id, wsPath)
      try {
        const meta = await readYaml<SessionMeta>(P.workspaceMetaFile(wsPath))
        // 对 renderer 暴露的 SessionMeta 永远带 path(绝对路径),便于文件树等组件使用
        sessions.push({ ...meta, path: wsPath })
      } catch {
        /* skip broken */
      }
    }
    if (sessions.length === 0 && idx.entries.length === 0) {
      return this.rebuildSessionsIndex(agentId)
    }
    sessions.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return sessions
  }

  async getSession(agentId: string, sessionId: string): Promise<SessionMeta> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    const meta = await readYaml<SessionMeta>(P.workspaceMetaFile(wsPath))
    meta.path = wsPath  // 永远带绝对路径
    return meta
  }

  async createSession(agentId: string, args: CreateSessionArgs): Promise<SessionMeta> {
    const now = new Date()
    const nameInput = args.name?.trim() || '新会话'
    const id = `${yymmdd(now)}-${shortHash(2)}-${slugify(nameInput) || 'session'}`
    const wsPath = P.sessionDir(agentId, id)  // 默认托管位置
    const meta: SessionMeta = {
      id,
      type: args.type ?? 'chat',
      name: nameInput,
      linkedFolder: args.linkedFolder,
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
    }
    await this.initWorkspaceAt(wsPath, meta)
    await this.addSessionToIndex(agentId, { id })  // 无 path = 默认位置
    this.pathCache.set(id, wsPath)
    return meta
  }

  async addWorkspace(
    agentId: string,
    wsPath: string,
    name?: string,
  ): Promise<SessionMeta> {
    const now = new Date()
    const nameInput = name?.trim() || wsPath.split('/').filter(Boolean).pop() || '工作区'
    const id = `${yymmdd(now)}-${shortHash(2)}-${slugify(nameInput) || 'workspace'}`
    const meta: SessionMeta = {
      id,
      type: 'chat',     // 旧字段,不再分支
      name: nameInput,
      path: wsPath,
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
    }
    await this.initWorkspaceAt(wsPath, meta)
    await this.addSessionToIndex(agentId, { id, path: wsPath })
    this.pathCache.set(id, wsPath)
    return meta
  }

  /** 在任意路径建 `.silent/` + meta + 初始 tabs.json。创 silent-chat tab。幂等。 */
  private async initWorkspaceAt(wsPath: string, meta: SessionMeta): Promise<void> {
    await mkdir(P.workspaceStateDir(wsPath), { recursive: true })
    await writeYamlAtomic(P.workspaceMetaFile(wsPath), meta)
    const silentChatTab: TabMeta = {
      id: SILENT_CHAT_TAB_ID,
      sessionId: meta.id,
      type: 'silent-chat',
      title: 'Silent Chat',
      pinned: true,
      path: SILENT_CHAT_TAB_PATH,
      state: null,
    }
    // 已存在时不覆盖用户已有 tabs
    try {
      await readJson<unknown>(P.workspaceTabsFile(wsPath))
    } catch {
      await writeJsonAtomic(P.workspaceTabsFile(wsPath), { tabs: [silentChatTab] })
    }
  }

  async renameSession(agentId: string, sessionId: string, name: string): Promise<void> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    const meta = await readYaml<SessionMeta>(P.workspaceMetaFile(wsPath))
    meta.name = name
    meta.lastActiveAt = nowIso()
    await writeYamlAtomic(P.workspaceMetaFile(wsPath), meta)
  }

  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    const idx = await this.readSessionsIndex(agentId)
    const entry = idx.entries.find((e) => e.id === sessionId)
    if (entry?.path) {
      // 外部 session: 只删 .silent/(不动用户文件)
      await rm(P.workspaceInternalDir(wsPath), { recursive: true, force: true })
    } else {
      // 默认位置: 整个 session 目录删
      await rm(wsPath, { recursive: true, force: true })
    }
    await this.removeSessionFromIndex(agentId, sessionId)
    this.pathCache.delete(sessionId)
  }

  async touchSession(agentId: string, sessionId: string): Promise<void> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    const meta = await readYaml<SessionMeta>(P.workspaceMetaFile(wsPath))
    meta.lastActiveAt = nowIso()
    await writeYamlAtomic(P.workspaceMetaFile(wsPath), meta)
  }

  private async rebuildSessionsIndex(agentId: string): Promise<SessionMeta[]> {
    const dir = P.sessionsDir(agentId)
    await mkdir(dir, { recursive: true })
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const entries: SessionIndexEntry[] = dirents
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => ({ id: e.name }))
    await this.writeSessionsIndex(agentId, { entries })
    const sessions: SessionMeta[] = []
    for (const entry of entries) {
      try {
        sessions.push(await this.getSession(agentId, entry.id))
      } catch {
        /* skip */
      }
    }
    sessions.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return sessions
  }

  private async addSessionToIndex(
    agentId: string,
    entry: SessionIndexEntry,
  ): Promise<void> {
    const idx = await this.readSessionsIndex(agentId)
    if (!idx.entries.some((e) => e.id === entry.id)) {
      idx.entries.push(entry)
      await this.writeSessionsIndex(agentId, idx)
    }
  }

  private async removeSessionFromIndex(
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    const idx = await this.readSessionsIndex(agentId)
    idx.entries = idx.entries.filter((e) => e.id !== sessionId)
    await this.writeSessionsIndex(agentId, idx)
  }

  // ============ Messages ============

  async loadMessages(agentId: string, sessionId: string): Promise<ChatMessage[]> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    return readLines<ChatMessage>(P.workspaceMessagesFile(wsPath))
  }

  async appendMessage(
    agentId: string,
    sessionId: string,
    msg: ChatMessage,
  ): Promise<void> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    await appendLine(P.workspaceMessagesFile(wsPath), msg)
    await this.touchSession(agentId, sessionId).catch(() => {})
  }

  // ============ Observation ============

  async appendObservation(
    agentId: string,
    sessionId: string,
    _source: ObservationSource,
    event: ObservationEvent,
  ): Promise<void> {
    // 统一走 session 级 events.jsonl, 老的 context/<source>.jsonl 弃用
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    await appendLine(P.workspaceEventsFile(wsPath), event)
  }

  // ============ Tabs ============

  async getTabs(agentId: string, sessionId: string): Promise<TabMeta[]> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    const data = await readJson<{ tabs: TabMeta[] }>(
      P.workspaceTabsFile(wsPath),
      { tabs: [] },
    )
    // 迁移:老 tabs.json 无 path → 按 type 推;老路径(messages.jsonl / tabs/xxx)→ 补 SILENT_DIR 前缀
    return data.tabs.map(upgradePath)
  }

  async setTabs(
    agentId: string,
    sessionId: string,
    tabs: TabMeta[],
  ): Promise<void> {
    const wsPath = await this.resolveSessionPath(agentId, sessionId)
    await writeJsonAtomic(P.workspaceTabsFile(wsPath), { tabs })
  }

  // ============ App state ============

  async getAppState(): Promise<AppState> {
    return readJson<AppState>(P.appStateFile(), {})
  }

  async setAppState(patch: Partial<AppState>): Promise<AppState> {
    const current = await this.getAppState()
    const next = { ...current, ...patch }
    await writeJsonAtomic(P.appStateFile(), next)
    return next
  }
}
