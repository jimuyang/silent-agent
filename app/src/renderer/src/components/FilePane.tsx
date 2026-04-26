// [renderer]
// File tab 内容视图。Monaco 编辑器在 renderer 渲染,内容通过 IPC 读/写 main。
// 改动状态(dirty)只在 renderer 内存;Cmd+S 触发 file.write 把内容落盘。
// 切到其他 tab 时组件卸载,编辑中的 dirty 内容会丢(MVP 行为,下版加提示)。

import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'

import type { TabMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

interface FilePaneProps {
  tab: TabMeta
}

export default function FilePane({ tab }: FilePaneProps) {
  // 5a 之后:file tab 的文件路径是 TabMeta.path 一等字段;老的 filePath 已废弃
  const filePath = tab.path
  const [content, setContent] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const originalRef = useRef<string>('')

  // 读文件
  useEffect(() => {
    let alive = true
    setContent(null)
    setError(null)
    setDirty(false)
    ipc.file
      .read(filePath)
      .then((text) => {
        if (!alive) return
        originalRef.current = text
        setContent(text)
      })
      .catch((e) => {
        if (!alive) return
        setError((e as Error).message)
      })
    return () => {
      alive = false
    }
  }, [filePath])

  // Cmd+S 保存
  async function save() {
    if (content === null) return
    try {
      await ipc.file.write(filePath, content)
      originalRef.current = content
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Monaco mount 后绑 Cmd+S
  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // 用 closure 里的 save 的最新版本
      saveRef.current?.()
    })
  }
  const saveRef = useRef<() => void>(() => {})
  useEffect(() => {
    saveRef.current = save
  })

  if (error) {
    return (
      <div className="pane file-pane">
        <div className="file-head">
          <span className="file-path">{filePath}</span>
        </div>
        <div className="pane-placeholder">
          <div className="big-icon">⚠️</div>
          <div className="title">读文件失败</div>
          <div className="desc">{error}</div>
        </div>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="pane file-pane">
        <div className="file-head">
          <span className="file-path">{filePath}</span>
        </div>
        <div className="pane-placeholder">
          <div className="desc">加载中…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="pane file-pane">
      <div className="file-head">
        <span className="file-path">
          {dirty && <span className="dirty-dot">●</span>} {filePath}
        </span>
        <span className="file-hint">Cmd+S 保存</span>
      </div>
      <div className="file-editor">
        <Editor
          height="100%"
          language={languageFromPath(filePath)}
          theme="vs-dark"
          value={content}
          onChange={(val) => {
            const next = val ?? ''
            setContent(next)
            setDirty(next !== originalRef.current)
          }}
          onMount={onMount}
          options={{
            fontFamily: '"SF Mono", ui-monospace, monospace',
            fontSize: 12.5,
            lineNumbers: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}

// Monaco 内置支持的常见语言 id,按扩展名映射
function languageFromPath(p: string): string {
  const ext = p.toLowerCase().split('.').pop() || ''
  switch (ext) {
    case 'ts': return 'typescript'
    case 'tsx': return 'typescript'
    case 'js': return 'javascript'
    case 'jsx': return 'javascript'
    case 'json': return 'json'
    case 'md': return 'markdown'
    case 'markdown': return 'markdown'
    case 'yml':
    case 'yaml': return 'yaml'
    case 'css': return 'css'
    case 'html': return 'html'
    case 'py': return 'python'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'sh':
    case 'bash': return 'shell'
    default: return 'plaintext'
  }
}
