import React, { useState, useEffect, useCallback } from "react"
import { MemoryTimeline } from "./MemoryTimeline"
import { MemoryStatus } from "./MemoryStatus"
import { StaleMemoryWarnings } from "./StaleMemoryWarnings"
import { api, type MemoryEventRow } from "../../lib/api"

interface Props {
  sessionId: string
  ws: { on: (type: string, handler: (msg: any) => void) => () => void }
}

export function MemoryTab({ sessionId, ws }: Props) {
  const [events, setEvents] = useState<MemoryEventRow[]>([])

  const load = useCallback(async () => {
    const data = await api.memoryEvents(sessionId)
    setEvents(data)
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const unsub = ws.on("memory_event", (msg: any) => {
      if (msg.sessionId === sessionId) load()
    })
    return unsub
  }, [ws, sessionId, load])

  const loaded = events.filter((e) => e.event_type === "loaded")
  const stale = loaded.filter((e) => (e.age_days ?? 0) > 7)

  return (
    <div className="p-6 space-y-6">
      <MemoryStatus events={events} />
      <MemoryTimeline events={events} />
      {stale.length > 0 && <StaleMemoryWarnings memories={stale} />}
    </div>
  )
}
