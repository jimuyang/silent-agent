// [main · 纯业务, 不 import 'electron']
// LocalFsAdapter: StorageAdapter 的本地文件系统实现。
// 真相源: yaml / jsonl / md 文件,位于 ~/.silent-agent/。
// _index.json 是目录扫描的 cache,启动时读,不命中重建。

import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

import type { StorageAdapter, AppState } from './adapter'
import type {
  AgentMeta,
  ChatMessage,
  CreateWorkspaceArgs,
  WorkspaceEvent,
  WorkspaceMeta,
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
interface WorkspaceIndexEntry {
  id: string
  path?: string
}
interface WorkspaceIndex {
  entries: WorkspaceIndexEntry[]
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
    await mkdir(P.workspacesDir(meta.id), { recursive: true })
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

  // ============ Workspaces ============
  // _index.json 格式演进:
  //   老: { ids: string[] }                      (只记录 id, 物理位置=默认 managedWorkspaceDir)
  //   新: { entries: [{id, path?}] }             (path 可选; 没填 → 默认位置, 有填 → 外部文件夹)
  // 读时自动 upgrade;只在有人 write 时持久化新格式。

  /** in-memory cache: workspaceId → 绝对 workspace path */
  private pathCache = new Map<string, string>()

  private async readWorkspacesIndex(agentId: string): Promise<WorkspaceIndex> {
    type LegacyIndex = { ids?: string[]; entries?: WorkspaceIndexEntry[] }
    const raw = await readJson<LegacyIndex>(P.workspacesIndexFile(agentId), {})
    if (raw.entries) return { entries: raw.entries }
    // 迁移老格式
    if (raw.ids) return { entries: raw.ids.map((id) => ({ id })) }
    return { entries: [] }
  }

  private async writeWorkspacesIndex(agentId: string, idx: WorkspaceIndex): Promise<void> {
    await writeJsonAtomic(P.workspacesIndexFile(agentId), idx)
  }

  /** 解析 workspaceId 到绝对 workspace 路径。默认位置或外部皆可。
   *  顺手触发布局迁移(旧布局 → `.silent/runtime/` 子目录)。 */
  async resolveWorkspacePath(agentId: string, workspaceId: string): Promise<string> {
    const cached = this.pathCache.get(workspaceId)
    if (cached) {
      // 仍要确保迁移过(in-memory 缓存只标记本进程内迁移完成的)
      await this.ensureLayoutMigrated(cached).catch((e) => {
        console.warn('[migrate] ensure failed:', e)
      })
      return cached
    }
    const idx = await this.readWorkspacesIndex(agentId)
    const entry = idx.entries.find((e) => e.id === workspaceId)
    const wsPath = entry?.path ?? P.managedWorkspaceDir(agentId, workspaceId)
    this.pathCache.set(workspaceId, wsPath)
    await this.ensureLayoutMigrated(wsPath).catch((e) => {
      console.warn('[migrate] ensure failed:', e)
    })
    return wsPath
  }

  async listWorkspaces(agentId: string): Promise<WorkspaceMeta[]> {
    const idx = await this.readWorkspacesIndex(agentId)
    const workspaces: WorkspaceMeta[] = []
    for (const entry of idx.entries) {
      const wsPath = entry.path ?? P.managedWorkspaceDir(agentId, entry.id)
      this.pathCache.set(entry.id, wsPath)
      try {
        const meta = await readYaml<WorkspaceMeta>(P.workspaceMetaFile(wsPath))
        // 对 renderer 暴露的 WorkspaceMeta 永远带 path(绝对路径),便于文件树等组件使用
        workspaces.push({ ...meta, path: wsPath })
      } catch {
        /* skip broken */
      }
    }
    if (workspaces.length === 0 && idx.entries.length === 0) {
      return this.rebuildWorkspacesIndex(agentId)
    }
    workspaces.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return workspaces
  }

  async getWorkspace(agentId: string, workspaceId: string): Promise<WorkspaceMeta> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    const meta = await readYaml<WorkspaceMeta>(P.workspaceMetaFile(wsPath))
    meta.path = wsPath  // 永远带绝对路径
    return meta
  }

  async createWorkspace(agentId: string, args: CreateWorkspaceArgs): Promise<WorkspaceMeta> {
    const now = new Date()
    const nameInput = args.name?.trim() || '新工作区'
    const id = `${yymmdd(now)}-${shortHash(2)}-${slugify(nameInput) || 'workspace'}`
    const wsPath = P.managedWorkspaceDir(agentId, id)  // 默认托管位置
    const meta: WorkspaceMeta = {
      id,
      name: nameInput,
      linkedFolder: args.linkedFolder,
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
    }
    await this.initWorkspaceAt(wsPath, meta)
    await this.addWorkspaceToIndex(agentId, { id })  // 无 path = 默认位置
    this.pathCache.set(id, wsPath)
    return meta
  }

  async addWorkspace(
    agentId: string,
    wsPath: string,
    name?: string,
  ): Promise<WorkspaceMeta> {
    const now = new Date()
    const nameInput = name?.trim() || wsPath.split('/').filter(Boolean).pop() || '工作区'
    const id = `${yymmdd(now)}-${shortHash(2)}-${slugify(nameInput) || 'workspace'}`
    const meta: WorkspaceMeta = {
      id,
      name: nameInput,
      path: wsPath,
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
    }
    await this.initWorkspaceAt(wsPath, meta)
    await this.addWorkspaceToIndex(agentId, { id, path: wsPath })
    this.pathCache.set(id, wsPath)
    return meta
  }

  /** 在任意路径建 `.silent/` + `runtime/` 子目录 + meta + 初始 tabs.json。
   *  创 silent-chat tab。幂等(已存在则不覆盖)。 */
  private async initWorkspaceAt(wsPath: string, meta: WorkspaceMeta): Promise<void> {
    // 二分:.silent/ 顶层(进 git)+ .silent/runtime/(.gitignore 整目录)
    await mkdir(P.workspaceInternalDir(wsPath), { recursive: true })
    await mkdir(P.workspaceRuntimeDir(wsPath), { recursive: true })
    await mkdir(P.workspaceStateDir(wsPath), { recursive: true })  // runtime/state/
    await writeYamlAtomic(P.workspaceMetaFile(wsPath), meta)

    const silentChatTab: TabMeta = {
      id: SILENT_CHAT_TAB_ID,
      workspaceId: meta.id,
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

  /** 已迁移过的 wsPath 缓存(本进程内,跨 IPC 调用) */
  private migratedPaths = new Set<string>()

  /**
   * 把旧布局(`.silent/{events.jsonl,messages.jsonl,state/tabs.json,tabs/<tid>/buffer.log}`)
   * 迁移到新布局(`.silent/runtime/...` 子目录)。
   *
   * 触发时机:`resolveWorkspacePath` 之后,任何读写 runtime 文件之前。每个 wsPath
   * per-process 只跑一次(in-memory cache);幂等(再次跑发现没旧文件就直接返回)。
   */
  private async ensureLayoutMigrated(wsPath: string): Promise<void> {
    if (this.migratedPaths.has(wsPath)) return

    const runtimeDir = P.workspaceRuntimeDir(wsPath)
    await mkdir(runtimeDir, { recursive: true })

    // events.jsonl:.silent/ → .silent/runtime/
    await this.moveIfExists(P.legacyWorkspaceEventsFile(wsPath), P.workspaceEventsFile(wsPath))

    // messages.jsonl:.silent/ → .silent/runtime/main_chat.jsonl(rename)
    await this.moveIfExists(P.legacyWorkspaceMessagesFile(wsPath), P.workspaceMainChatFile(wsPath))

    // tabs.json:.silent/state/tabs.json → .silent/runtime/tabs.json
    await this.moveIfExists(P.legacyWorkspaceTabsFile(wsPath), P.workspaceTabsFile(wsPath))

    // .silent/state/* 剩余文件(cookies/cache/last-active.json 等)→ .silent/runtime/state/*
    const oldStateDir = P.legacyWorkspaceStateDir(wsPath)
    await mkdir(P.workspaceStateDir(wsPath), { recursive: true })
    try {
      const entries = await readdir(oldStateDir)
      for (const name of entries) {
        if (name === 'tabs.json') continue  // 已经在上面单独搬
        const from = `${oldStateDir}/${name}`
        const to = `${P.workspaceStateDir(wsPath)}/${name}`
        await this.moveIfExists(from, to)
      }
      // 旧 state/ 目录可能还剩空目录,清掉
      await rm(oldStateDir, { recursive: true, force: true }).catch(() => {})
    } catch {
      /* 没有 state/ 目录,跳过 */
    }

    // .silent/tabs/<tid>/buffer.log → .silent/runtime/tabs/<tid>/buffer.log
    // 注意 .silent/tabs/<tid>/ 在新布局中仍存在(放 latest.md/log,git tracked),所以不删整个 tabs 目录
    const oldTabsDir = `${P.workspaceInternalDir(wsPath)}/tabs`
    try {
      const tabIds = await readdir(oldTabsDir)
      for (const tabId of tabIds) {
        const oldBufferLog = `${oldTabsDir}/${tabId}/buffer.log`
        const newBufferLog = P.workspaceTabBufferLog(wsPath, tabId)
        await mkdir(P.workspaceTabDir(wsPath, tabId), { recursive: true })
        await this.moveIfExists(oldBufferLog, newBufferLog)
      }
    } catch {
      /* 没有 tabs/ 目录,跳过 */
    }

    this.migratedPaths.add(wsPath)
  }

  private async moveIfExists(from: string, to: string): Promise<void> {
    try {
      await stat(from)  // 检查 from 存在
    } catch {
      return  // 不存在,跳过
    }
    let targetExists = false
    try {
      await stat(to)
      targetExists = true
    } catch {
      /* 目标不存在,直接 mv */
    }

    if (!targetExists) {
      await mkdir(to.replace(/\/[^/]+$/, ''), { recursive: true }).catch(() => {})
      await rename(from, to)
      console.log(`[migrate] moved ${from} → ${to}`)
      return
    }

    // 目标已存在(race:第一次启动时 emit 已经写了新位置,然后 migration 才跑)。
    // 对 append-only jsonl,把旧内容 prepend 到新文件;其他类型(yaml/json)留旧不动避免覆盖。
    if (from.endsWith('.jsonl')) {
      await this.mergeJsonlPrepend(from, to)
    } else {
      console.warn(`[migrate] target exists (non-jsonl), leave old in place: ${from} → ${to}`)
    }
  }

  /** Append-only jsonl 合并:把 from 内容放最前,to 现有内容放后。删 from。 */
  private async mergeJsonlPrepend(from: string, to: string): Promise<void> {
    const oldContent = await readFile(from, 'utf-8')
    const newContent = await readFile(to, 'utf-8')
    const merged = oldContent.endsWith('\n')
      ? oldContent + newContent
      : oldContent + '\n' + newContent
    await writeFile(to, merged)
    await unlink(from)
    const oldLines = oldContent.split('\n').filter(Boolean).length
    const newLines = newContent.split('\n').filter(Boolean).length
    console.log(`[migrate] merged jsonl ${from} (+${oldLines}) → ${to} (was ${newLines}, now ${oldLines + newLines})`)
  }

  async renameWorkspace(agentId: string, workspaceId: string, name: string): Promise<void> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    const meta = await readYaml<WorkspaceMeta>(P.workspaceMetaFile(wsPath))
    meta.name = name
    meta.lastActiveAt = nowIso()
    await writeYamlAtomic(P.workspaceMetaFile(wsPath), meta)
  }

  async deleteWorkspace(agentId: string, workspaceId: string): Promise<void> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    const idx = await this.readWorkspacesIndex(agentId)
    const entry = idx.entries.find((e) => e.id === workspaceId)
    if (entry?.path) {
      // 外部 workspace: 只删 .silent/(不动用户文件)
      await rm(P.workspaceInternalDir(wsPath), { recursive: true, force: true })
    } else {
      // 默认位置: 整个 workspace 目录删
      await rm(wsPath, { recursive: true, force: true })
    }
    await this.removeWorkspaceFromIndex(agentId, workspaceId)
    this.pathCache.delete(workspaceId)
  }

  async touchWorkspace(agentId: string, workspaceId: string): Promise<void> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    const meta = await readYaml<WorkspaceMeta>(P.workspaceMetaFile(wsPath))
    meta.lastActiveAt = nowIso()
    await writeYamlAtomic(P.workspaceMetaFile(wsPath), meta)
  }

  private async rebuildWorkspacesIndex(agentId: string): Promise<WorkspaceMeta[]> {
    const dir = P.workspacesDir(agentId)
    await mkdir(dir, { recursive: true })
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const entries: WorkspaceIndexEntry[] = dirents
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => ({ id: e.name }))
    await this.writeWorkspacesIndex(agentId, { entries })
    const workspaces: WorkspaceMeta[] = []
    for (const entry of entries) {
      try {
        workspaces.push(await this.getWorkspace(agentId, entry.id))
      } catch {
        /* skip */
      }
    }
    workspaces.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return workspaces
  }

  private async addWorkspaceToIndex(
    agentId: string,
    entry: WorkspaceIndexEntry,
  ): Promise<void> {
    const idx = await this.readWorkspacesIndex(agentId)
    if (!idx.entries.some((e) => e.id === entry.id)) {
      idx.entries.push(entry)
      await this.writeWorkspacesIndex(agentId, idx)
    }
  }

  private async removeWorkspaceFromIndex(
    agentId: string,
    workspaceId: string,
  ): Promise<void> {
    const idx = await this.readWorkspacesIndex(agentId)
    idx.entries = idx.entries.filter((e) => e.id !== workspaceId)
    await this.writeWorkspacesIndex(agentId, idx)
  }

  // ============ Messages ============

  async loadMessages(agentId: string, workspaceId: string): Promise<ChatMessage[]> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    return readLines<ChatMessage>(P.workspaceMainChatFile(wsPath))
  }

  async appendMessage(
    agentId: string,
    workspaceId: string,
    msg: ChatMessage,
  ): Promise<void> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    await appendLine(P.workspaceMainChatFile(wsPath), msg)
    await this.touchWorkspace(agentId, workspaceId).catch(() => {})
  }

  // ============ Events ============

  async appendEvent(
    agentId: string,
    workspaceId: string,
    event: WorkspaceEvent,
  ): Promise<void> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    await appendLine(P.workspaceEventsFile(wsPath), event)
  }

  // ============ Tabs ============

  async getTabs(agentId: string, workspaceId: string): Promise<TabMeta[]> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
    const data = await readJson<{ tabs: TabMeta[] }>(
      P.workspaceTabsFile(wsPath),
      { tabs: [] },
    )
    // 迁移:老 tabs.json 无 path → 按 type 推;老路径(messages.jsonl / tabs/xxx)→ 补 SILENT_DIR 前缀
    return data.tabs.map(upgradePath)
  }

  async setTabs(
    agentId: string,
    workspaceId: string,
    tabs: TabMeta[],
  ): Promise<void> {
    const wsPath = await this.resolveWorkspacePath(agentId, workspaceId)
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
