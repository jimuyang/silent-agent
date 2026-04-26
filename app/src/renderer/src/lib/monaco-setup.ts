// [renderer]
// Monaco 初始化。默认 @monaco-editor/react 从 CDN jsdelivr 拉 loader.js,
// 但我们 Electron 的 CSP(script-src 'self')不允许外部脚本 → 一直 loading。
// 解法:把 monaco-editor 作为 npm 依赖本地 bundle,再 loader.config 指向本地 module,
// 同时用 Vite 原生的 ?worker import 把各 language worker 打成本地 URL。

import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

// Vite `?worker` 后缀:把文件作为 Web Worker 打包,import 得到的是 Worker constructor
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Monaco 通过 self.MonacoEnvironment.getWorker 找 worker;按 label 分发
;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

// 告诉 @monaco-editor/react 别去 CDN 拉,直接用我们 import 的这份
loader.config({ monaco })

// 顺便预热:return 后 loader.init() promise 变 resolved,组件里 <Editor /> 立即可用
export const monacoReady = loader.init()
