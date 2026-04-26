// [main · 纯业务, 不 import 'electron']
// JSONL 追加 / 读取。一行一个 JSON 对象。
// 所有高频 append 的真相源数据(messages / observation events / skill execution)都走这里。

import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * 追加一行。自动建父目录。原子性由 OS 保证(单行 write 一般是 atomic)。
 */
export async function appendLine(path: string, obj: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, JSON.stringify(obj) + '\n', 'utf8')
}

/**
 * 批量追加。比多次 appendFile 快。
 */
export async function appendLines(path: string, objs: unknown[]): Promise<void> {
  if (objs.length === 0) return
  await mkdir(dirname(path), { recursive: true })
  const chunk = objs.map((o) => JSON.stringify(o)).join('\n') + '\n'
  await appendFile(path, chunk, 'utf8')
}

/**
 * 读取全部行为对象数组。小文件用。
 * 空文件 / 不存在返回 []。坏行(无法 parse)跳过并 console.warn。
 */
export async function readLines<T = unknown>(path: string): Promise<T[]> {
  return new Promise((resolve) => {
    const results: T[] = []
    const rl = createInterface({
      input: createReadStream(path, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        results.push(JSON.parse(line) as T)
      } catch (e) {
        console.warn(`[jsonl] skip bad line in ${path}:`, line.slice(0, 120))
      }
    })
    rl.on('close', () => resolve(results))
    rl.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') resolve([])
      else {
        console.warn(`[jsonl] read error on ${path}:`, e)
        resolve(results)
      }
    })
  })
}

/**
 * 流式读取。大文件用(观察事件可能上百 MB)。
 * 回调每行一次,不阻塞事件循环。
 */
export async function streamLines<T = unknown>(
  path: string,
  onLine: (obj: T) => void | Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(path, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    rl.on('line', async (line) => {
      if (!line.trim()) return
      try {
        await onLine(JSON.parse(line) as T)
      } catch (e) {
        console.warn(`[jsonl] skip bad line in ${path}:`, line.slice(0, 120))
      }
    })
    rl.on('close', () => resolve())
    rl.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') resolve()
      else reject(e)
    })
  })
}
