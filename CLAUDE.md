# CLAUDE.md

Silent Agent —— AI-push 任务工作区。观察 / 学习 / 操作三类空间,让 AI 学用户。

## 仓库

- `design/` — 产品 + 架构设计,索引 [design/_Index.md](design/_Index.md);代码真相源是 [design/02-architecture.md](design/02-architecture.md)
- `app/` — Electron + React + TypeScript 应用

## 技术栈

Electron 38 · React 19 · Vite · TypeScript 5 · Anthropic TS SDK · Node 24。MVP macOS only,全本地(不依赖云端服务,只调 Claude API 做推理)。

## 写代码时的硬性要求

### 1. Electron 代码必须带简明注释

用户对 Electron **不熟悉**。主进程(`src/main/`)、preload(`src/preload/`)、以及渲染侧涉及 `window.api` / `ipcRenderer` / `BrowserView` / `WebContentsView` / `contextBridge` / `webPreferences` / `ipcMain` 等 Electron 专有 API 的地方, **必须在关键语句上方加 1-2 行中文注释**, 说明:

- 这段代码在三进程(main / preload / renderer)里跑在哪一个
- 这个 API 做什么、为什么这么用
- 不明显的陷阱(如 `sandbox: false`、`contextIsolation` 的含义、为什么要用 `handle` 而非 `on`)

非 Electron 专属的 React / 业务代码按默认规则(不加废话注释)。

示例(好):
```ts
// [main] 注册一个 IPC handler,供 renderer 通过 window.api.ping() 调用。
// ipcMain.handle 是 request-response 模式(对应 ipcRenderer.invoke),
// 不同于 ipcMain.on(事件流,无返回值)。
ipcMain.handle('ping', () => ({ pong: true, at: new Date().toISOString() }))
```

示例(坏 - 废话):
```ts
// 创建一个函数并返回 ping
ipcMain.handle('ping', () => ({ pong: true }))
```

### 2. React / 业务代码默认不加注释

命名自解释;非显而易见的 why 才写一行注释。不写"what",不写任务上下文。

## 目录约定(代码)

```
app/src/
├── main/             # Electron 主进程: 窗口、IPC、agent harness、tools、observers、storage
├── preload/          # contextBridge 暴露 API 给 renderer
├── renderer/         # React 前端
│   └── src/
│       ├── App.tsx
│       ├── components/
│       ├── hooks/
│       ├── lib/ipc.ts
│       └── styles/
└── shared/           # 两端共用 types (runtime-free)
```

## 数据落盘约定(everything is file)

根:`~/.silent-agent/`
- `agent/` — 全局(config / memory / skills / knowledge/*.md)
- `sessions/<id>/` — 每个会话/工作区(meta.yaml / messages.jsonl / context/*.jsonl / state/)
- JSONL 是真相源,SQLite 只做缓存

## 运行与调试

```bash
cd app
npm install
npm run dev      # electron-vite 热更新开壳
npm run build    # 打包
npm run typecheck
```
