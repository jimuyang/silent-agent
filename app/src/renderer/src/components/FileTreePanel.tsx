import { useEffect, useState, useCallback } from 'react'
import { ipc } from '../lib/ipc'

interface FileTreePanelProps {
  /** 绝对路径,作为文件树根。通常是 activeWorkspace.path */
  rootPath: string
  /** 当前激活的文件 tab(用于高亮) */
  activeFilePath?: string | null
  /** 点击文件时回调,父组件负责打开为 file tab */
  onOpenFile: (absPath: string) => void
}

interface TreeEntry {
  name: string
  isDir: boolean
}

/**
 * 工作区文件树(pin 在左,介于 LeftNav 和中间 work area 之间)。
 * - 懒加载:首次 mount 时读 rootPath 的直接子项,目录点击才继续加载其子项
 * - 默认隐藏 .silent / .git 等内部目录
 * - 只用 icon 表示 folder 开/闭 / 文件类型,无 chevron 列
 */
export default function FileTreePanel({
  rootPath,
  activeFilePath,
  onOpenFile,
}: FileTreePanelProps) {
  return (
    <aside className="file-tree-panel">
      <div className="ft-head">
        <span>📁 工作区文件</span>
      </div>
      <div className="ft-head-path" title={rootPath}>
        {abbrevPath(rootPath)}
      </div>
      <div className="ft-body">
        <TreeChildren
          parentAbs={rootPath}
          relPath=""
          depth={0}
          activeFilePath={activeFilePath ?? null}
          onOpenFile={onOpenFile}
        />
      </div>
    </aside>
  )
}

/** 递归渲染某目录下的子项(一层)。每层自己懒加载 */
function TreeChildren({
  parentAbs,
  relPath,
  depth,
  activeFilePath,
  onOpenFile,
}: {
  parentAbs: string
  relPath: string
  depth: number
  activeFilePath: string | null
  onOpenFile: (abs: string) => void
}) {
  const [entries, setEntries] = useState<TreeEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const absOf = useCallback((name: string) => joinPath(parentAbs, name), [parentAbs])

  useEffect(() => {
    let alive = true
    ipc.file
      .listDir(parentAbs)
      .then((list) => {
        if (!alive) return
        setEntries(filterAndSort(list))
      })
      .catch((e) => {
        if (!alive) return
        setError((e as Error).message)
      })
    return () => {
      alive = false
    }
  }, [parentAbs])

  if (error) {
    return <div className="tree-error">读目录失败: {error}</div>
  }
  if (!entries) {
    return <div className="tree-loading">…</div>
  }
  return (
    <>
      {entries.map((e) =>
        e.isDir ? (
          <FolderNode
            key={e.name}
            abs={absOf(e.name)}
            relPath={relPath ? `${relPath}/${e.name}` : e.name}
            name={e.name}
            depth={depth}
            activeFilePath={activeFilePath}
            onOpenFile={onOpenFile}
          />
        ) : (
          <FileNode
            key={e.name}
            abs={absOf(e.name)}
            name={e.name}
            depth={depth}
            activeFilePath={activeFilePath}
            onOpenFile={onOpenFile}
          />
        ),
      )}
    </>
  )
}

function FolderNode({
  abs,
  relPath,
  name,
  depth,
  activeFilePath,
  onOpenFile,
}: {
  abs: string
  relPath: string
  name: string
  depth: number
  activeFilePath: string | null
  onOpenFile: (abs: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div
        className={`tree-node folder ${open ? 'open' : ''}`}
        style={{ paddingLeft: 6 + depth * 10 }}
        onClick={() => setOpen((x) => !x)}
        title={name}
      >
        <span className="icon">{open ? '📂' : '📁'}</span>
        <span className="nm">{name}</span>
      </div>
      {open && (
        <TreeChildren
          parentAbs={abs}
          relPath={relPath}
          depth={depth + 1}
          activeFilePath={activeFilePath}
          onOpenFile={onOpenFile}
        />
      )}
    </>
  )
}

function FileNode({
  abs,
  name,
  depth,
  activeFilePath,
  onOpenFile,
}: {
  abs: string
  name: string
  depth: number
  activeFilePath: string | null
  onOpenFile: (abs: string) => void
}) {
  const isActive = activeFilePath === abs
  return (
    <div
      className={`tree-node file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: 6 + depth * 10 }}
      onClick={() => onOpenFile(abs)}
      title={name}
    >
      <span className="icon">{fileIcon(name)}</span>
      <span className="nm">{name}</span>
    </div>
  )
}

// ---------- helpers ----------

const HIDDEN_PATTERNS = ['.silent', '.git', '.DS_Store', 'node_modules', '.next', '.venv']

function filterAndSort(list: TreeEntry[]): TreeEntry[] {
  const visible = list.filter((e) => !HIDDEN_PATTERNS.includes(e.name))
  visible.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return visible
}

function fileIcon(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  switch (ext) {
    case 'md':
    case 'markdown':
      return '📄'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return '🖼'
    case 'csv':
    case 'tsv':
    case 'xlsx':
      return '📊'
    case 'json':
    case 'yaml':
    case 'yml':
      return '⚙️'
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'go':
    case 'py':
    case 'rs':
      return '📄'
    case 'sh':
    case 'bash':
    case 'zsh':
      return '📜'
    default:
      return '📄'
  }
}

function joinPath(parent: string, child: string): string {
  return parent.endsWith('/') ? parent + child : `${parent}/${child}`
}

/** 把 $HOME 开头压成 ~ */
function abbrevPath(p: string): string {
  const home = '/Users/bytedance' // MVP 简版,v0.2 可通过 IPC 拿 $HOME
  if (p.startsWith(home)) return '~' + p.slice(home.length)
  return p
}
