# Silent Agent — 任务清单

> 按 Phase 切,每个 Phase 落一个可独立 dogfood 的里程碑。
> 状态: `[x]` 完成 · `[ ]` 待做 · `[~]` 进行中 · `[!]` 阻塞
>
> 核心重排:**Tab 基础设施先做,AI 后置**。先把"轻 IDE 壳"跑通 dogfood 工作区形态,再上 agent。
> 数据模型按多 agent 设计,MVP 单 window 单 default agent。

---

## Phase 0 — 架构与骨架 ✅

产出:可运行的 Electron 壳 + 三栏布局 + IPC 通路。

- [x] 10 份设计文档对齐到 v3 产物视角
- [x] `design/architecture.md` — 五层 + 多 agent 模型(Agent / Session / Connection / Capability / Attachment)
- [x] 技术栈:Electron 38 + React 19 + Vite + TS 5
- [x] electron-vite 项目脚手架 + 三套 tsconfig
- [x] 三进程模型(main / preload / renderer)
- [x] contextBridge 暴露 `window.api` + IPC `ping-pong`
- [x] 三栏布局 React 组件(LeftNav / TabBar / BrowserPane / SilentChat / PingPill)
- [x] CSS tokens + 暗色主题
- [x] `CLAUDE.md` 硬性规则:Electron 专属 API 必须注释
- [x] hot-reload:main / preload 改动自动重启

---

## Phase 1 — 存储层 + Agent/Session CRUD (半天) ✅

让 agent / session / tab / message / observation 都有落盘能力,左栏真从磁盘读。

### 路径与工具
- [ ] `src/main/storage/paths.ts` — `~/.silent-agent/` 下所有路径,入口带 `agentId`
- [ ] `src/main/storage/jsonl.ts` — append / 流式读取 / 逐行解析
- [ ] `src/main/storage/yaml.ts` — `readYaml` / `writeYamlAtomic`(tmp + rename)
- [ ] `src/main/storage/index.ts` — `_index.json` 读写+重建

### StorageAdapter 接口
- [ ] `src/main/storage/adapter.ts` — `interface StorageAdapter`(完整签名见 architecture.md)
- [ ] `src/main/storage/local-fs.ts` — `LocalFsAdapter` 实现
- [ ] **不 import 'electron'**,纯 Node 代码

### Agent 模型
- [ ] `src/main/agent/registry.ts` — `listAgents / getAgent / createAgent / ensureDefault`
- [ ] 启动时 `ensureDefault()`:若 `agents/silent-default/` 不存在则自动创建
- [ ] `src/shared/types.ts` 加 `AgentMeta` 类型

### Session 模型
- [ ] `src/main/agent/session.ts` — `listSessions(agentId) / createSession / loadMessages / rename / delete`
- [ ] id 生成:`${YYMMDD}-${shortHash}-${slug?}`(如 `260423-a1b2-logid`)
- [ ] 启动时若 default agent 下无 session,建 `#welcome` chat session

### IPC 层
- [ ] `src/main/ipc/agent.ts` — `agent.current` / `agent.list`
- [ ] `src/main/ipc/session.ts` — `session.list` / `session.create` / `session.rename` / `session.delete` / `session.loadMessages`
- [ ] IPC handler 内部从 `BrowserWindow.fromWebContents(event.sender)` 取 `agentId`(MVP 单 window,直接 default)
- [ ] preload 暴露对应方法到 `window.api.agent.*` / `window.api.session.*`
- [ ] `src/shared/ipc.ts` — 集中定义 IPC channel name 常量(两端共用)

### Renderer
- [ ] `src/renderer/src/hooks/useAgent.ts` — 订阅当前 agent
- [ ] `src/renderer/src/hooks/useSessions.ts` — 订阅 session 列表
- [ ] LeftNav 的 agent 展示区从硬编码切到 `useAgent()`
- [ ] LeftNav 的 sessions 列表切到 `useSessions()`
- [ ] 新建按钮接 `session.create`
- [ ] 空态:无 session 时显示"无会话"(首次启动应该不会到,自动建了 welcome)

### 验收
- [ ] `npm run dev` 启动,`~/.silent-agent/agents/silent-default/sessions/<welcome>/` 自动出现
- [ ] 点 `＋` 新建 chat session,立刻显示在左栏;磁盘对应 `meta.yaml + messages.jsonl + context/ + state/`
- [ ] 重启 app,session 列表保留

