// [main · 纯业务,不 import 'electron']
//
// zsh shell integration:给 TerminalTabRuntime 用,通过 ZDOTDIR 注入一个 .zshrc,
// 在 preexec / precmd hook 里 emit OSC 133 / 633 标记(VSCode / iTerm / Warp 同款约定),
// 主进程从 pty stdout 解析这些标记切命令边界(见 snapshots/terminal.ts)。
//
// xterm.js 默认忽略未识别 OSC,渲染端无副作用。
//
// **不动用户的 `~/.zshrc`** —— ZDOTDIR 让 zsh 把工作目录的 .zshrc 加载顺序整体改到这边,
// 我们的 .zshrc 第一行 source 用户原 ~/.zshrc 保留所有用户自定义,然后在 hook 数组
// `preexec_functions` / `precmd_functions` 上追加 silent_agent 的 hook。

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT } from '../storage/paths'

/**
 * silent_agent 注入的 .zshrc 内容。每次 ensureZshIntegration() 都覆盖写,
 * 用户/agent 升级后能拿到最新的 hook 行为(幂等)。
 *
 * OSC 序列说明(VSCode shell integration spec 同):
 *   - `OSC 633;E;<cmd> BEL`  命令字面串(预先发,先于 C)
 *   - `OSC 133;C BEL`        命令开始(preexec 调时)
 *   - `OSC 133;D;<exit> BEL` 命令结束(precmd 调时;首次进入 prompt 也会触发,主进程侧 idle 状态会忽略)
 *
 * cmdline 里的 ESC / BEL 字符替换成 `?` 防止破坏 OSC 边界;cmd 截断 200 字符。
 */
const ZSHRC_CONTENT = `# Silent Agent zsh integration (auto-generated, do not edit by hand)
# 加载用户原 zshrc(若存在),再追加 silent_agent 的 OSC 133/633 hook

if [[ -f "\${HOME}/.zshrc" ]]; then
  source "\${HOME}/.zshrc"
fi

__silent_agent_preexec() {
  if [[ -z "\${1}" ]]; then
    return
  fi
  local sanitized="\${1//$'\\007'/?}"
  sanitized="\${sanitized//$'\\033'/?}"
  sanitized="\${sanitized:0:200}"
  printf '\\033]633;E;%s\\007' "\${sanitized}"
  printf '\\033]133;C\\007'
}

__silent_agent_precmd() {
  local exit_code=$?
  printf '\\033]133;D;%d\\007' "\${exit_code}"
}

typeset -ga preexec_functions
typeset -ga precmd_functions
preexec_functions+=(__silent_agent_preexec)
precmd_functions+=(__silent_agent_precmd)
`

const INTEGRATION_DIR = join(ROOT, 'shell-integration')

let initialized = false

/**
 * 写入(或刷新)`~/.silent-agent/shell-integration/.zshrc`,返回该目录绝对路径。
 * 调用方把返回值塞进 pty.spawn 的 `env.ZDOTDIR` 里即可启用 integration。
 *
 * 每次调用都覆盖写文件(开销极小),保证 hook 行为跟 silent_agent 版本同步。
 * 内部 cache initialized 防止单次进程内重复 IO。
 */
export function ensureZshIntegration(): string {
  if (!initialized) {
    mkdirSync(INTEGRATION_DIR, { recursive: true })
    writeFileSync(join(INTEGRATION_DIR, '.zshrc'), ZSHRC_CONTENT, 'utf8')
    initialized = true
  }
  return INTEGRATION_DIR
}
