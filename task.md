# Silent Agent — 任务清单

> 按 Phase 切,每个 Phase 落一个可独立 dogfood 的里程碑。
> 状态:`[x]` 完成 · `[ ]` 待做 · `[~]` 进行中 · `[!]` 阻塞
>
> 核心重排:**Tab 基础设施先做,AI 后置**。先把"轻 IDE 壳"跑通 dogfood 工作区形态,再上 agent。
> 数据模型按多 agent 设计,MVP 单 window 单 default agent。
>
> 设计真相源:[`design/_Index.md`](design/_Index.md);代码锚 [`design/02-architecture.md`](design/02-architecture.md),Phase 5 实施依据 [`design/08-vcs.md`](design/08-vcs.md),Phase 6 实施依据 [`design/03-agent-core.md`](design/03-agent-core.md)。
>
> **MVP 加速通道**:Phase 6 起 chat / review agent **先用 Claude Code subprocess 跑起来**(每 workspace 一个长驻 CC session,review = `claude -p --resume` inject,chat = 同 session interactive),03-agent-core.md 整套抽象作为 v1+ 目标态。设计文档不改,实施时按这条捷径走通后再决定是否回到自研 agent-core。

---

## Phase 0 — 架构与骨架 ✅

产出:可运行的 Electron 壳 + 三栏布局 + IPC 通路。

- [x] 设计文档归并完成(8 篇核心 + archive 历史 + `_Index.md` 索引)
- [x] `design/02-architecture.md` — 五层 + 多 agent 模型(Agent / Workspace / Connection / Capability / Attachment)
- [x] 技术栈:Electron 38 + React 19 + Vite + TS 5
- [x] electron-vite 项目脚手架 + 三套 tsconfig
- [x] 三进程模型(main / preload / renderer)
- [x] contextBridge 暴露 `window.api` + IPC `ping-pong`
- [x] 三栏布局 React 组件(LeftNav / TabBar / BrowserPane / SilentChat / PingPill)
- [x] CSS tokens + 暗色主题
- [x] `CLAUDE.md` 硬性规则:Electron 专属 API 必须注释
- [x] hot-reload:main / preload 改动自动重启

---

## Phase 1 — 存储层 + Agent/Workspace CRUD ✅

让 agent / workspace / tab / message 都有落盘能力,左栏真从磁盘读。

### 路径与工具
- [x] `src/main/storage/paths.ts` — `~/.silent-agent/` 下所有路径
- [x] `src/main/storage/jsonl.ts` — append / 流式读取 / 逐行解析
- [x] `src/main/storage/yaml.ts` — `readYaml` / `writeYamlAtomic`(tmp + rename)+ `readJson` / `writeJsonAtomic`

### StorageAdapter 接口
- [x] `src/main/storage/adapter.ts` — `interface StorageAdapter`
- [x] `src/main/storage/local-fs.ts` — `LocalFsAdapter` 实现,**不 import 'electron'**
- [x] `_index.json` 格式从 `{ ids: [] }` 演化到 `{ entries: [{id, path?}] }`,自动迁移

### Agent 模型
- [x] `src/main/agent/registry.ts` — `list / get / ensureDefault`
- [x] 启动时 `ensureDefaultAgent()`:若 `agents/silent-default/` 不存在则自动创建
- [x] `src/shared/types.ts` 定义 `AgentMeta`

### Workspace 模型
- [x] `src/main/agent/workspace.ts` — `list / get / create / addWorkspace / rename / delete / loadMessages / appendMessage`
- [x] id 生成:`${YYMMDD}-${shortHash}-${slug}`(如 `260423-a1b2-logid`)
- [x] 启动 guard `ensureHasWorkspace`:default agent 下若无 workspace,建 "欢迎" workspace
- [x] **任意目录 + `.silent/` 即工作区**(类比 `.git/`)
- [x] `addWorkspace(absPath)` —— 把任意已有目录注册为外挂 workspace,只在该目录写 `.silent/`

### IPC 层
- [x] `src/main/ipc/agent.ts` — `agent.current` / `agent.list`
- [x] `src/main/ipc/workspace.ts` — `workspace.list / create / add / rename / delete / loadMessages`
- [x] `src/main/ipc/context.ts` — IPC handler 内部用 `BrowserWindow.fromWebContents(event.sender)` 取 `agentId`
- [x] preload 暴露对应方法到 `window.api.*`
- [x] `src/shared/ipc.ts` + `src/shared/consts.ts` — channel name + 路径常量集中

### Renderer
- [x] `src/renderer/src/hooks/useAgent.ts` — 当前 agent
- [x] `src/renderer/src/hooks/useWorkspaces.ts` — workspace 列表
- [x] LeftNav 接 `useAgent` / `useWorkspaces`,新建按钮接 `workspace.create`

### 验收
- [x] `npm run dev` 启动 → `~/.silent-agent/agents/silent-default/workspaces/<wid>/` 自动出现
- [x] 点 `＋` 新建 workspace,左栏立刻显示;磁盘对应 `.silent/{meta.yaml, messages.jsonl, tabs.json}`
- [x] 重启 app,workspace 列表保留

---

## Phase 2 — Tab 管理框架 + 浏览器 tab ✅

点 `[+]` 真开 `WebContentsView` 导航到 URL,Silent Chat pinned 被挤压到右边。

### 数据模型
- [x] `TabMeta` 类型(discriminated union by `type`),`path` 提为一等字段
- [x] `Tab.state` 按 type 分:`BrowserTabState / TerminalTabState / FileTabState`
- [x] Tab 落盘 `<workspace>/.silent/tabs.json`(整文件重写,迁移规则在 `LocalFsAdapter.upgradePath`)
- [x] `silent-chat` 为虚拟 pinned tab,`path = .silent/messages.jsonl`

### Tab Manager
- [x] `src/main/tabs/manager.ts` — 每个 workspace 维护 tab 列表,启动按 `tabs.json` 恢复
- [x] `src/main/tabs/browser-tab.ts` — 每个 browser tab 一个 `WebContentsView`
- [x] `setBounds(...)` 按 BrowserPane DOM 位置贴;非 active tab 隐到 OFFSCREEN

### IPC
- [x] `tab.list / tab.open / tab.close / tab.focus / tab.setBounds / tab.popupTypeMenu`(原生 OS 菜单)

### Renderer
- [x] `useTabs(workspaceId)` hook
- [x] TabBar 渲染 `[📁] [+] [tabs...] [Silent Chat pinned]`
- [x] 切 tab 时 `useResizeObserver` → `tab.setBounds`

### 验收
- [x] 多 tab 共存,关闭再打开按 `tabs.json` 恢复
- [x] 不同 workspace 之间 tab 隔离

---

## Phase 3 — 终端 tab ✅

内嵌 xterm.js + node-pty,能跑 shell。

