// [main · 桥接层 · 不直接 import 'electron']
// Review runner:在一个 workspace 目录里跑 `claude -p`,让 CC 自己读 .silent/runtime/events.jsonl
// + 跑 git log,找 pattern 出建议。
// 每次 review 都是**独立系统调用**(用完即弃),不持久化 session id;
// "发给主 agent 继续聊"是把 review 的 markdown 文本 inject 进主 agent 的 chat session,
// 跟 review 的 CC session 没关系。

import { spawn } from 'node:child_process'

import type { ReviewResult } from '@shared/types'

const REVIEW_PROMPT = `你正在 review 一个 Silent Agent workspace 的活动记录。

工作区目录布局(参考 design/02-architecture.md 二分约定):
- .silent/                       ← workspace 真状态(进 git):meta.yaml / tabs/<tid>/latest.md / latest-cmd.log
- .silent/runtime/               ← 运行时 logs / cache(.gitignore 整目录)
- .silent/runtime/events.jsonl   ← workspace 时序日志(2 层 Layer 1,append-only)
- .silent/runtime/main_chat.jsonl    ← main_chat agent 对话流(可能为空)
- .silent/runtime/main_review.jsonl  ← 之前 review 的对话流(可能为空)
- .silent/runtime/tabs/<tid>/snapshots/  ← 浏览器/终端 NNN 切片(.md / .log)
- .silent/tabs/<tid>/latest.md       ← browser tab 当前页面(可看)
- .silent/tabs/<tid>/latest-cmd.log  ← terminal tab 最近命令输出

可用工具:
- Read:读上面任意文件
- Bash:跑 \`git log --oneline -30\` / \`git diff HEAD~10 HEAD\`(如果是 git repo)/ \`ls -la .silent/\` / \`ls -la .silent/runtime/\` 等

任务:
1. 先 \`ls -la .silent/runtime/\` 看一下有啥文件
2. Read .silent/runtime/events.jsonl 看最近活动(events 是 2 层结构 — 短 summary + 可选 detailPath/messageId 引用)
3. 视情况 Read .silent/tabs/<tid>/latest.md 看用户最近在看的页面,Read .silent/tabs/<tid>/latest-cmd.log 看最近终端输出
4. 找重复 pattern(同样命令跑过 3+ 次 / 同站点访问 / 类似查询步骤)
5. 输出 1-3 条"教教我"建议(skill 候选)

输出格式(纯 markdown,简洁):
- 每条建议:**标题**(< 30 字)+ 一句描述 + 为什么值得自动化 + 如果做成 skill 大概几步
- 没发现明显 pattern 就直接说"暂时没发现明显的重复 pattern,继续观察"
- 不要废话,不要叙述你自己干了啥

保守一点 —— 只推真的看到重复发生的事。`

interface CCResult {
  type: string                       // 'result'
  subtype?: string                   // 'success' / 'error_during_execution' / ...
  result?: string                    // assistant 最终输出
  session_id?: string
  is_error?: boolean
  duration_ms?: number
  total_cost_usd?: number
  // 其他字段忽略
}

export interface RunReviewOpts {
  workspacePath: string
}

export async function runReview(opts: RunReviewOpts): Promise<ReviewResult> {
  const startedAt = Date.now()
  // 每次 review 都是 fresh session(系统调用,用完即弃);CC 内部会创建新 session
  // 文件,我们不读不写不 resume。
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',  // review 只读探索,但允许 Read/Bash 不被打断
    '--allowed-tools', 'Read,Bash(git*),Bash(ls*),Bash(cat*),Bash(head*),Bash(tail*),Bash(wc*)',
  ]

  return new Promise((resolve) => {
    const cc = spawn('claude', args, {
      cwd: opts.workspacePath,
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    cc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    cc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    // prompt 通过 stdin 喂(避免 shell escape 问题)
    cc.stdin.end(REVIEW_PROMPT)

    cc.on('error', (e) => {
      resolve({
        ok: false,
        error: `spawn claude failed: ${e.message}`,
        durationMs: Date.now() - startedAt,
      })
    })

    cc.on('exit', async (code) => {
      const durationMs = Date.now() - startedAt
      if (code !== 0) {
        resolve({
          ok: false,
          error: `claude exited ${code}: ${stderr.slice(0, 500)}`,
          durationMs,
        })
        return
      }

      let parsed: CCResult
      try {
        parsed = JSON.parse(stdout)
      } catch {
        resolve({
          ok: false,
          error: `parse claude json output failed: ${stdout.slice(0, 500)}`,
          durationMs,
        })
        return
      }

      if (parsed.is_error) {
        resolve({
          ok: false,
          error: `claude returned error: ${parsed.subtype}`,
          sessionId: parsed.session_id,
          durationMs,
        })
        return
      }

      resolve({
        ok: true,
        sessionId: parsed.session_id,        // 仅返回供前端展示,不持久化
        suggestion: parsed.result?.trim() ?? '',
        durationMs,
      })
    })
  })
}
