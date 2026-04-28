import { useState } from 'react'
import type { ReviewResult, TabMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

interface SilentChatProps {
  workspaceId: string
  /** 由 App 传入,共享同一个 useTabs instance(否则 tab bar 不刷新) */
  openTerminal: (cwd?: string, command?: { file: string; args: string[] }) => Promise<TabMeta>
}

// Silent Chat = 一种特殊 tab 的内容视图。全宽占用 pane,不再是右侧栏。
// MVP:Review 按钮 → spawn `claude -p` 跑 review,卡片显示建议;
// "在终端继续" → 开 terminal tab `claude --resume <session>` 续接同一会话。
export default function SilentChat({ workspaceId, openTerminal }: SilentChatProps) {
  const [draft, setDraft] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)

  async function runReview() {
    setReviewing(true)
    setResult(null)
    try {
      const r = await ipc.review.run(workspaceId)
      setResult(r)
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message })
    } finally {
      setReviewing(false)
    }
  }

  async function continueInTerminal() {
    console.log('[SilentChat] continueInTerminal click', { sessionId: result?.sessionId })
    if (!result?.sessionId) {
      console.warn('[SilentChat] no session id, cannot continue')
      return
    }
    try {
      const tab = await openTerminal(undefined, {
        file: 'claude',
        args: ['--resume', result.sessionId, '--permission-mode', 'acceptEdits'],
      })
      console.log('[SilentChat] terminal tab opened', tab)
    } catch (e) {
      console.error('[SilentChat] openTerminal failed', e)
      alert(`开终端失败:${(e as Error).message}`)
    }
  }

  return (
    <div className="pane silent-pane">
      <div className="silent-section">
        <div className="ss-head">
          🔔 Push
          <span className="rs-count">
            {reviewing ? '正在 review...' : result ? '有新建议' : '观察中...'}
          </span>
          <button
            className="review-btn"
            onClick={runReview}
            disabled={reviewing}
            title="让 Claude Code 看 events.jsonl + git log,找重复 pattern,建议可以自动化的事"
          >
            {reviewing ? '⏳' : '🔍'} Review
          </button>
        </div>

        <div className="push-list">
          {!result && !reviewing && (
            <div className="push-card observing">
              <span className="live-dot" style={{ display: 'inline-block', marginRight: 6 }} />
              正在记录当前工作区的浏览器 + 接口行为
              <div className="meta">.silent/events.jsonl · 点 Review 让 Claude Code 看一下</div>
            </div>
          )}

          {reviewing && (
            <div className="push-card observing">
              <span className="live-dot" style={{ display: 'inline-block', marginRight: 6 }} />
              Claude Code 正在 review 这个 workspace 的活动记录...
              <div className="meta">通常 5-30 秒</div>
            </div>
          )}

          {result && !result.ok && (
            <div className="push-card error">
              <strong>Review 失败</strong>
              <div className="meta">{result.error}</div>
            </div>
          )}

          {result && result.ok && (
            <div className="push-card review-result">
              <div className="review-suggestion">
                <pre>{result.suggestion}</pre>
              </div>
              <div className="review-meta">
                <span className="meta">
                  session: {result.sessionId?.slice(0, 8)} · {((result.durationMs ?? 0) / 1000).toFixed(1)}s
                </span>
                <button className="continue-btn" onClick={continueInTerminal}>
                  💬 在终端继续聊
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="silent-section flex">
        <div className="ss-head">
          💬 问答
          <span className="rs-count">#{workspaceId}</span>
        </div>

        <div className="chat">
          <div className="msg agent">
            <div className="msg-role">Agent</div>
            <div className="msg-body">
              MVP 阶段:这里的 chat 暂不接 Claude API。直接用上面的 <strong>Review</strong> 按钮 →
              点"在终端继续聊"开一个 terminal tab,在里面跟 Claude Code 对话。续接同一 session,
              可以直接让它沉淀 skill。
            </div>
          </div>
        </div>

        <div className="chat-input">
          <div className="chat-input-box">
            <textarea
              placeholder="(MVP 期暂未启用,用 Review → 在终端继续)"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled
            />
            <button className="send" disabled>↑</button>
          </div>
        </div>
      </div>
    </div>
  )
}