- [x] `@xterm/xterm` + `@xterm/addon-fit`(renderer)
- [x] `node-pty`(main),`postinstall` 跑 `electron-rebuild -w node-pty`
- [x] `src/main/tabs/terminal-tab.ts` — 每个终端 tab 起一个 pty(默认 `$SHELL`)
- [x] `pty.onData / onExit` → IPC channel 推 renderer
- [x] `terminal.write / terminal.resize` IPC
- [x] `<TerminalPane>` xterm 实例 + fit addon + ResizeObserver
- [x] 跑 `ls / pwd / git status` 颜色正确

---

## Phase 4 — 文件 tab ✅

文件树 + Monaco 文件查看 + 工作区文件操作。

- [x] `<FileTreePanel>` 第二列 toggle 文件树(LeftNav 窄到 100px)
- [x] `<FilePane>` Monaco editor(`@monaco-editor/react`)
- [x] `src/renderer/src/lib/monaco-setup.ts` — Monaco worker 配置
- [x] `file.read / write / pickOpen / createInWorkspace / listDir` IPC
- [x] `createInWorkspace` 安全检查 `.silent` / `.git` / 越界
- [x] 文件类型判断:text / image / binary;binary 给元数据提示

---

## 按需 — 浏览器 Tab 体验升级(对标 Cursor)

MVP 目前只显示 URL 文本 tab + 网页本体,没有 chrome 工具栏。

### 地址栏 / 导航栏
- [ ] 浏览器 tab 激活时,tab bar 下方浮出一条 chrome 工具栏(高 ~38px)
- [ ] 左侧 icon 按钮组:`‹` 返回 · `›` 前进 · `↻` 刷新 · `★` 收藏
- [ ] 中央可编辑 URL 地址栏,Enter 触发 `tab.navigate`,Esc 恢复原值
- [ ] 右侧工具区:`select-DOM` / DevTools / 更多菜单

### Tab 本身
- [ ] favicon 显示(`webContents.on('page-favicon-updated')`)
- [ ] Tab 关闭按钮 `×` 只在 `:hover` 或 `.active` 时显示
- [ ] Tab 右键菜单:复制 URL / 重载 / 复制到新 tab / 关闭其他

---

## 按需 — TabBar tab 宽度可拖动

每个 tab 当前固定宽度(title 截断 ellipsis)。dogfood 时遇到长 URL / 命令名看不全的情况,需要拖动边界放宽。
- [ ] 每个 tab 之间的边界加 4-6px 的拖动 handle(`cursor: col-resize`)
- [ ] 拖动时实时调整两侧 tab 的宽度,主要扩大被拖的左侧 tab
- [ ] 单 tab 宽度限制:`min-width: 80px` / `max-width: 480px`
- [ ] 双击边界 → 自动 fit 到 title 完整宽度
- [ ] 状态持久化到 `tabs.json` 里的 `tabWidth?: number`(per-tab,可选)
- [ ] 关 tab 时该 tab 的宽度配额释放给左邻
- [ ] 跟 Tab Bar 总宽度的关系:tab 总宽度超出 TabBar 时启用横向滚动 / overflow scroll(已有?需验证)

---

## 按需 — LeftNav 收窄到 icon-only 模式

LeftNav 当前是 180px 宽(打开 file tree 时窄到 100px)。dogfood 体感主区不够宽,LeftNav 信息量有冗余。需要一个更激进的 icon-only 模式。
- [ ] 新增"超窄模式":LeftNav 收窄到约 48px,只显示 icon + 数字徽章
- [ ] icon 列表:消息渠道 / 飞书 IM / 邮箱 / 工作流 / 日程 / TODO / 知识库 / Skills / Memory / Preferences / 工作区列表
- [ ] hover icon 弹气泡或 tooltip 显示 label
- [ ] 工作区列表区域:icon 用 workspace name 首字 + 右下角 active 小绿点
- [ ] 切换模式:LeftNav 顶部一个折叠按钮(`«` / `»`),或快捷键 `Cmd+\\`
- [ ] 状态持久化到 `.silent/runtime/state/layout.json`(workspace 级)或 app 级 preference
- [ ] active workspace 高亮、push 数字徽章这两个不能丢
- [ ] 跟现有 narrow 模式(file tree open 时 100px)的关系:保留三档 — 默认 180px / 文件树打开 100px / 用户折叠 48px

---

## 按需 — Tab 拖出独立 window

把任意 tab(浏览器 / 终端 / 文件 / 主 chat)拖出 TabBar 变成一个独立 BrowserWindow,可以多屏摆放;拖回来重新归入原 workspace。
- [ ] HTML5 drag API + 边界检测:tab 拖出 TabBar 区域 `dragend` 时触发 detach
- [ ] `tab.detach(tabId, { x, y })` IPC:在 main 端 new BrowserWindow,把 WebContentsView / pty 句柄迁过去(BrowserView 可 `removeChildView` + `addChildView` 到新 window;pty 不动,IPC 信道改投新 window)
- [ ] 独立 window 的关闭语义:关 = 销毁 tab(同 tab.close)/ 拖回主窗口 = 重新挂回 TabBar
- [ ] tabs.json 加 `detachedWindowId?` 字段,持久化(关 app 重开时尝试恢复独立 window)
- [ ] 多 BrowserWindow 时 IPC 路由按 `BrowserWindow.fromWebContents(event.sender)` 反查
- [ ] TerminalTabRuntime / BrowserTabRuntime 的 `window` 引用要支持热切换(目前 readonly)

---

## 按需 — 分栏一等抽象 + SilentChat 统一

> **核心**:把"分栏"提升为一等机制 —— 任意 tab 可以"向右分栏出"另一个 tab。**SilentChat 不再是 hardcoded B 模式,而是"workspace 默认在右分栏槽固定一个 silent-chat tab"** —— 跟其他 tab 一视同仁。

现状(Level 0):App.tsx 里 `if (activeTab.type === 'silent-chat') 全宽 else 1.3:1 split + SilentChat 永远在右`,纯 UI 派生规则,没有数据模型。

### 目标(分栏作为一等公民)
- [ ] tabs.json schema 加 `splitWith?: tabId` 字段:某个 tab 显式声明"我活跃时,把 X tab 在右分栏出来"
- [ ] silent-chat tab 默认 `splitWith` 自己(workspace 创建时种下),但用户可改:
  - 拖 silent-chat tab 出去 → 不再分栏,SilentChat 作为普通 tab 占活跃区
  - 拖任意 tab 到分栏槽 → 把那个 tab 设为该 workspace 的"右分栏 pinned"
- [ ] App.tsx 的 ActiveTabPane 简化:不再 hardcode `<SilentChat>`,而是读 `activeTab.splitWith` → 渲染对应 tab 内容
- [ ] silent-chat tab 失去特殊性:就是一个 type='silent-chat' 的普通 tab,可以被关、可以被拖出独立 window(配合拖出 task)、可以被替换

