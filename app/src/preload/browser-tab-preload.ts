/// <reference lib="DOM" />
//
// [preload · 注入到 BrowserTabRuntime 的每个 WebContentsView]
//
// 这个 preload 只做一件事:监听 page 内 click,把 (tag/role/accName/selector/host/modifiers)
// 通过 ipcRenderer.send 发回主进程。**不**用 contextBridge 暴露任何东西到 page world ——
// 这是用户访问的第三方网页(baidu / logservice / 任意),我们只观察、不双向通信。
//
// contextIsolation: true 时 preload 跑在 isolated world,有 DOM 访问权限 + ipcRenderer,
// 但跟 page JS 完全隔离,不会污染 window。
//
// 配套主进程接收:`webContents.ipc.on('silent:click', ...)` (Electron 28+ per-WC IPC)
// 在 BrowserTabRuntime 构造时绑;天然带 tabId 上下文(因为绑在那个 runtime 的 webContents)。
//
// triple-slash reference 让 tsc 给本文件加 DOM types(tsconfig.node.json 默认不带 DOM)。

import { ipcRenderer } from 'electron'

const NAME_MAX_CHARS = 50
const CHANNEL = 'silent:click'

/** 相关 tag(可点击 / 可输入)集合 — 用于 findActionable 优先级 */
const ACTIONABLE_TAGS = new Set([
  'BUTTON',
  'A',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'SUMMARY',
])

document.addEventListener(
  'click',
  (e) => {
    const rawTarget = e.target as HTMLElement | null
    if (!rawTarget) return

    // click 实际打在子元素时(如 <button><span>X</span></button>),向上找最近的可交互祖先
    const target = findActionableAncestor(rawTarget)

    const payload = {
      tag: target.tagName,
      role: computeRole(target),
      name: computeName(target),
      selector: computeSelector(target),
      host: location.host,
      modifiers: collectModifiers(e),
    }
    try {
      ipcRenderer.send(CHANNEL, payload)
    } catch {
      // ipcRenderer 偶尔在 page 卸载窗口时不可用,silent
    }
  },
  true, // capture phase:即使 page 自己 stopPropagation 我们也能拿到
)

// ---------- helpers ----------

function findActionableAncestor(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el
  let depth = 0
  while (cur && depth < 8) {
    if (
      ACTIONABLE_TAGS.has(cur.tagName) ||
      cur.hasAttribute('role') ||
      cur.hasAttribute('onclick') ||
      cur.tabIndex >= 0
    ) {
      return cur
    }
    cur = cur.parentElement
    depth++
  }
  return el
}

function computeRole(el: HTMLElement): string {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  switch (el.tagName) {
    case 'BUTTON':
      return 'button'
    case 'A':
      return el.hasAttribute('href') ? 'link' : 'generic'
    case 'INPUT': {
      const type = (el as HTMLInputElement).type
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      return 'textbox'
    }
    case 'SELECT':
      return 'combobox'
    case 'TEXTAREA':
      return 'textbox'
    case 'LABEL':
      return 'label'
    case 'SUMMARY':
      return 'disclosure'
    default:
      return 'generic'
  }
}

/** accessible name 优先序:aria-label → alt → innerText → title;截 50 字符 */
function computeName(el: HTMLElement): string {
  const candidates = [
    el.getAttribute('aria-label'),
    (el as HTMLImageElement).alt,
    (el as HTMLInputElement).value && (el as HTMLInputElement).type === 'submit'
      ? (el as HTMLInputElement).value
      : '',
    (el.innerText || '').replace(/\s+/g, ' ').trim(),
    el.getAttribute('title'),
  ]
  for (const c of candidates) {
    if (c && c.trim()) return c.trim().slice(0, NAME_MAX_CHARS)
  }
  return ''
}

/** best-effort selector:id > tag.最多两个 class > tag */
function computeSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`
  const tag = el.tagName.toLowerCase()
  const cls = (el.className || '')
    .toString()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join('.')
  return cls ? `${tag}.${cls}` : tag
}

function collectModifiers(e: MouseEvent): string[] {
  const m: string[] = []
  if (e.shiftKey) m.push('shift')
  if (e.ctrlKey) m.push('ctrl')
  if (e.altKey) m.push('alt')
  if (e.metaKey) m.push('meta')
  return m
}