---

## Phase 2 — Tab 管理框架 + 浏览器 tab (2-3 天) ✅

点 `[+]` 真开 `WebContentsView` 导航到 URL,Silent Chat pinned 被挤压到右边。

### 数据模型
- [ ] `src/shared/types.ts` 加 `Tab` 类型(discriminated union by `type`)
- [ ] `Tab.state` 按 type 分:`BrowserTabState / TerminalTabState / FileTabState`
- [ ] Tab 落盘到 `agents/<aid>/sessions/<sid>/state/tabs.json`(整文件重写)

### Tab Manager (桥接层,import electron)
- [ ] `src/main/tabs/manager.ts` — 每个 session 维护一份 tab 列表,应用启动按 `tabs.json` 恢复
- [ ] `src/main/tabs/browser.ts` — 每个 browser tab 对应一个 `WebContentsView`
- [ ] `view.setBounds(...)` 按 BrowserPane 的 DOM 位置贴;其他 tab 时 bounds 归零隐藏
- [ ] Silent Chat tab 是虚拟 tab,不实际对应 WebContentsView(它就是 renderer 里的 React 组件)

### IPC
- [ ] `tab.list(sessionId)` → `TabMeta[]`
- [ ] `tab.open(sessionId, { type: 'browser', url })` → `TabMeta`
- [ ] `tab.close(tabId)`
- [ ] `tab.focus(tabId)` — 负责切 view 可见性
- [ ] `tab.setBounds(tabId, { x, y, w, h })` — renderer 告诉 main "浏览器 pane 的实际位置"

### Renderer
- [ ] `useTabs(sessionId)` hook
- [ ] TabBar 接 `useTabs`,[+] 点击弹 prompt "输入 URL"(MVP 最简)
- [ ] TabBar 渲染规则:`[+] | [browser...] [terminal...] [file...] | spacer | [Silent Chat pinned]`
- [ ] 切 tab 时通过 `useResizeObserver` 监听 BrowserPane div 的位置 → `tab.setBounds`
- [ ] 关 tab (`×`) 接 `tab.close`

### 验收
- [ ] [+] → 输 `https://example.com` → 浏览器 tab 展示网页
- [ ] 切到 Silent Chat 再切回 → 页面保留
- [ ] 多 tab 能共存,浮动标签正确挤压 Silent Chat
- [ ] 关闭窗口再打开,tabs 按 `tabs.json` 恢复
- [ ] 不同 session 之间 tab 隔离(切 session 看到不同 tab 集合)

---

## 按需 — 浏览器 Tab 体验升级(对标 Cursor)

MVP 目前只显示 URL 文本 tab + 网页本体,没有 chrome 工具栏。参考 Cursor 的内嵌浏览器形态(截图见上下文),补以下细节提升手感:

### 地址栏 / 导航栏
- [ ] 浏览器 tab 激活时,tab bar 下方浮出一条 chrome 工具栏(高 ~38px)
- [ ] 左侧 icon 按钮组:`‹` 返回 · `›` 前进 · `↻` 刷新 · `★` 收藏
- [ ] 中央可编辑 URL 地址栏,Enter 触发 `tab.navigate`,Esc 恢复原值
- [ ] 右侧工具区(可选):`select-DOM` / 打开 DevTools / 侧栏折叠 / 更多菜单

### Tab 本身
- [ ] Tab icon 差异化:browser tab 显示 favicon(`did-finish-load` 后从 page 提取)
- [ ] Tab 关闭按钮 `×` 只在 `:hover` 或 `.active` 时显示(当前 hover 时显示所有非 pinned tab 的 × — 需调整)
- [ ] Tab 右键菜单:复制 URL / 重载 / 复制 tab 到新 tab / 关闭其他

### 内部实现要点
- 导航栏作为 BrowserPane 的子组件,浏览器 tab 激活时才渲染
- URL 状态从 main 端 `BrowserTabRuntime` 的 `did-navigate` 事件同步
- favicon 从 `webContents.on('page-favicon-updated')` 抓 URL,renderer 显示为 `<img>`
- 导航栏高度 38px 吃掉 split-left 顶部,BrowserPane ResizeObserver 会自动收缩 WebContentsView

