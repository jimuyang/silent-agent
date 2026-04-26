import { useState } from 'react'

interface SilentChatProps {
  sessionId: string
}

// Silent Chat = 一种特殊 tab 的内容视图。全宽占用 pane,不再是右侧栏。
export default function SilentChat({ sessionId }: SilentChatProps) {
  const [draft, setDraft] = useState('')

  return (
    <div className="pane silent-pane">
      <div className="silent-section">
        <div className="ss-head">
          🔔 Push
          <span className="rs-count">观察中...</span>
        </div>
        <div className="push-list">
          <div className="push-card observing">
            <span className="live-dot" style={{ display: 'inline-block', marginRight: 6 }} />
            正在记录当前会话的浏览器 + 接口行为
            <div className="meta">context/browser.jsonl · 0 事件 · just now</div>
          </div>
        </div>
      </div>

      <div className="silent-section flex">
        <div className="ss-head">
          💬 问答
          <span className="rs-count">#{sessionId}</span>
        </div>

        <div className="chat">
          <div className="msg agent">
            <div className="msg-role">Agent</div>
            <div className="msg-body">
              Silent Agent v0.1 · 当前 session 的 Silent Chat tab。切到 🌐 浏览器 tab 可以看网页;
              切回来继续聊。Phase 6 才接 Claude API,这里目前只显示欢迎消息。
            </div>
          </div>
        </div>

        <div className="chat-input">
          <div className="chat-input-box">
            <textarea
              placeholder="说点什么 (Phase 6 启用)"
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
