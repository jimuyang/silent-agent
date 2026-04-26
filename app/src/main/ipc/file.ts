// [main · 桥接层 · import 'electron']
// File tab 相关 IPC: 原生 picker / 读文件 / 写文件。
// 不做目录树、不做 git、不做版本化 —— 用户自己决定打开哪个文件, 我们只管读写。

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, access, mkdir, readdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { isAbsolute, join, normalize, resolve, dirname } from 'node:path'

import { IPC } from '@shared/ipc'
import { SILENT_DIR } from '@shared/consts'
import type { StorageAdapter } from '../storage/adapter'
import { agentIdFromEvent } from './context'

// 简单大小阈值: 5 MB 以上拒绝读入,避免把编辑器卡死
const MAX_READ_BYTES = 5 * 1024 * 1024

export function registerFileIpc(storage: StorageAdapter) {
  // 弹原生文件选择器(跟 tab.popupTypeMenu 同样原因: 原生 UI 不会被 WebContentsView 盖住)
  ipcMain.handle(IPC.FILE_PICK_OPEN, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.FILE_READ, async (_e, path: string) => {
    const buf = await readFile(path)
    if (buf.byteLength > MAX_READ_BYTES) {
      throw new Error(`file too large: ${buf.byteLength} bytes (> ${MAX_READ_BYTES})`)
    }
    return buf.toString('utf8')
  })

  ipcMain.handle(
    IPC.FILE_WRITE,
    async (_e, payload: { path: string; content: string }) => {
      await writeFile(payload.path, payload.content, 'utf8')
    },
  )

  // 在当前 session 的 workspace 根目录下新建一个空文件,返回绝对路径。
  // 拒绝:绝对路径 / 路径逃逸(..)/ 写入 .silent/ 或 .git/ 内部。
  ipcMain.handle(
    IPC.FILE_CREATE_IN_SESSION,
    async (event, payload: { sessionId: string; filename: string }) => {
      const agentId = agentIdFromEvent(event)
      const wsPath = await storage.resolveSessionPath(agentId, payload.sessionId)

      const clean = normalize(payload.filename.trim())
      if (
        !clean ||
        clean.startsWith('..') ||
        isAbsolute(clean) ||
        clean.split('/').some((seg) => seg === '..') ||
        clean.startsWith(`${SILENT_DIR}/`) ||
        clean === SILENT_DIR ||
        clean.startsWith('.git/') ||
        clean === '.git'
      ) {
        throw new Error(`invalid filename: ${payload.filename}`)
      }

      const abs = resolve(join(wsPath, clean))
      // 再确认一次 abs 在 wsPath 内(防 symlink / 规范化绕过)
      if (!abs.startsWith(resolve(wsPath) + '/')) {
        throw new Error(`path escapes workspace: ${clean}`)
      }

      // 已存在则直接返回(幂等),避免覆盖用户已有文件
      try {
        await access(abs, fsConstants.F_OK)
        return abs
      } catch {
        /* fall through: create */
      }

      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, '', 'utf8')
      return abs
    },
  )

  // 列目录,用于文件树。只返回 name + isDir,不做递归(renderer 按需懒展开)。
  ipcMain.handle(IPC.FILE_LIST_DIR, async (_e, absPath: string) => {
    const entries = await readdir(absPath, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
    }))
  })
}
