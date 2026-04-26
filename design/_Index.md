# Silent Agent — 自进化 AI 助理

> 一个通过静默观察用户**工作区产物**、自动发现重复 pattern、主动推荐并执行自动化的 AI 助理。不是 chatbot，是 observe-learn-act 系统。

## 核心原则

1. **AI 学你，不是你学 AI** — 用户元认知盲区决定了必须是 AI-push 范式
2. **产物为核心，Everything is file** — 事件 / skill / 状态 / 产出全部落盘为文件，可 git、可 diff、可 rewind
3. **工作区是接管的载体** — 不做目的地、不做对话框，用轻工作区圈定观察 / 学习 / 操作的边界
4. **所有重复的事情都值得用 AI 重新做** — 不是录制回放，是理解 intent 后重新规划执行
5. **一切外泄动作需用户确认** — 分层信任 L0-L4，L3+ 永远守住

## 当前定位（v3）

> Silent Agent 是一个**轻量级任务工作区**——
> 为 Agent 提供**观察**你的产物、**学习**你的 pattern、**操作**你的文件 / 网页 / 命令三种空间。
> 当期任务搬进来，Agent 静默跟随；
> 产出推回飞书 / GitHub / Figma，skill 留下来继续成长。
> Everything is file——所有状态、事件、产物都可 diff、可 rewind、可 git。

详见 [positioning-strategy-v3-workspace.md](positioning-strategy-v3-workspace.md)。

## 文档结构

### 🔥 必读（按顺序）

- [**positioning-strategy-v3-workspace**](positioning-strategy-v3-workspace.md) — **v3 锚定**：轻工作区 + 产物为核心 + observe/learn/act
- [**core-insight-ai-push**](core-insight-ai-push.md) — **产品之魂**：为什么必须 AI-push（元认知盲区）
- [**artifact-first-architecture**](artifact-first-architecture.md) — 底层哲学：只看产物
- [**workspace-interaction**](workspace-interaction.md) — 工作区交互设计（v3 翻回主方案）

### 实施细节

- [observation-channels](observation-channels.md) — 观察通道分层（v3 调整后 P0 = 工作区内三通道）
- [mvp-plan](mvp-plan.md) — MVP 实施路径（v3 重写为 Tauri + 内嵌三件套）
- [cloud-vs-local-agent](cloud-vs-local-agent.md) — 本地 / 云端职责划分
- [tech-architecture](tech-architecture.md) — 技术架构五层（部分待按 v3 修订）

### 竞品与生态参考

- [competitors-tauri-ecosystem](competitors-tauri-ecosystem.md) — Tauri 生态竞品对标（Screenpipe / Yume / Jan / GitButler / Hoppscotch）
- [../../Notes/调研/cmux-terminal-browser/](../../Notes/调研/cmux-terminal-browser/) — cmux 源码深度调研（外部链接）
- [../../Notes/调研/yume-claude-code-gui/](../../Notes/调研/yume-claude-code-gui/) — Yume 调研（已完成，闭源专有不可深调，仅产品设计参考）

### 历史决策（保留轨迹）

- [positioning-strategy](positioning-strategy.md) — v2 定位（menubar claw + 首尾编排，已被 v3 取代）
- [product-design](product-design.md) — 原 observe-suggest-act 设计（待按产物视角修订）
- [competitors](competitors.md) — 竞品分析（v3 对标对象已换，待重写）

## 状态

- 创建时间：2026-04-16
- 最新修订：2026-04-23（v3 回归工作区形态 + everything-is-file 哲学）
- 阶段：MVP 方案对齐完成，准备进入 Tauri 壳 spike

## 下一步

- [ ] W1-2 起 Tauri 壳 + xterm + WebView 三 pane 布局（文件树 / 终端+浏览器 / AI 侧栏，不内嵌编辑器，cmux 形态参考）
- [ ] W3-4 文件 watcher + 内嵌浏览器 CDP + 终端 hook 三通道事件落 `context/*.jsonl`
- [ ] W5-6 LLM pattern 摘要 + 首次 "教教我" 仪式
- [ ] 更新 `tech-architecture.md` 和 `competitors.md` 与 v3 对齐
