# Silent Agent — 设计文档索引

> 一个通过静默观察用户**工作区产物**、自动发现重复 pattern、主动推荐并执行自动化的 AI 助理。不是 chatbot,是 **observe-learn-act** 系统。

## 核心原则

1. **AI 学你,不是你学 AI** — 用户元认知盲区决定了必须是 AI-push 范式
2. **产物为核心,Everything is file** — 事件 / skill / 状态 / 产出全部落盘为文件,可 git、可 diff、可 rewind
3. **工作区是接管的载体** — 不做目的地、不做对话框,用轻工作区圈定观察 / 学习 / 操作的边界
4. **所有重复的事情都值得用 AI 重新做** — 不是录制回放,是理解 intent 后重新规划执行
5. **一切外泄动作需用户确认** — 分层信任 L0-L4,L3+ 永远守住

## 当前定位

> Silent Agent 是一个**轻量级任务工作区** ——
> 为 Agent 提供**观察**你的产物、**学习**你的 pattern、**操作**你的文件 / 网页 / 命令三种空间。
> 当期任务搬进来,Agent 静默跟随;
> 产出推回飞书 / GitHub / Figma,skill 留下来继续成长。
> Everything is file —— 所有状态、事件、产物都可 diff、可 rewind、可 git。

详见 [01-product-vision.md](01-product-vision.md)。

## 文档结构(8 篇核心)

### 🎯 必读 — 产品魂

- [**01-product-vision**](01-product-vision.md) — **产品定位** · AI-push / Artifact-first / 轻工作区,合并自早期 positioning + core-insight + artifact-first 三篇

### 🏗️ 架构与运行时

- [**02-architecture**](02-architecture.md) — **代码真相源** · 五层架构 / 数据模型 / Workspace = git repo / Tab = `{type, path}` 指针
- [**03-agent-core**](03-agent-core.md) — **agent-core 包设计** · 4 层(Runtime / AgentRegistry / SessionManager / Sandbox) + `runSession` 核心 loop + Memory hook
- [**08-vcs**](08-vcs.md) — **WorkspaceVCS** · workspace 暴露的 meta-skill / 4 条 Tier 1 自动 commit 规则 / Browser+Terminal snapshot 子系统
- [**09-learning-loop**](09-learning-loop.md) — **自进化学习闭环** · 借鉴 Hermes / Nudge 触发反思 / main_review 四向决策 / frozen prompt 不破坏 cache
- [**10-multi-agent-isolation**](10-multi-agent-isolation.md) — **多 agent 工作区隔离** · git worktree per-agent / `silent/<agent>/<task>` 命名 / WorkspaceVCS 4 方法扩展 / main_chat 当 curator

### 🎨 交互与观察

- [**04-workspace-interaction**](04-workspace-interaction.md) — 工作区交互细节 · 内嵌三件套布局 / 内联建议 / Phase 1-4 接管路径
- [**05-observation-channels**](05-observation-channels.md) — 观察通道分层 · P0 工作区内三通道 / P1 外部 API / P2 屏幕录制(永远不做)

### ☁️ 边界与对标

- [**06-cloud-vs-local-agent**](06-cloud-vs-local-agent.md) — 本地 / 云端职责划分 · 数据守门人 / Memory 分层同步 / Skill 路由
- [**07-competitors**](07-competitors.md) — 竞品对标 · Screenpipe(差异化) / cmux + Yume(形态参考) / Cursor + Claude Code(范式对照)

### 🖼️ 原型图

- `prototype-v0.1.html` — 早期工作区原型(可直接打开)
- `prototype-v0.2-filetree.html` — 文件树面板交互原型

### 📚 历史归档(`archive/`)

- `archive/mvp-plan-v3-tauri.md` — 早期 MVP 6-8 周 Tauri 方案(已被 `task.md` 取代)
- `archive/tech-architecture-v0.md` — 早期五层管线设计(已被 02 + 05 取代)

## 阅读顺序建议

| 角色 | 顺序 |
|---|---|
| 第一次看 | 01 → 02 → 04 → 05 |
| 实施 Phase 5(journal) | 01 → 02 → 08 → `task.md` Phase 5 |
| 实施 Phase 6(agent-core) | 02 → 03 → `task.md` Phase 6 |
| 做产品定位 / 对标 | 01 → 07 → 06 |
| 全面 review | 01 → 02 → 03 → 08 → 04 → 05 → 06 → 07 |

## 实施真相源

- 代码:`/Users/bytedance/projects/silent-agent/app/`
- Phase 任务清单:[`task.md`](../task.md)(根目录)
- 工作区共用约定:[`CLAUDE.md`](../CLAUDE.md)(根目录)

## 状态

- 创建:2026-04-16
- 最新文档归并:2026-04-27(8 篇核心 + archive 历史)
- 阶段:Phase 1-4 ✅(壳 + 三件套 tab)、Phase 5 🔄 进行中(WorkspaceVCS + git auto-commit + snapshot 子系统)
- **MVP 加速捷径**:Phase 6 起 chat / review agent 先用 **Claude Code subprocess** 跑起来(详见 `task.md` 头部说明);设计文档保持目标态不动,03-agent-core.md 等到 v1+ 真有跨 provider / 上云需求时回归
