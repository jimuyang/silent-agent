import { useEffect, useState } from 'react'
import type { AgentMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

export function useAgent(): { agent: AgentMeta | null; loading: boolean } {
  const [agent, setAgent] = useState<AgentMeta | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    ipc.agent
      .current()
      .then((a) => mounted && setAgent(a))
      .catch((e) => console.error('[useAgent]', e))
      .finally(() => mounted && setLoading(false))
    return () => {
      mounted = false
    }
  }, [])

  return { agent, loading }
}
