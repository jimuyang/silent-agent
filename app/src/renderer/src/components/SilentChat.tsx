import { useState } from 'react'
import type { ReviewResult } from '@shared/types'
import { ipc } from '../lib/ipc'
import ChatTerminal from './ChatTerminal'

interface SilentChatProps {
  workspaceId: string
}

// SilentChat panel:
// - 上半 🔔 Push:[Review] 按钮 + 建议卡片
// - 下半 💬 问答:嵌入式 ChatTerminal(每个 workspace 一个长驻 `claude --continue`)
//
// review 完成后点"在主 agent 中继续" → 把建议文本 inject 进 ChatTerminal 的 pty,
// CC 把它当一条 user message 处理。
export default function SilentChat({ workspaceId }: SilentChatProps) {
  const [reviewing, setReviewing] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [injected, setInjected] = useState(false)

  async function runReview() {
    setReviewing(true)
    setResult(null)
    setInjected(false)
    try {
      const r = await ipc.review.run(workspaceId)
      setResult(r)
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message })
    } finally {
      setReviewing(false)
    }
  }

  async function injectIntoChat() {
    if (!result?.ok || !result.suggestion) return
    const payload =
      `[Review 给的建议]\n${result.suggestion}\n\n` +
      `请帮我把这个 pattern 沉淀成 skill,跟我对话确认细节(背景 / 步骤 / 成功标准)。`
    try {
      await ipc.chat.inject(workspaceId, payload)
      setInjected(true)
    } catch (e) {
      console.error('[SilentChat] inject failed', e)
      alert(`inject 失败:${(e as Error).message}`)
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
            title="让 Claude Code 看 events.jsonl + git log,找重复 pattern"
          >
            {reviewing ? '⏳' : '🔍'} Review
          </button>
        </div>

        <div className="push-list">
          {!result && !reviewing && (
            <div className="push-card observing">
              <span className="live-dot" style={{ display: 'inline-block', marginRight: 6 }} />
              下方就是该 workspace 的主 agent(Claude Code),直接问;或点 Review 让它自己看一下
              <div className="meta">.silent/events.jsonl · 主 agent: claude --continue</div>
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
                  session: {result.sessionId?.slice(0, 8)} ·{' '}
                  {((result.durationMs ?? 0) / 1000).toFixed(1)}s
                  {injected && <span className="injected-mark"> · 已喂给主 agent ✓</span>}
                </span>
                <button
                  className="continue-btn"
                  onClick={injectIntoChat}
                  disabled={injected}
                  title="把这段建议作为一条消息发给下方主 agent,跟它对话沉淀 skill"
                >
                  {injected ? '✓ 已发送' : '💬 发给主 agent 继续聊'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="silent-section flex chat-section">
        <div className="ss-head">
          💬 问答(主 agent · Claude Code)
          <span className="rs-count">#{workspaceId}</span>
        </div>
        <ChatTerminal workspaceId={workspaceId} />
      </div>
    </div>
  )
}
