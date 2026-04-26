import { useCallback, useEffect, useState } from 'react'
import type { CreateWorkspaceArgs, WorkspaceMeta } from '@shared/types'
import { ipc } from '../lib/ipc'

export interface UseWorkspacesResult {
  workspaces: WorkspaceMeta[]
  loading: boolean
  reload: () => Promise<void>
  create: (args: CreateWorkspaceArgs) => Promise<WorkspaceMeta>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useWorkspaces(): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await ipc.workspace.list()
      setWorkspaces(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(
    async (args: CreateWorkspaceArgs) => {
      const w = await ipc.workspace.create(args)
      await reload()
      return w
    },
    [reload],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      await ipc.workspace.rename(id, name)
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      await ipc.workspace.delete(id)
      await reload()
    },
    [reload],
  )

  return { workspaces, loading, reload, create, rename, remove }
}
