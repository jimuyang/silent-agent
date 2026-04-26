import { useCallback, useEffect, useState } from 'react'
import type { CreateSessionArgs, SessionMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

export interface UseSessionsResult {
  sessions: SessionMeta[]
  loading: boolean
  reload: () => Promise<void>
  create: (args: CreateSessionArgs) => Promise<SessionMeta>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await ipc.session.list()
      setSessions(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(
    async (args: CreateSessionArgs) => {
      const s = await ipc.session.create(args)
      await reload()
      return s
    },
    [reload],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      await ipc.session.rename(id, name)
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      await ipc.session.delete(id)
      await reload()
    },
    [reload],
  )

  return { sessions, loading, reload, create, rename, remove }
}
