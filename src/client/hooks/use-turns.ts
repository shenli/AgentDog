import { useState, useEffect, useCallback } from "react"
import { api, type TurnRow } from "../lib/api"

export function useTurns(sessionId: string | null) {
  const [turns, setTurns] = useState<TurnRow[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setTurns([])
      return
    }
    setLoading(true)
    try {
      const data = await api.turns(sessionId)
      setTurns(data)
    } catch (err) {
      console.error("Failed to fetch turns:", err)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { turns, loading, refresh }
}