截图保存位置:原型对齐时再贴到 `design/prototypes/browser-chrome-v0.2.html`(暂无)

---

## 按需 — 分栏升级(Level 1 / Level 2)

详见 `design/architecture.md` 的"分栏演进路线"。v0.1 默认停在 Level 0(hardcoded B 模式 1.3:1)。

### Level 1(约 2h,触发:dogfood 发现要调比例)
- [ ] `sessions/<sid>/state/layout.json` — `{ splitRatio: 0~1 }`
- [ ] IPC:`layout.getRatio(sessionId) / layout.setRatio(sessionId, r)`
- [ ] `.split-left / .split-right` 用 CSS variable 或 inline `flex: <r>` 接 ratio
- [ ] divider 加 `onMouseDown` 拖动 handler,move 时 setRatio
- [ ] 默认值 0.56(等价 1.3:1)

### Level 2(1-2 天,触发:真实多-pane 需求)
- [ ] `layout.json: { tree: LayoutNode }` — 递归 split 树
- [ ] `<LayoutTree>` 组件递归渲染,叶子 = tab content
- [ ] tab 拖放到目标 split 的处理(react-dnd 或手撸 HTML drag API)
- [ ] 关 tab 时 empty pane 自动折叠
- [ ] 键盘快捷键:`Cmd+\` 纵 split / `Cmd+Shift+\` 横 split

---

## Phase 5 — Session 化 · 产物、事件、版本(3.5-4 天)

> 合并原 Phase 2.5(tab snapshot)和 Phase 5(observation channels);对齐 `architecture.md` 的统一模型:
> **Session = git repo**,**Tab = `{type, path, state}` 指针**,**Events = session 级单一时间线**,**产物 per-tab 自管**。

### 5a · 统一 TabMeta(0.5d)
- [ ] `TabMeta.path` 提为一等字段(相对 session 目录 或 绝对路径)
- [ ] `SessionType / SessionMeta.type` 保留字段但不再分支逻辑(v0.2 删);`boundFolder` → `linkedFolder`(语义降级为可选外部挂载)
- [ ] `LocalFsAdapter.createSession` 初始 `silent-chat` tab 的 path 填 `messages.jsonl`
- [ ] TabManager.open 创 browser/terminal tab 时顺带建 `tabs/<tid>/` 目录,path 填该相对路径

### 5b · Session 级 events.jsonl(0.5d)
- [ ] `src/main/storage/events.ts` — `appendEvent(agentId, sid, evt)` 工具
- [ ] StorageAdapter 加 `appendEvent` 方法
- [ ] 所有 emit 点接入:
  - TabManager: open / close / focus
  - BrowserTabRuntime: did-navigate / did-finish-load / webRequest(节流)
  - TerminalTabRuntime: command exec(preexec)/ exit / pty.data(节流)
  - Chat harness(Phase 6 接入):user-turn / agent-turn(带 preview)
- [ ] 取消原计划的 `context/*.jsonl` 按通道切分

### 5c · 终端产物落盘(0.5d)
- [ ] `tabs/<tid>/buffer.log` — pty.onData 同步 append(保留 rolling buffer 做 fast-replay,但**同时**落盘)
- [ ] `tabs/<tid>/snapshots/<NNN>-<cmd-ts>.log` — preexec/exit 时切片保存该命令前后 scrollback

### 5d · 浏览器产物落盘(1d)
- [ ] `did-finish-load` 触发 `webContents.executeJavaScript('document.body.innerText')` → 落 `tabs/<tid>/snapshots/NNN-<ts>.md`
- [ ] `latest` symlink 指向最新;garbage 每 tab 保留 50
- [ ] 后续接 `defuddle` 类库做 readability(v0.2)

### 5e · linkedFolder 支持(0.5d,可选)
- [ ] `meta.yaml.linkedFolder` 字段
- [ ] 如果 linkedFolder 是 git repo:定时 probe → 写 events.jsonl `{source:'linked', action:'probe', meta:{head, dirty}}`
- [ ] 如果不是 git repo:每文件 sha256 的 pointer snapshot
- [ ] chokidar watch linkedFolder → session events.jsonl(file create/modify/delete)

### 5f · Git 集成 Layer 1 · 基础规则 auto-commit(1d)
- [ ] `npm i simple-git`
- [ ] `src/main/storage/git.ts` — `SessionGit` 类(init / commit / status / diff)
- [ ] `LocalFsAdapter.createSession` → auto `git init` + initial commit + 默认 .gitignore
- [ ] commit 触发时机(Layer 1):
  - Chat turn 完成 / 浏览器 did-finish-load 有新 snapshot / 终端命令 exit / 文件 save / tab close / idle 30s flush
- [ ] commit message 格式化:`[source] action: summary` + footer(event-id / ts / tab-id)
- [ ] `.gitignore` 默认:`.DS_Store` / `node_modules/` / linkedFolder 路径(若有) / 其他 cache
- [ ] `state/tabs.json` 入库但不因 tab focus 抖动 commit(只在 tab open/close/switch 边界)

### 5g · IPC 补(0.5d)
- [ ] `session.gitLog(sid, limit?)` → `{sha, message, ts, files[]}[]`
- [ ] `session.gitDiff(sid, ref?, path?)` → patch text(供未来 UI 时间线 / diff 浏览)

**Layer 2 agent-curator 推到 Phase 6**(agent 作 git tool 用)。

### 验收
- [ ] 新建 session → `~/.silent-agent/agents/*/sessions/<sid>/.git/` 存在
- [ ] 开浏览器导航 → `tabs/<tid>/snapshots/001-*.md` + events.jsonl 相关事件 + 一个 git commit 落下
- [ ] 开终端跑 `ls && pwd && git status` → `buffer.log` 有输出 + snapshots/ 有 3 个切片 + events.jsonl 有 3 条 exec 事件 + 3 个 commit
- [ ] `cd ~/.silent-agent/.../sessions/<sid> && git log --oneline` 看到可读的时间线
- [ ] events.jsonl 里能看到 tab focus / open / close 事件(跨 tab 时序完整)
- [ ] 删某 session → 整个目录 `rm -rf` 干净,没有外部残留

---

## Phase 3 — 终端 tab (1-2 天) ✅

内嵌 xterm.js + node-pty,能跑 shell。

### 依赖
- [ ] `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links`(renderer)
- [ ] `node-pty`(main;注意 native 模块需 electron-rebuild)
- [ ] package.json 加 `postinstall` 脚本跑 `electron-rebuild`(如有问题)

### Main
- [ ] `src/main/tabs/terminal.ts` — 每个终端 tab 起一个 pty 进程(默认 `$SHELL`)
- [ ] `pty.onData(chunk)` → `webContents.send('pty.data', { tabId, chunk })`
- [ ] `pty.onExit(...)` → 通知 renderer tab 关闭
- [ ] IPC: `terminal.write(tabId, input)` / `terminal.resize(tabId, cols, rows)`

### Renderer
- [ ] `<TerminalPane tab={tab}>` — xterm 实例 + fit addon
- [ ] 订阅 `pty.data` 流 → `term.write(chunk)`
- [ ] 键盘输入 → `terminal.write`
- [ ] ResizeObserver → `terminal.resize`

### 验收
- [ ] [+] → "新终端" → 能跑 `ls / pwd / git status`
- [ ] 终端输出颜色正确
- [ ] resize 正常,没有串行/超宽

---

## Phase 4 — 文件 tab (1-2 天) ✅

文件树 + 简单只读查看器。编辑不做(用户自备 vim/VSCode)。

### Main
- [ ] `src/main/tabs/file.ts` — 文件 tab 初始 cwd(session.boundFolder 或 home)
- [ ] IPC: `file.readDir(path)` / `file.readFile(path)` / `file.stat(path)`
- [ ] 文件类型判断:text / image / binary;binary 只显示元数据

### Renderer
- [ ] `<FilePane tab={tab}>` — 左树 + 右预览
- [ ] 树:`fs-tree` 样式(点文件夹展开/收起)
- [ ] 预览:text 用 `<pre>` 带语法高亮(`highlight.js` 轻量)
- [ ] Markdown 特殊处理:展示渲染后版本(可选,可推 v0.2)

### 验收
- [ ] [+] → "文件" → 默认打开 home 目录
- [ ] 点 `.md / .ts / .json` 能看到内容
- [ ] 图片能预览缩略图
- [ ] 大文件(>1 MB)给出"过大不展示"提示

---

## ~~Phase 5-old — Observation 三通道~~ (已并入 Phase 5 Session 化)

> observation 事件和 tab 产物合并到 Phase 5 Session 化里,按 session 级 `events.jsonl` 落盘。
> `context/*.jsonl` 按通道切分的设计被取消。

---

## Phase 6 — Chat 接 Claude API + Tool 框架 + 知识库 (3-4 天)

Silent Chat 真能跟 Claude 聊,能调 knowledge.lookup 等 tool。

### 配置
- [ ] `~/.silent-agent/app-config.yaml` 支持 API key / model
- [ ] 优先级:config file → `ANTHROPIC_API_KEY` env
- [ ] 无 key 时 renderer 显示引导(粘 key 后落盘)

### LLM client
- [ ] `src/main/agent/llm.ts` — 封装 `@anthropic-ai/sdk` 的 messages.stream
- [ ] 默认 `claude-sonnet-4-6`;Opus 4.7 可选

### Harness (minimal loop)
- [ ] `src/main/agent/harness.ts` — `runLoop(agentId, sessionId, userInput)`
- [ ] 消息追加到 `messages.jsonl`
- [ ] stream 事件通过 `webContents.send('chat.delta', {...})` 推 renderer
- [ ] 支持取消(renderer 切 session / 关 tab)

### Tool 框架
- [ ] `src/shared/tool.ts` — `interface Tool`(name/description/input_schema/execute/runMode)
- [ ] `src/main/tools/registry.ts` — 注册 / 查找 / 枚举
- [ ] tool_use 收到 → 查 registry → execute → 追加 tool_result → 继续 loop

### 首批 Tools
- [ ] `knowledge.lookup(query)` — 读 `agents/<aid>/knowledge/*.md`,让 Claude 做语义匹配(无 embedding)
- [ ] `browser.navigate(url)` — 驱动现有 browser tab
- [ ] `browser.extractText(selector?)` — 抽当前 tab 正文
- [ ] `tabs.openBrowser(url)` — 新开 tab

### Renderer
- [ ] `useChat(sessionId)` hook 订阅流
- [ ] 消息气泡支持逐字渲染
- [ ] tool_use / tool_result 渲染(沿用 prototype .msg-tool / .msg-kb 样式)
- [ ] 错误态:无 key / 网络错 / rate limit

### 验收
- [ ] "hi" → Claude 流式回复
- [ ] "错误码 ERR_CTX_TIMEOUT_042 是什么" → 调 knowledge.lookup → 返回错误码.md 命中
- [ ] "帮我打开 logservice" → 调 browser.navigate,当前 tab 导航
- [ ] `messages.jsonl` 完整记录含 tool_use / tool_result

---

## Phase 7 — 教教我仪式 + Skill v1 教学执行 (3-4 天)

### Pattern 检测 (LLM 摘要)
- [ ] 触发:session 空闲 3 分钟 / 用户手动点"分析一下"
- [ ] 输入:`messages.jsonl + context/*.jsonl`(脱敏后)
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
- [ ] IPC: `skill.list / skill.get / skill.delete`

### Skill Runner (教学模式)
- [ ] `src/main/tools/skill-runner.ts` — 解释 YAML step 序列
- [ ] 匹配:用户 message + skill list → Claude 判定是否触发
- [ ] 执行:每 step 前暂停,UI 弹"step N 等确认" 卡片
- [ ] IPC: `step.confirm(stepId)` / `step.modify(stepId, input)` / `step.abort`
- [ ] 执行记录 → `state/execution.jsonl`
- [ ] skill.version.usage_count 累加

### UI
- [ ] 教学模式 Push 视图(Frame 3 样式)
- [ ] 草稿预览卡片(tentative rec-card)
- [ ] 左栏 Skills 计数 + "已学会"小卡

### 验收
- [ ] 跑一次 dogfood:手动查 logid → "教教我" → 3 问填完 → skill yaml 生成
- [ ] 新 session 输"logid xxx" → 匹配 skill → 教学走 3 步 → 推荐答案可复制

---

## Phase 8 — Dogfood (1 周)

- [ ] 自用 5 天,每天至少一次真实 logid 查询场景
- [ ] 记录:不顺手的点 / 假阳性 pattern / 教学粒度是否烦
- [ ] 调 threshold,fix 明显 bug
- [ ] 体感评估 "<1.5s 冷启动 / <250MB 运行内存"

**验收**:连续 5 天用得下去;至少 1 次"啊对哦"体验;总结 3 个以上可复用 pattern。

---

# v0.2 — 补全与接入(约 4 周)

### 飞书 IM 渠道(exclusive)
- [ ] `connections/feishu/` auth + capabilities 实装
- [ ] lark-cli 或 lark-im OpenAPI 接入
- [ ] owner agent 收 @ 消息 → 创建/路由到 session
- [ ] 左栏徽章数字实时

### Workspace Promote
- [ ] Chat session 右键"提升为 Workspace"
- [ ] 选外挂文件夹 → 启动 observers → 更新 `meta.yaml.type`
- [ ] si-tag ws 样式

### 多 Agent UI
- [ ] LeftNav 顶部下拉:切当前 window 的 agent
- [ ] 菜单"New Window for Agent"
- [ ] Agent 设置面板(model / system prompt / avatar)
- [ ] 新建/重命名/删除 agent UI

### Skill 信任等级
- [ ] "连续 3 次顺利"定义(不改输入 + 不停止 + 不改草稿)
- [ ] v1 → v2 auto(不再一步一停)
- [ ] v2 连续失败 → 降级 v1

### Connection Capability 管理
- [ ] 设置面板展示每 connection 的 capabilities + attachment
- [ ] exclusive capability 换 owner
- [ ] shared capability 增删 consumer

### 左栏入口补内容
- [ ] 日程 panel(lark-calendar,shared capability)
- [ ] TODO panel(lark-task)
- [ ] 邮箱 panel(lark-mail / gmail)

---

# v0.3 — 生态化

- [ ] 技能商店(import/export/share skill yaml)
- [ ] 双向飞书(agent 主动回推)
- [ ] Pattern 检测升级:PrefixSpan(mechanical)+ embedding 聚类(semantic)
- [ ] 外部知识库 connection(飞书 wiki / Notion)
- [ ] Session → Workspace 真实文件迁移
- [ ] 影子文本(docx/pdf → shadow.md)进 observe 流

---

# 上云版(未来,非承诺)

- [ ] `CloudSyncAdapter` wraps `LocalFsAdapter`(双写 + 本地优先)
- [ ] L1/L2 memory + skills 先同步
- [ ] Managed Agent runtime 替换本地 harness
- [ ] Web tools 路由到云端
- [ ] 跨设备 session(observation 保留本地,summary 同步)

---

# 基础设施 & 维护

### 测试
- [ ] Playwright E2E(Phase 8 后):启动 / 建会话 / 开 tab / 发消息
- [ ] Unit:storage 层 + harness 核心 loop + tool registry

### 打包
- [ ] `electron-builder` 配置
- [ ] macOS dmg(arm64 + x64)
- [ ] 自动签名(要 Apple Developer 证书,可选)

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
| 1 存储 + Agent/Session CRUD | 0.5d | 0.5d | ✅ 无 AI,左栏真实数据 |
| 2 浏览器 tab | 2–3d | 3.5d | ✅ 可当浏览器用 |
| 3 终端 tab | 1–2d | 5.5d | ✅ 轻 IDE 雏形 |
| 4 文件 tab + Monaco | 1–2d | 7.5d | ✅ 三件套齐 |
| **5 Session 化 · 产物+事件+git** | 3.5–4d | 11.5d | **下一个**:每 session 一 git repo,events.jsonl,产物快照 |
| 6 Chat + Tools + git agent curator | 3–4d | 15.5d | AI 首次接入 |
| 7 教教我 + Skill | 3–4d | 19.5d | 完整闭环 |
| 8 Dogfood | 1w | 26.5d (~4w) | v0.1 出货 |

相比原 `mvp-plan.md` 估 6–8 周更激进,因为:
- 多 agent 先只做数据模型,UI 砍到 0
- connections 只占位,飞书 IM 推 v0.2
- 日程/TODO/邮箱 推 v0.2
- Skill 升级路径推 v0.2

---

# 快速参考

- **Dogfood 任务**:logid 查日志(见 `design/prototype-v0.1.html` Frame 1-3)
- **第一个 skill**:`查logid报告`
- **Agent 身份**:`silent-default` (slug, MVP 唯一)
- **存储根**:`~/.silent-agent/`
- **设计锚**:`design/architecture.md` 是代码结构和数据模型的真相源
