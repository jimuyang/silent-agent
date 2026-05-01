// [main] Electron 主进程入口。
// Electron 有三种进程:main(Node.js,1 个)/ preload(桥接)/ renderer(Chromium,N 个)。
// 这里是 main,类似 Node 服务器,负责创建窗口、文件系统、IPC、观察通道、agent harness。

import { app, BrowserWindow, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'node:path'

import { LocalFsAdapter } from './storage/local-fs'
import { AgentRegistry } from './agent/registry'
import { WorkspaceService } from './agent/workspace'
import { registerAllIpc } from './ipc'
import { TabManager } from './tabs/manager'
import { registerTabManager, unregisterTabManager } from './ipc/tab'
import { ChatManager } from './chat/manager'
import { registerChatManager, unregisterChatManager } from './ipc/chat'

// [main] 开 CDP remote-debugging-port,让 Playwright (snapshots/playwright-cdp.ts)
// 能 connectOverCDP 抓 ariaSnapshot。必须在 app.whenReady 之前 appendSwitch,
// app 启动后 Chromium 才会 bind 这个端口。9222 是 Chromium 业界惯例;
// 如端口冲突,Chromium 会启动失败 — 暂时硬编码,真冲突再加端口探测。
app.commandLine.appendSwitch('remote-debugging-port', '9222')

/**
 * 只建 window,不立即 load renderer —— 给调用方留出时间注册 TabManager 等窗口级资源,
 * 避免 renderer 启动后立刻发 IPC 却找不到对应的 manager(竞态)。
 * 调用方拿到 BrowserWindow 后,完成注册再 loadRenderer()。
 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#0f1013',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
    },
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  return win
}

function loadRenderer(win: BrowserWindow): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// app.whenReady 是 Electron 初始化完成的 Promise,在此之前不能创建窗口
app.whenReady().then(async () => {
  // Windows 专用的应用 ID(任务栏、通知分组用);macOS 无影响但设置无害
  electronApp.setAppUserModelId('app.silentagent')

  app.on('browser-window-created', (_, window) => {
    // 开发时的快捷键:Cmd+R 刷新,Cmd+Opt+I 打开 DevTools。线上自动关闭。
    optimizer.watchWindowShortcuts(window)
  })

  // ----- 装配业务层(纯 TS, 不碰 electron) -----
  const storage = new LocalFsAdapter()
  const registry = new AgentRegistry(storage)
  const workspaces = new WorkspaceService(storage)

  // 启动 guard:保证 default agent + 至少一条 workspace 存在
  const defaultAgent = await registry.ensureDefault()
  await workspaces.ensureHasWorkspace(defaultAgent.id)

  // ----- IPC 注册(唯一 import electron 的业务入口) -----
  registerAllIpc({ registry, workspaces, storage })

  // 先建窗口(还没 load renderer),避免 renderer 启动后 IPC 早于 manager 注册的竞态
  const win = createWindow()

  const tabManager = new TabManager(win, storage, () => defaultAgent.id)
  registerTabManager(win.id, tabManager)
  const chatManager = new ChatManager(win, storage, () => defaultAgent.id)
  registerChatManager(win.id, chatManager)
  win.on('closed', () => {
    unregisterTabManager(win.id)
    unregisterChatManager(win.id)
  })

  // 所有窗口级资源就位,再 load renderer
  loadRenderer(win)

  // macOS 的习惯:点 dock 图标时没有窗口就开一个新的
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      const tm = new TabManager(w, storage, () => defaultAgent.id)
      registerTabManager(w.id, tm)
      const cm = new ChatManager(w, storage, () => defaultAgent.id)
      registerChatManager(w.id, cm)
      w.on('closed', () => {
        unregisterTabManager(w.id)
        unregisterChatManager(w.id)
      })
      loadRenderer(w)
    }
  })
})

// macOS 默认关闭所有窗口后应用仍驻留(要 Cmd+Q 才退);其他平台直接 quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