### 进一步(分栏树,Level 2)
- [ ] `layout.json: { tree: LayoutNode }` — 递归 split 树(类似 VSCode editor groups)
- [ ] 任意 tab 可拖入任意 split,横纵皆可,可嵌套
- [ ] 关 tab 时 empty pane 自动折叠
- [ ] 键盘快捷键:`Cmd+\` 纵 split / `Cmd+Shift+\` 横 split

→ 实现 Level 2 后,"SilentChat hardcoded right" 自然消失 —— 只是 tree 里默认有一个右子叶子是 silent-chat tab。

---

## 按需 — 分栏升级(Level 1 / Level 2)

详见 `design/02-architecture.md` 的"分栏演进路线"。v0.1 默认停在 Level 0(hardcoded B 模式 1.3:1)。

### Level 1(约 2h,触发:dogfood 发现要调比例)
- [ ] `<workspace>/.silent/runtime/layout.json` — `{ splitRatio: 0~1 }`(.gitignore,在 runtime/)
- [ ] IPC:`layout.getRatio / setRatio`
- [ ] divider 加拖动 handler,默认值 0.56(等价 1.3:1)

### Level 2(1-2 天,真实多-pane 需求触发)
- [ ] `layout.json: { tree: LayoutNode }` — 递归 split 树
- [ ] `<LayoutTree>` 递归渲染,叶子 = tab content
- [ ] tab 拖放 + 关 tab empty pane 折叠
- [ ] 键盘快捷键 `Cmd+\` / `Cmd+Shift+\`

---

## 按需 — Clipboard 行为捕获(workspace 内,跨 tab 流向)

> **价值**:用户从 logservice 复制 abc123 → 1 分钟后粘到 chat 问 agent —— 揭示用户的关键 ID / 思维链。比纯 events 多一层"内容流向"。
> **隐私红线**:**默认仅抓元数据**(length / sourceTab / targetTab / sourceHost),内容默认不存;用户 settings opt-in 才存内容。**workspace 边界外的剪贴板一概不碰**(违反观察边界红线)。
> **实施 phase**:Phase 7(用作 pattern mining / 教教我信号)或 v0.2(独立增强)。

### 注入点
- [ ] **BrowserTabRuntime**:`executeJavaScript` 注入 `document.addEventListener('copy'/'paste', listener, true)`
  - copy 拿 `e.clipboardData.getData('text/plain').length` + `location.host` + 选中区 selector(粗粒度,role+tag)
  - paste 拿 length + 目标 element role
  - 通过 preload 暴露的 IPC 回调到主进程 → `vcs.emit({source:'user', action:'clipboard.copy'/'paste', ...})`
- [ ] **TerminalTabRuntime**(包括主 chat ChatTerminal):
  - `term.onSelectionChange` → 用户选区 length(copy 候选信号)
  - 检测 bracketed paste(`\x1b[200~...\x1b[201~` 包裹)→ paste event,知道粘贴大小
  - 同 emit 进 events.jsonl
- [ ] **FilePane Monaco**:
  - `editor.onDidPaste(e)` → 直接拿 paste 范围 + 长度
  - DOM `copy` listener → 选区文本 length
- [ ] 全部走 vcs.emit 统一进 events.jsonl(2 层 schema · Layer 1)

### 默认 events.jsonl 行(只元数据)
```jsonl
{"ts":"...","source":"user","action":"clipboard.copy","tabId":"br-1","meta":{
  "summary":"copy 142 chars from logservice.bytedance.net",
  "length":142,"contentType":"text/plain",
  "sourceHost":"logservice.bytedance.net","sourceSelector":"td.log-content"
}}
{"ts":"...","source":"user","action":"clipboard.paste","tabId":"term-x","meta":{
  "summary":"paste 142 chars to terminal",
  "length":142,"targetTabId":"term-x"
}}
```

### 跨 tab 流向 link(高价值推理)
- [ ] copy / paste 元数据有 length 字段 → review / pattern detector 能跨 tab join:`copy at T0 length=142 from br-1` + `paste at T1 length=142 to term-x` → 强推断用户做了 br-1 → term-x 的内容搬运
- [ ] 不存内容也能做这个 join,纯靠 (length, ts gap)。MVP 接受偶尔误判

### opt-in 存内容(默认关闭)
- [ ] App settings 加 `captureClipboardContent: boolean`(per-workspace 或全局)
- [ ] 启用后:内容入 `.silent/runtime/clipboard.jsonl`(独立 stream,不进 events.jsonl)
- [ ] events 行 `meta.detailMessageId` 引用 clipboard.jsonl 中的 id
- [ ] 7 天 TTL 自动清理(防 token / 密码长留)
- [ ] 用户 UI 提示:"剪贴板内容已记录,7 天后自动清理"

### 不抓(workspace 边界外)
- ❌ 跨 app 复制:从外部 Chrome 复制 → 粘到我们的内嵌浏览器(粘贴端能抓,复制端不可见 —— 自然约束)
- ❌ 跨 app 粘贴:从我们复制 → 粘到 VSCode(复制端能抓,粘贴端不可见)
- ❌ 全局剪贴板 polling(NSPasteboard)—— 违反观察边界红线
- ❌ 用户在 SilentAgent 之外的任何剪贴板事件

---

## 按需 — Recording 模式(教教我密集观察)

> **价值**:用户主动开启 → 系统在该窗口期内**加密观察**(snapshot 频率上调 + click/keypress 落 events),退出时把 dense events 喂给 main_review 直接产 skill 候选。是「人教 AI」的最小可控接口,跟当前"AI-push 静默观察"路径互补。
> **隐私红线**:开启状态有醒目 UI 标识(red dot);窗口期外行为不变;**仍不跨越 workspace 边界**。
> **实施 phase**:Phase 7(教教我闭环升级)或 v0.2 独立功能;先观察 dogfood 是否真有需求再上。

### 触发与生命周期
- [ ] LeftNav / TabBar 加 `● Recording` 按钮,点亮后开启
- [ ] 默认 5 分钟 / idle 60s / 用户手动停 三种退出条件
- [ ] 录制态写 `.silent/runtime/state/recording.json`(per-workspace),录制 id `<rid>`
- [ ] 红色 UI 标识(跟"录屏"心智一致)

### 增强观察(录制态下,常规态不变)
- [ ] **浏览器 snapshot 频率上调**:常规态 = `did-finish-load + did-navigate-in-page`(500ms 等渲染);录制态 = 加 click / keydown 触发(debounce 800ms 抓 ariaSnapshot)
- [ ] **终端 snapshot 频率上调**:每条 cmd 切片照常,加 buffer.log 内的 `--- recording <rid> tick ---` 标记
- [ ] **高频元数据 events**:bracketed paste / quick selection / clipboard 走 events.jsonl(参考「按需 — Clipboard 行为捕获」)
- [ ] **可选截图**:每个 snapshot 配 PNG(`runtime/tabs/<tid>/recordings/<rid>/NNN.png`),给 LLM 视觉锚点

### 数据模型
- [ ] `events.jsonl` 加可选字段 `meta.recordingId?: string` 标记隶属哪段录制
- [ ] 录制产物落 `runtime/tabs/<tid>/recordings/<rid>/NNN-*.md`(跟常规 snapshots 物理分离,不污染历史序列)
- [ ] `runtime/recordings/_index.json` 记当前 / 历史录制(start/end ts、产物路径、关联 skill 候选)

### 退出后处理
- [ ] 停录自动调起 main_review,prompt 限定到 `recordingId == <rid>` 的事件 + 产物
- [ ] main_review 优先输出 [09-learning-loop](design/09-learning-loop.md) §7 的 `create_skill` action
- [ ] 用户 review 候选 skill,接受后存 `agents/<aid>/skills/<name>.yaml`

### 不做
- ❌ 屏幕录像(对齐 [05-observation-channels](design/05-observation-channels.md) P2 永远不做)
- ❌ 全局键盘 hook(只监听 webContents / pty 内,workspace 边界内)
- ❌ 自动开启 / 长跑(用户必须显式触发)

### 关联
- [09-learning-loop](design/09-learning-loop.md) — main_review 4 向 action,recording 产物天然走这条
- 按需 — Clipboard 行为捕获(信号源同一类)
- Phase 7 教教我 + Skill v1(本节是其增强模式)

---

## Phase 5 — Workspace 化 · WorkspaceVCS + snapshot 子系统(~4d)🔄

> **依据**:[`design/08-vcs.md`](design/08-vcs.md)。
> **核心思想**:**workspace = 一个 git repo,workspace 版本 = git commit SHA**。`WorkspaceVCS` 是 workspace 同级的能力对象,提供 `emit / commit / log / diff / show / status / branch / checkout`。应用内 module(TabManager / BrowserTabRuntime / TerminalTabRuntime / ChatSession)主动调 `vcs.emit(...)` 写 events.jsonl + 在边界自动 commit。**不监听用户外部文件编辑**(无 chokidar),用户文件改动由下次 trigger 时 `git status` 懒发现。

> **实施顺序**(2026-04-28 调整):**snapshot 先于 git** —— 5d / 5e 先做(产出 latest.md / latest-cmd.log,即使没 git 也是 main_chat / review 的"current truth"),再做 5b(WorkspaceVCS + simple-git + Tier 1)。**5c+ 目录迁移已完成**(2026-04-28 commit a6a2c13)。
>
> **顺序**:**5d → 5e → 5b → 5a(融入 5b)→ 5f → 5g**

### 已就绪(Phase 1-4 顺手完成的 + 这一轮 commit)
- [x] TabMeta.path 一等字段 + `.silent/` 路径前缀
- [x] `src/main/storage/events.ts` — `appendEventAt(wsPath, evt)`(Phase 5 搬到 `vcs/events.ts`)
- [x] `LocalFsAdapter.appendEvent(agentId, wid, evt)`
- [x] TabManager emit `tab.open / close / focus`
- [x] BrowserTabRuntime emit `did-navigate / did-finish-load`
- [x] TerminalTabRuntime emit `pty-exit`
- [x] **5c+ 目录结构迁移到 `.silent/runtime/` 子目录(commit a6a2c13)**
- [x] `shared/consts.ts` 二分常量(RUNTIME_DIR / MAIN_CHAT / TAB_LATEST_*) + 路径迁移工具
- [x] `LocalFsAdapter.ensureLayoutMigrated`(per-process per-wsPath idempotent)+ `mergeJsonlPrepend`(jsonl race 合并)

### 5a · `vcs/` module 骨架 + WorkspaceVCS 接口(0.5d)
- [ ] `app/src/main/vcs/interface.ts` — `WorkspaceVCS { emit / commit / branch / checkout / status / log / diff / show / dispose }` + `EventSource` / `AutoCommitRule` / `CommitInfo` / `FileStatus` 类型
- [ ] `app/src/main/vcs/factory.ts` — `createWorkspaceVCS(workspacePath: string, opts?): WorkspaceVCS`
- [ ] 验收:`npm run typecheck` 过

### 5b · git wrapper + Tier 1 规则 + IdleTimer(1d)
- [ ] `npm i simple-git`
- [ ] `app/src/main/vcs/git.ts` — 薄封装(init / commit / status / diff / log / show / branch / checkout)
- [ ] `app/src/main/vcs/auto-commit.ts` — rule engine + debounce + IdleTimer
- [ ] 4 条默认 Tier 1 规则(**没有 fs.save**,因为没 watcher):
  - `chat.turn-end`(0ms debounce,Phase 6 接入后才触发)
  - `browser.load-finish`(1s debounce,合并 SPA 多帧)
  - `shell.exit`(0ms,每命令独立)
  - `workspace.idle`(0ms,IdleTimer 30s 触发,commit if dirty)
- [ ] `IdleTimer` 每次 `vcs.emit` 调用时 reset(纯内存 timer,无 chokidar)
- [ ] commit message footer:`---\n trigger: <action>\n ts: <iso>\n event-id: <id>`
- [ ] **新建 workspace 自动 `git init`** + 写默认 `.gitignore`:
  ```
  .DS_Store
  *.swp
  node_modules/
  .silent/state/
  .silent/tabs/*/buffer.log
  ```
- [ ] pre-commit hook:文件 > 10MB 拒绝
- [ ] **`lastActiveAt` 拆出 `meta.yaml` → `.silent/state/last-active.json`(.gitignore)**
- [ ] tab focus 不触发 commit(只 emit events.jsonl,不写 tabs.json)

### 5c · events.ts 搬迁 + emit 单一入口(0.5d)
- [ ] `app/src/main/storage/events.ts` → 搬到 `app/src/main/vcs/events.ts`
- [ ] `WorkspaceVCS.emit` 内部:append events.jsonl + 按规则匹配可能 commit(单一 API,两件事)
- [ ] `LocalFsAdapter.appendEvent` 改成委托给 vcs(或保留作为底层 utility)
- [ ] TabManager / BrowserTabRuntime / TerminalTabRuntime 调用从 `appendEventAt` → `vcs.emit`

### 5c+ · 目录结构迁移到 `.silent/runtime/` 子目录(0.5d)
> 设计依据:[`design/02-architecture.md`](design/02-architecture.md) 二分约定 / [`design/08-vcs.md`](design/08-vcs.md) §1。
> **`git 边界 = .silent/runtime/ 子目录边界`**:`.silent/` 顶层仅放当前真状态(进 git),`.silent/runtime/` 装 logs/cache/历史(.gitignore)。
- [ ] `shared/consts.ts` 加常量:`RUNTIME_DIR = 'runtime'`、`MAIN_CHAT_FILE = 'main_chat.jsonl'`、`MAIN_REVIEW_FILE = 'main_review.jsonl'`
- [ ] `paths.ts` 加 `workspaceRuntimeDir(wsPath)` 等工具,所有 runtime 类文件都走它
- [ ] 路径迁移:
  - `events.jsonl`:`.silent/` → `.silent/runtime/`
  - `messages.jsonl` → `.silent/runtime/main_chat.jsonl`(rename + 路径)
  - 新增:`.silent/runtime/main_review.jsonl`(初始空)
  - `tabs.json`:`.silent/state/` → `.silent/runtime/`
  - `buffer.log`:`.silent/tabs/<tid>/` → `.silent/runtime/tabs/<tid>/`
  - `snapshots/`:整个搬到 `.silent/runtime/tabs/<tid>/snapshots/`
  - `state/*`(cookies / cache / last-active.json 等):整个搬到 `.silent/runtime/state/`
- [ ] **保留进 git 顶层的**:`.silent/meta.yaml`、`.silent/tabs/<tid>/latest.md`、`.silent/tabs/<tid>/latest-cmd.log`(后两个新)
- [ ] 一次性迁移脚本:`addWorkspace` 启动时检测旧布局(`.silent/events.jsonl` 在顶层)→ 迁到新位置 + 写迁移完成标记
- [ ] `.gitignore` 更新成单行 `.silent/runtime/`
- [ ] 验收:重启后老 workspace 自动迁移,events.jsonl 等都进 `runtime/`,顶层 .silent/ 只剩 git tracked 文件

### 5d · BrowserTabRuntime snapshot(Defuddle)(1d)
- [ ] `npm i defuddle`
- [ ] `app/src/main/snapshots/browser.ts` —— `did-finish-load` → `executeJavaScript('document.documentElement.outerHTML')` → `new Defuddle(html, url, {markdown:true}).parse()` → 落 `.silent/runtime/tabs/<tid>/snapshots/NNN-<ts>.md`(historic series, .gitignore)
- [ ] 800ms timeout fallback 到 `innerText` 直存
- [ ] **cp 到 `.silent/tabs/<tid>/latest.md`**(✅ git tracked,git log -p 看页面演化)
- [ ] snapshot 文件头加 URL + title + ts meta(LLM 单文件可读)
- [ ] 落盘后调 `vcs.emit({source:'browser', action:'load-finish', meta:{summary, detailPath:".silent/runtime/tabs/<tid>/snapshots/NNN-..."}})` → 命中 Tier 1 → 1s debounce → commit(包含 latest.md 变化)
- [ ] 内容 < 200 字符跳过(loading 骨架)

### 5e · TerminalTabRuntime snapshot(zsh hook)(1d)
- [ ] `app/src/main/snapshots/terminal.ts`
- [ ] `.silent/runtime/tabs/<tid>/buffer.log` — pty.onData append(.gitignore,信息冗余在 NNN-cmd.log)
- [ ] zsh `preexec` / `precmd` hook 注入(或 prompt 分隔标记切分)
- [ ] `preexec` → `vcs.emit({source:'shell', action:'exec', ...})`(只 emit,不触发 commit)+ 记 `bufferStartOffset`
- [ ] `precmd / exit` → 切片 `runtime/tabs/<tid>/snapshots/NNN-<cmd-ts>.log` + **cp 到 `.silent/tabs/<tid>/latest-cmd.log`**(✅ git)+ `vcs.emit({source:'shell', action:'exit', meta:{summary, cmd, exitCode, durMs, detailPath:"runtime/tabs/<tid>/snapshots/NNN-..."}})` → 命中 Tier 1 → commit(包含 latest-cmd.log 变化)
- [ ] 链式命令 `&&` / `;` 各自独立切片(每个 cmd 一个 commit)
- [ ] 命令参数脱敏(token / 密码 / 私有 URL 白名单匹配后过滤)

### 5f · IPC 暴露 vcs.* + agent meta-skill stub(0.5d)
- [ ] `app/src/main/ipc/vcs.ts` — `vcs.log(wid, opts) / vcs.diff(wid, refA, refB?) / vcs.show(wid, sha) / vcs.status(wid)`
- [ ] preload 暴露 `window.api.vcs.*`
- [ ] (Phase 6 实施)agent-core builtin tool `workspace.log / diff / show / status / commit / branch / checkout` 包一层调 IPC
- [ ] (可选)左栏 / 工作区 footer 简单时间线 UI(显示最近 5 个 commit)

### 5g · linkedFolder probe(0.5d,可选)
- [ ] `meta.yaml.linkedFolder` 字段(已有)
- [ ] IdleTimer 触发 `workspace.idle` 时,如果有 linkedFolder 顺手 probe HEAD + dirty → `vcs.emit({source:'linked', action:'probe', ...})`
- [ ] linkedFolder 路径**自动**加进 workspace `.gitignore`

### 5h · 现有 emit 点补 events 2 层 schema(0.5d)
> 设计依据:[`design/02-architecture.md`](design/02-architecture.md) "Events 2 层结构(强约定)"。
> 现有 emit 点(TabManager / BrowserTabRuntime / TerminalTabRuntime)的 meta 字段还是 `{type, url, exitCode}` 这种结构化短字段,**没有 `summary` 一行简介**。补齐让 LLM scan timeline 有人类可读 hint。
- [ ] `tab.open` / `close` / `focus` emit 加 `meta.summary`(如 `"open browser to logservice"` / `"focus → silent-chat"`)
- [ ] `browser.navigate / load-finish` 加 summary + `meta.detailPath`(指向 snapshots/NNN-*.md, Phase 5d 一起)
- [ ] `shell.exec / exit` 加 summary + `meta.detailPath`(指向 NNN-cmd.log, Phase 5e 一起)
- [ ] `linked.probe` 加 summary
- [ ] 验收:每条 events.jsonl < 1KB,LLM 只读 `summary` 也能理解大概发生了啥

### 验收
- [ ] 新建 workspace → `<wsPath>/.git/` 存在 + initial commit
- [ ] 开浏览器导航 → `tabs/<tid>/snapshots/001-*.md`(Defuddle 干净)+ `latest.md`(copy)+ events.jsonl 多条 + 1 commit
- [ ] 开终端跑 `ls && pwd && git status` → 3 个 NNN-cmd.log 切片 + events.jsonl 6 条(3 exec + 3 exit) + 3 commits
- [ ] 编辑用户文件 `notes.md`,然后跑任意命令 → 1 commit 包含 notes.md 变化(懒发现,无独立 fs.save commit)
- [ ] 30s idle 触发 `workspace.idle` commit if dirty
- [ ] `cd <wsPath> && git log --oneline` 看到可读时间线(`[browser] load: ...` / `[shell] exec: ...` / `[chat] turn: ...`)
- [ ] `git diff sha1 sha2` 一次拿到全部变化(events.jsonl 增量 + 用户文件 diff + 新 snapshot)
- [ ] 删 workspace → 整个目录 `rm -rf` 干净

> **Tier 2 agent-curator 推到 Phase 6**(agent 拿 vcs tool 用,`workspace.commit('语义化 message')` / `workspace.branch / checkout`)。
>
> **OpenChronicle 多级压缩 / bookmark / wall-clock window 推到 v0.2**(详见 08-vcs.md 第 14 节)。

---

## Phase 6 — agent-core monorepo + Chat 接 Claude(~5d)

> **依据**:[`design/03-agent-core.md`](design/03-agent-core.md)。
> **核心思想**:抽出 `@silent/agent-core`(Node-only / 零 Electron),4 层架构(Runtime / AgentRegistry / SessionManager / Sandbox)+ `runSession` 核心 loop 函数,Memory hook 推外。

### 6a · monorepo + agent-core 骨架(0.5d)
- [ ] `packages/agent-core/` 骨架:`package.json (name: "@silent/agent-core")`、空接口编译过
- [ ] `src/types.ts` — `AgentConfig / Session / WorkspaceEvent / Tool / etc.`
- [ ] `src/index.ts` — public exports
- [ ] tsconfig path:`@silent/agent-core` → `packages/agent-core/src`
- [ ] 验收:`npm run build` 三包都过(app + journal + agent-core)

### 6b · Sandbox 接口 + LocalFsSandbox(0.5d)
- [ ] `src/sandbox/interface.ts` — `Sandbox { canRead/canWrite/canExec/readFile/writeFile/exec/listFiles/destroy }`
- [ ] `src/sandbox/local-fs.ts` — MVP 默认实现,只用 `node:fs` + `child_process`
- [ ] unit test:exec / readFile 通

### 6c · AgentRegistry 接口 + app 实现(0.5d)
- [ ] core 只 `src/registry/interface.ts` `AgentRegistry { get / list / update / delete }`
- [ ] `AgentConfig` 类型(id / version / name / system / model / skills / tools / permissionPolicy)
- [ ] **app 端**:`app/src/main/agent/jsonl-agent-registry.ts implements AgentRegistry`,落 `agents/<aid>/versions/v<n>/agent.yaml`
- [ ] 改 skill / system → 产新 version,旧 version 仍在磁盘
- [ ] 验收:update 产 v2;`get(id, version=1)` 取旧;core 包 grep 不出 `fs/yaml/git`

### 6d · runSession 函数 + 4 路 stopReason(1d)
- [ ] `src/session/run-session.ts` —— 核心 loop 函数(三参数 + DI)
- [ ] 4 路退出:`end_turn` / `requires_action` / `retries_exhausted` / `terminated`
- [ ] 内部 `dispatchTools`(并发 readonly 暂不做,串行)
- [ ] Mock LLMClient 跑通 4 条退出路径(表驱动测试)

### 6e · SessionManager + Hooks + 重入(0.5d)
- [ ] `src/session/manager.ts` — `create / send / stream / terminate / get`
- [ ] `idle ≠ 销毁` 重入语义:`requires_action / end_turn / retries_exhausted` 都是 idle,等 `send` 重入 `runSession`,只有 `terminated` 才销毁 sandbox
- [ ] `SessionHooks { onSessionStart / onSessionEnd / onToolUse? }` 接口
- [ ] 每次重入都重走 `onSessionStart`(让上层拿到中途新 memory)
- [ ] mock hooks 验证调用次数 / payload 注入

### 6f · ClaudeAgentSdk LLMClient(1d)
- [ ] `npm i @anthropic-ai/claude-agent-sdk`(走 Claude 订阅)
- [ ] `src/llm/claude-agent-sdk.ts` —— 包一层适配让 SDK 兼容 LLMClient 接口
- [ ] cache_control 集成:`system` + `tools` + 倒数第二条 assistant 打 ephemeral
- [ ] 跑通脚本 `chat.mjs` 一来一回
- [ ] (备)`AnthropicApi` / `OpenAi` LLMClient v0.2 再做

### 6g · Tool 框架 + 内置 3 件套(0.5d)
- [ ] `src/tools/registry.ts` + `Tool` 接口(name / description / input_schema / execute / runMode)
- [ ] tool 执行 **只通过 sandbox**,不直接 fs / child_process
- [ ] 内置 3 个:
  - [ ] `shell.exec(cmd)` → `sandbox.exec`
  - [ ] `file.read(path) / file.write(path, content)` → `sandbox.readFile / writeFile`
  - [ ] `knowledge.lookup(query)` → 读 `agents/<aid>/knowledge/*.md`
- [ ] demo:agent 跑 `ls` 收结果

### 6h · Electron 接入 + WorkspaceAdapter(0.5d)
- [ ] `app/src/main/agent/workspace-adapter.ts` —— `WorkspaceSandboxAdapter implements Sandbox` + `WorkspaceSessionHooks implements SessionHooks`
- [ ] 接 IPC:`chat.send / stream / cancel`
- [ ] `app-config.yaml` 支持 API key / model(优先级:config → `ANTHROPIC_API_KEY` env)
- [ ] 无 key 时 renderer 显示引导
- [ ] **agent 通过 hook 把 chat 事件推给 journal**(`onEvent` → `journal.emit({source:'chat', ...})`)
- [ ] 默认 `claude-sonnet-4-6`;Opus 4.7 可选

### 6i · 浏览器 / 终端 act tool(0.5d)
- [ ] `browser.navigate(tabId, url)` —— 走 `webContents.loadURL`
- [ ] `browser.extractText(tabId, selector?)` —— 走 `executeJavaScript`
- [ ] `browser.waitForLoad(tabId)` —— 监听 `did-finish-load` 一次
- [ ] `tabs.openBrowser(url)` / `tabs.openTerminal()`
- [ ] (Playwright connectOverCDP 推 v0.2)

### 6j · main_chat 主权 tool 集 — MCP server in-Electron(1d)
> 设计依据:[`design/02-architecture.md`](design/02-architecture.md) "main_chat 是 workspace 主权 agent" 节。
> **架构意义**:用户跟 main_chat 一个对话,就能让它代为操作整个 workspace —— 看页面、跑命令、改文件、读历史、commit、调起 review。main_chat 是用户在 workspace 的"放大器"。
> **MVP 走 Claude Code subprocess** 路线时,这些 tool 通过 in-Electron MCP server 暴露给 CC。
- [ ] `app/src/main/mcp/server.ts` —— Electron main 内嵌 HTTP MCP server,启动时拿动态端口
- [ ] CC 启动时通过 `--mcp-config` 指向 `http://127.0.0.1:<port>`,自动 attach 我们的 tool 集
- [ ] MCP server 暴露的 tool 集(per-workspace,通过当前 active workspaceId scope):

  **Browser tools**(基于 Phase 6i 已有的 IPC):
  - [ ] `browser.list_tabs()` → 当前 workspace 所有 browser tab 的 {id, url, title}
  - [ ] `browser.navigate(tabId, url)`
  - [ ] `browser.extract_text(tabId, selector?)` → 当前页面 readability 文本
  - [ ] `browser.wait_for_load(tabId, timeoutMs?)`
  - [ ] `browser.click(tabId, selector)` —— v0.2 接 Playwright 时升级
  - [ ] `browser.screenshot(tabId)` → base64 png

  **Terminal tools**:
  - [ ] `terminal.list_tabs()` → 当前 workspace 所有 terminal tab 的 {id, cwd, lastCmd}
  - [ ] `terminal.run(tabId, cmd, opts?)` → 写入 pty + 等待 next shell.exit + 返回 latest-cmd.log 内容
  - [ ] `terminal.read_buffer(tabId, lines?)` → 读 buffer.log 末尾 N 行
  - [ ] `terminal.send_keys(tabId, keys)` —— raw 注入(给 vim 等 TUI 用)

  **File tools**(复用现有 file IPC):
  - [ ] `file.read(path)` / `file.write(path, content)` / `file.list_dir(path)`
  - [ ] 路径限制:必须在 workspace 内或 linkedFolder 内,跨界拒绝

  **VCS tools**(workspace 版本能力,只读 + 显式 commit):
  - [ ] `workspace.status()` / `workspace.log(opts?)` / `workspace.diff(refA, refB?, paths?)` / `workspace.show(sha)`
  - [ ] `workspace.commit(message)`(Tier 2 显式 commit,覆盖 Tier 1 机械 message)
  - [ ] `workspace.branch(name)` / `workspace.checkout(ref)`(给 agent 试错用,失败 rollback)

  **Review tool**:
  - [ ] `review.run()` —— main_chat 主动触发 review,拿到 markdown 建议(同步返回)

  **Tab management**(给 agent 安排工作环境):
  - [ ] `tab.open_browser(url)` / `tab.open_terminal(cwd?)` / `tab.close(tabId)` / `tab.focus(tabId)`

- [ ] **权限策略**:MVP 全部 allow(`acceptEdits`);v0.2 加 `--allowed-tools` 白名单 + per-tool 用户确认 hook
- [ ] 主进程关 workspace 时:停 MCP server 相关 binding(避免野进程读资源)

### 6k · main_chat 对话流同步到 main_chat.jsonl(0.5d)
> **当前状态**:ChatRuntime 跑 `claude` interactive,raw pty 流写到 buffer 但没结构化解析成 turn。`main_chat.jsonl` 文件路径已就绪(commit a6a2c13)但**还是空文件**。
> **目标**:让 main_chat.jsonl 真正成为对话 truth file,events.jsonl 中 chat.* 事件能 messageId 引用进去。
- [ ] 用 CC 的 `SessionStop` hook(配置在 `~/.claude/settings.json` 或 workspace 级 `.claude/settings.json`)
  - hook 是 shell command,在 CC interactive session 结束时被调
  - hook 调用 silent-agent 的 IPC 把 CC session.jsonl 同步到 workspace 的 main_chat.jsonl
- [ ] 或备选:CC 的 `--include-hook-events` + stream-json 输出格式(只 `--print` 模式有,interactive 不行)
- [ ] ChatRuntime 在每次 spawn 时把 hook 命令注入到 CC config
- [ ] 同步逻辑:增量 append(`tail` CC 的 session.jsonl 新行 → write to workspace's main_chat.jsonl)
- [ ] 每条 message 的 id 保留(供 events.jsonl `meta.messageId` 引用)
- [ ] 验收:用户跟主 chat 对话后,`.silent/runtime/main_chat.jsonl` 有内容 + 每条有 id

### 6l · chat.* events 落 events.jsonl(0.5d)
> 设计依据:design/02-architecture.md events 2 层 schema · chat 用 messageId 引用 main_chat.jsonl
> **当前状态**:events.jsonl 中没有 chat.* 事件,因为 ChatRuntime 不知道 turn 边界。
- [ ] CC SessionStop hook(同 6k)在每次 turn 结束时回调主进程
- [ ] 主进程 emit `vcs.emit({source:'chat', action:'turn-end', meta:{summary, messageId, turnDurMs}})`
- [ ] (备选)从 main_chat.jsonl 增量 detect 新 message + 推断 user / assistant turn,emit 进 events
- [ ] 4 类 chat events 都补:user-turn / tool-use / tool-result / assistant-turn / turn-end
- [ ] 验收:跟主 chat 一来一回 → events.jsonl 多 5 条 chat.* + main_chat.jsonl 多 4 条 message

### 验收(6j 部分)
- [ ] CC subprocess 启动后能 list 所有 silent_agent 提供的 tool
- [ ] 在主 chat 里说"看一下 logservice 这个 tab 当前页面" → CC 调 `browser.extract_text` 返回内容
- [ ] 在主 chat 里说"帮我跑一下 git status" → CC 调 `terminal.run` 返回输出
- [ ] 在主 chat 里说"看一下我最近改了啥" → CC 调 `workspace.log` 返回 commit 列表
- [ ] 在主 chat 里说"分析一下我最近活动" → CC 调 `review.run` 拿到 markdown 建议(自己又触发一次 CC -p)

### Renderer
- [ ] `useChat(workspaceId)` hook 订阅 stream
- [ ] 消息气泡逐字渲染
- [ ] tool_use / tool_result 渲染(沿用 prototype `.msg-tool` / `.msg-kb` 样式)
- [ ] 错误态:无 key / 网络错 / rate limit

### 验收
- [ ] "hi" → Claude 流式回复
- [ ] "错误码 ERR_CTX_TIMEOUT_042 是什么" → `knowledge.lookup` 命中
- [ ] "帮我打开 logservice" → `browser.navigate` 当前 tab 导航
- [ ] `messages.jsonl` 完整记录含 tool_use / tool_result
- [ ] turn-end 触发 git commit(Tier 1 规则)
- [ ] core 包 grep 不到 `electron`

---

## Phase 7 — 教教我仪式 + Skill v1 教学执行(3-4 天)

### Pattern 检测(LLM 摘要)
- [ ] 触发:workspace 空闲 3 分钟 / 用户手动点"分析一下"
- [ ] 输入:`messages.jsonl + events.jsonl`(脱敏后,通过 `vcs.diff(sha1, sha2)` + `vcs.log` 取区间)
- [ ] Claude 输出 `{ title, steps[], confidence, source_refs[] }`
- [ ] 阈值 `>= 0.7` 才推

### "教教我" UI
- [ ] Push 区候选卡片(沿用 prototype Frame 2 样式)
- [ ] 点"教教我" → modal:3 问结构化
- [ ] 前 2 问 agent 预填,第 3 问用户填
- [ ] 保存按钮上方 "v1 教学模式" 说明条

### Skill YAML
- [ ] schema:`{ name, goal, trigger, input, steps[], success_criteria, trust_level, version }`
- [ ] 落盘 `agents/<aid>/skills/<name>.yaml`
- [ ] IPC:`skill.list / skill.get / skill.delete`

### Skill Runner(教学模式)
- [ ] 解释 YAML step 序列
- [ ] 匹配:用户 message + skill list → Claude 判定是否触发
- [ ] 执行:每 step 前暂停,UI 弹"step N 等确认"卡片
- [ ] IPC:`step.confirm / step.modify / step.abort`
- [ ] 执行记录 → `<workspace>/.silent/state/execution.jsonl`(.gitignore)
- [ ] skill.version.usage_count 累加

### UI
- [ ] 教学模式 Push 视图(Frame 3 样式)
- [ ] 草稿预览卡片
- [ ] 左栏 Skills 计数 + "已学会"小卡

### 验收
- [ ] dogfood 跑一次:手动查 logid → "教教我" → 3 问填完 → skill yaml 生成
- [ ] 新 workspace 输 "logid xxx" → 匹配 skill → 教学走 3 步 → 推荐答案可复制

---

## Phase 8 — Dogfood(1 周)

- [ ] 自用 5 天,每天至少一次真实 logid 查询场景
- [ ] 记录:不顺手的点 / 假阳性 pattern / 教学粒度是否烦
- [ ] 调 threshold,fix 明显 bug
- [ ] 体感评估 "<1.5s 冷启动 / <250 MB 运行内存"

**验收**:连续 5 天用得下去;至少 1 次"啊对哦"体验;总结 3 个以上可复用 pattern。

---

# v0.2 — 补全与接入(约 4 周)

### Playwright 接入(完整 Act 能力)
- [ ] `npm i playwright-core`
- [ ] Electron 启动加 `--remote-debugging-port=9222`
- [ ] `playwright.chromium.connectOverCDP(...)` 接现有 webContents
- [ ] 49 verb 中常用的 ~10 个:`click / fill / press / locator / waitForLoadState / screenshot`
- [ ] CDP 跟 DevTools 冲突 spike

### Journal 升级
- [ ] **OpenChronicle 启示** —— 多级压缩 pipeline(1min → 5min → 30min)
- [ ] Bookmark / processors.jsonl(consumer 水位)
- [ ] Wall-clock window pattern 检测
- [ ] PatternDetectorSink / SummarySink
- [ ] 可选 MCP server 暴露 journal(read-only,其他 agent 可订阅)
- [ ] 月度 archive(超 30 天 jsonl 移到 `.silent/archive/`)
- [ ] `workspace.config.streamInGit: false` opt-out(不让 messages/journal 进 git,适合代码 workspace 上 GitHub)

### 飞书 IM 渠道(exclusive)
- [ ] `connections/feishu/` auth + capabilities 实装
- [ ] lark-cli 或 lark-im OpenAPI 接入
- [ ] owner agent 收 @ 消息 → 创建/路由到 workspace
- [ ] 左栏徽章数字实时

### 多 Agent UI
- [ ] LeftNav 顶部下拉切 agent
- [ ] 菜单 "New Window for Agent"
- [ ] Agent 设置面板(model / system prompt / avatar)
- [ ] 新建/重命名/删除 agent UI

### Skill 信任等级
- [ ] "连续 3 次顺利"定义(不改输入 + 不停止 + 不改草稿)
- [ ] v1 → v2 auto(不再一步一停)
- [ ] v2 连续失败 → 降级 v1

### Connection Capability 管理
- [ ] 设置面板展示每 connection 的 capabilities + attachment
- [ ] exclusive capability 换 owner / shared 增删 consumer

### 左栏入口补内容
- [ ] 日程 panel(lark-calendar,shared)
- [ ] TODO panel(lark-task)
- [ ] 邮箱 panel(lark-mail / gmail)

### Background agent + git worktree(借鉴 Yume)
- [ ] 长任务分支跑 agent,合并前冲突检测
- [ ] `yume-async-{type}-{id}` 命名

---

# v0.3 — 生态化

- [ ] 技能商店(import/export/share skill yaml)
- [ ] 双向飞书(agent 主动回推)
- [ ] Pattern 检测升级:PrefixSpan(mechanical)+ embedding 聚类(semantic)
- [ ] 外部知识库 connection(飞书 wiki / Notion)
- [ ] 影子文本(docx/pdf → shadow.md)进 observe 流(详见 05-observation-channels.md 子模块)

---

# 上云版(未来,非承诺)

- [ ] `CloudSyncAdapter` wraps `LocalFsAdapter`(双写 + 本地优先)
- [ ] L1/L2 memory + skills 先同步
- [ ] Managed Agent runtime 替换 `ClaudeAgentSdk`(同 LLMClient 接口)
- [ ] Web tools 路由到云端
- [ ] `RemoteSandbox`(Docker / Firecracker)— 同 Sandbox 接口
- [ ] 跨设备 workspace(observation 保留本地,summary 同步)
- [ ] `CloudAgentRegistry implements AgentRegistry` —— core 一行不改

---

# 基础设施 & 维护

### 测试
- [ ] Playwright E2E(Phase 8 后):启动 / 建 workspace / 开 tab / 发消息
- [ ] Unit:storage / journal / agent-core 各包

### 打包
- [ ] `electron-builder` 配置
- [ ] macOS dmg(arm64 + x64)
- [ ] 自动签名(Apple Developer 证书)

### CI
- [ ] GitHub Actions:typecheck + build on PR
- [ ] Lint(eslint + prettier)

### 可观测
- [ ] 结构化日志 `~/.silent-agent/logs/app.log`
- [ ] 崩溃不外发(本地优先)

---

# 节奏表(单人)

| Phase | 估时 | 累计 | 状态 / 可 dogfood |
|---|---|---|---|
| 1 存储 + Agent/Workspace CRUD | 0.5d | 0.5d | ✅ 无 AI,左栏真实数据 |
| 2 浏览器 tab | 2–3d | 3.5d | ✅ 可当浏览器用 |
| 3 终端 tab | 1–2d | 5.5d | ✅ 轻 IDE 雏形 |
| 4 文件 tab + Monaco | 1–2d | 7.5d | ✅ 三件套齐 |
| **5 Workspace 化 · WorkspaceVCS+snapshot** | ~4d | 11.5d | **🔄 进行中**:`vcs/` module + Tier 1 auto-commit + Defuddle snapshot + zsh hook |
| **6 agent-core monorepo + Chat** | ~5d | 17.5d | AI 首次接入(`@silent/agent-core` + `runSession` + Claude SDK) |
| 7 教教我 + Skill | 3–4d | 21d | 完整闭环 |
| 8 Dogfood | 1w | 28d (~4w) | v0.1 出货 |

相比早期 `archive/mvp-plan-v3-tauri.md` 估 6–8 周更激进,因为:
- 多 agent 先只做数据模型,UI 砍到 0
- connections 只占位,飞书 IM 推 v0.2
- 日程/TODO/邮箱 推 v0.2
- Skill 升级路径推 v0.2
- Playwright + AX tree 推 v0.2

---

# 快速参考

- **Dogfood 任务**:logid 查日志(见 `design/prototype-v0.1.html` Frame 1-3)
- **第一个 skill**:`查logid报告`
- **Agent 身份**:`silent-default`(slug,MVP 唯一)
- **存储根**:`~/.silent-agent/`
- **设计锚**:
  - [`design/02-architecture.md`](design/02-architecture.md) — 代码结构 / 数据模型真相源
  - [`design/08-vcs.md`](design/08-vcs.md) — Phase 5 实施依据
  - [`design/03-agent-core.md`](design/03-agent-core.md) — Phase 6 实施依据
  - [`design/_Index.md`](design/_Index.md) — 全部设计文档索引
