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

- [架构与技术选型](design/architecture.md)
- [产品定位 v3](design/positioning-strategy-v3-workspace.md)
- [MVP 实施路径](design/mvp-plan.md)
- [观察通道](design/observation-channels.md)
- [原型图](design/prototype-v0.1.html)
