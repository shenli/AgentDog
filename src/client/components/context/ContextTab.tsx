import React, { useState, useEffect, useCallback } from "react"
import { ContextChart } from "./ContextChart"
import { CompactionLog } from "./CompactionLog"
import { ContextWarning } from "./ContextWarning"
import { CacheEfficiencyChart } from "./CacheEfficiencyChart"
import {
  api,
  AGENT_FEATURES,
  type AgentType,
  type Session,
  type ContextSnapshotRow,
  type CompactionEventRow,
  type TurnRow,
} from "../../lib/api"

interface Props {
  sessionId: string
  session: Session
  ws: { on: (type: string, handler: (msg: any) => void) => () => void }
}

export function ContextTab({ sessionId, session, ws }: Props) {
  const [snapshots, setSnapshots] = useState<ContextSnapshotRow[]>([])
  const [compactions, setCompactions] = useState<CompactionEventRow[]>([])
  const [turns, setTurns] = useState<TurnRow[]>([])
  const [contextWindow, setContextWindow] = useState(200_000)

  const features = AGENT_FEATURES[session.agent_type as AgentType]
  const hasContext = features?.has("context")
  const hasCacheTokens = features?.has("cache_tokens")

  const load = useCallback(async () => {
    const [ctx, comp, t, cw] = await Promise.all([
      api.context(sessionId),
      api.compactions(sessionId),
      api.turns(sessionId),
      api.contextWindow(sessionId),
    ])
    setSnapshots(ctx)
    setCompactions(comp)
    setTurns(t)
    setContextWindow(cw)
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const unsub1 = ws.on("context_snapshot", (msg: any) => {
      if (msg.session_id === sessionId || msg.sessionId === sessionId) load()
    })
    const unsub2 = ws.on("turn", (msg: any) => {
      if (msg.session_id === sessionId || msg.sessionId === sessionId) load()
    })
    return () => { unsub1(); unsub2() }
  }, [ws, sessionId, load])

  // Get latest context usage from most recent turn
  const latestTurn = turns[turns.length - 1]
  const contextUsed = latestTurn?.context_tokens_used ?? 0
  const utilization = contextUsed / contextWindow

  return (
    <div className="p-6 space-y-6">
      {/* Context warning — works for all agents that have turn data */}
      {turns.length > 0 && (
        <ContextWarning
          utilization={utilization}
          contextUsed={contextUsed}
          contextWindow={contextWindow}
          turns={turns}
        />
      )}

      {/* Current context breakdown */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Current Context Utilization
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-4 bg-zinc-800 rounded-full overflow-hidden flex">
              <div
                className={`h-full transition-all ${
                  utilization > 0.85
                    ? "bg-red-500"
                    : utilization > 0.7
                      ? "bg-yellow-500"
                      : "bg-blue-500"
                }`}
                style={{ width: `${Math.min(utilization * 100, 100)}%` }}
              />
            </div>
          </div>
          <span className="text-sm font-medium tabular-nums">
            {(utilization * 100).toFixed(1)}%
          </span>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {contextUsed.toLocaleString()} / {contextWindow.toLocaleString()} tokens
        </div>
      </div>

      {/* Context composition over time */}
      <ContextChart snapshots={snapshots} turns={turns} compactions={compactions} contextWindow={contextWindow} />

      {/* Cache efficiency chart — for agents with cache tokens */}
      {hasCacheTokens && turns.length > 0 && (
        <CacheEfficiencyChart turns={turns} />
      )}

      {compactions.length > 0 && <CompactionLog compactions={compactions} />}

      {/* Feature-gated message for agents without full context support */}
      {!hasContext && turns.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
          <p>Detailed context breakdown is not available for this agent type.</p>
          <p className="text-xs mt-2">Basic context tracking from token counts is shown above when turns are available.</p>
        </div>
      )}
    </div>
  )
}
