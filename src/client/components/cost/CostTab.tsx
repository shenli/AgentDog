import React, { useState, useEffect, useCallback } from "react"
import { CostSummaryCards } from "./CostSummaryCards"
import { CostChart } from "./CostChart"
import { CostOverview } from "./CostOverview"
import { TokenComposition } from "./TokenComposition"
import { AnomalyLog } from "./AnomalyLog"
import { ToolCostRanking } from "./ToolCostRanking"
import { api, type Session, type TurnRow, type ToolCallRow, type AnomalyRow } from "../../lib/api"
import { computeSessionWarnings } from "../../lib/warnings"
import { SessionWarningsList } from "../WarningsBanner"

interface Props {
  sessionId: string
  session: Session
  ws: { on: (type: string, handler: (msg: any) => void) => () => void }
  isMax: boolean
}

export function CostTab({ sessionId, session, ws, isMax }: Props) {
  const [turns, setTurns] = useState<TurnRow[]>([])
  const [tools, setTools] = useState<ToolCallRow[]>([])
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([])

  const load = useCallback(async () => {
    const [t, tl, a] = await Promise.all([
      api.turns(sessionId),
      api.tools(sessionId),
      api.anomalies(sessionId),
    ])
    setTurns(t)
    setTools(tl)
    setAnomalies(a)
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  // Refresh on new turns
  useEffect(() => {
    const unsub = ws.on("turn", (msg: any) => {
      if (msg.sessionId === sessionId) load()
    })
    return unsub
  }, [ws, sessionId, load])

  const sessionWarnings = computeSessionWarnings(session, turns)

  return (
    <div className="p-6 space-y-6">
      {sessionWarnings.length > 0 && <SessionWarningsList warnings={sessionWarnings} />}
      <CostSummaryCards session={session} turns={turns} isMax={isMax} />
      <CostChart turns={turns} isMax={isMax} />
      {turns.length > 2 && tools.length > 0 && (
        <TokenComposition turns={turns} tools={tools} />
      )}
      <CostOverview />
      {anomalies.length > 0 && <AnomalyLog anomalies={anomalies} />}
      {tools.length > 0 && (
        <ToolCostRanking tools={tools} turns={turns} session={session} />
      )}
    </div>
  )
}
