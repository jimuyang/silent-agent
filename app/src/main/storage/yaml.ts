// [main · 纯业务, 不 import 'electron']
// YAML 读写 + 原子替换。meta.yaml / config.yaml 这类整文件写用这个。
// "原子"做法:先写 .tmp 再 rename。rename 在 POSIX 上原子,断电/崩溃看到的要么是旧内容要么是新内容,不会半截。

import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse, stringify } from 'yaml'

export async function readYaml<T = unknown>(path: string, fallback?: T): Promise<T> {
  try {
    const text = await readFile(path, 'utf8')
    return parse(text) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) {
      return fallback
    }
    throw e
  }
}

/**
 * 原子写。崩溃安全。
 */
export async function writeYamlAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  const yaml = stringify(data, {
    indent: 2,
    lineWidth: 120,
  })
  try {
    await writeFile(tmp, yaml, 'utf8')
    await rename(tmp, path)
  } catch (e) {
    // rename 失败时清理 tmp
    await unlink(tmp).catch(() => {})
    throw e
  }
}

/**
 * JSON 原子写(_index.json / app-state.json 用)。
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  const json = JSON.stringify(data, null, 2)
  try {
    await writeFile(tmp, json, 'utf8')
    await rename(tmp, path)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

export async function readJson<T = unknown>(path: string, fallback?: T): Promise<T> {
  try {
    const text = await readFile(path, 'utf8')
    return JSON.parse(text) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) {
      return fallback
    }
    throw e
  }
}
