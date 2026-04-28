# Silent Agent

AI-push 任务工作区 — 通过 observe / learn / act 三类空间,让 AI 学你,不是你学 AI。

## 仓库结构

```
silent-agent/
├── design/            # 产品与架构设计文档
│   ├── _Index.md
│   ├── architecture.md
│   ├── prototype-v0.1.html   # 可打开的原型图
│   └── ...
└── app/               # Electron 应用
    ├── src/
    │   ├── main/      # Electron 主进程 (TS) — Orchestration + Harness + Capability
    │   ├── preload/   # contextBridge
    │   ├── renderer/  # React 前端
    │   └── shared/    # 共用 types
    ├── package.json
    └── electron.vite.config.ts
```

## 快速开始

```bash
cd app
npm install
npm run dev
```

- 栈:Electron 38 + React 19 + Vite + TypeScript 5
- 目标平台:macOS(MVP)
- 数据落盘:`~/.silent-agent/`(everything is file)

## 设计文档入口

- [设计文档索引](design/_Index.md) — 8 篇核心 + archive 历史
- [01 产品定位](design/01-product-vision.md) — AI-push / Artifact-first / 轻工作区
- [02 架构](design/02-architecture.md) — 五层架构 / 数据模型 / Workspace = git repo
- [03 agent-core](design/03-agent-core.md) — LLM 运行时 4 层 + `runSession`
- [08 vcs](design/08-vcs.md) — WorkspaceVCS · workspace 暴露的版本能力 / Tier 1 auto-commit / Browser+Terminal snapshot
- [原型图](design/prototype-v0.1.html)
