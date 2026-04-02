import React from "react"
import type { TurnRow } from "../../lib/api"
import { formatTokens } from "../../lib/format"

interface Props {
  utilization: number
  contextUsed: number
  contextWindow: number
  turns: TurnRow[]
}

export function ContextWarning({ utilization, contextUsed, contextWindow, turns }: Props) {
  if (utilization < 0.7) return null

  // Calculate dynamic overflow prediction from recent turns
  const prediction = predictOverflow(turns, contextWindow)

  const isUrgent = utilization >= 0.9
  const isDanger = utilization >= 0.8

  return (
    <div
      className={`rounded-lg p-4 border ${
        isUrgent
          ? "bg-red-500/10 border-red-500/30 text-red-400"
          : isDanger
            ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
            : "bg-blue-500/10 border-blue-500/30 text-blue-400"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">
          {isUrgent ? "!!" : isDanger ? "!" : "i"}
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium">
            Context is {(utilization * 100).toFixed(0)}% full
          </p>
          <p className="text-xs opacity-80 mt-0.5">
            {formatTokens(contextUsed)} / {formatTokens(contextWindow)} tokens used.
            {prediction.turnsRemaining != null && prediction.turnsRemaining > 0 && (
              <> Estimated {isUrgent ? "overflow" : "compaction"} in ~{prediction.turnsRemaining} turns</>
            )}
            {prediction.turnsRemaining != null && prediction.turnsRemaining <= 0 && (
              <> Compaction imminent</>
            )}
            {prediction.minutesRemaining != null && prediction.minutesRemaining > 0 && (
              <> (~{prediction.minutesRemaining}min at current rate)</>
            )}
          </p>
        </div>
        {prediction.tokensPerTurn > 0 && (
          <div className="text-right text-xs opacity-70">
            <div>{formatTokens(prediction.tokensPerTurn)}/turn</div>
          </div>
        )}
      </div>
    </div>
  )
}

function predictOverflow(
  turns: TurnRow[],
  contextWindow: number
): { turnsRemaining: number | null; minutesRemaining: number | null; tokensPerTurn: number } {
  if (turns.length < 2) return { turnsRemaining: null, minutesRemaining: null, tokensPerTurn: 0 }

  // Use last 10 turns for rate estimation
  const recent = turns.slice(-10)
  if (recent.length < 2) return { turnsRemaining: null, minutesRemaining: null, tokensPerTurn: 0 }

  const latestContext = recent[recent.length - 1].context_tokens_used
  const earliestContext = recent[0].context_tokens_used
  const contextGrowth = latestContext - earliestContext
  const turnCount = recent.length - 1

  if (contextGrowth <= 0 || turnCount <= 0) {
    return { turnsRemaining: null, minutesRemaining: null, tokensPerTurn: 0 }
  }

  const tokensPerTurn = Math.round(contextGrowth / turnCount)
  const tokensRemaining = contextWindow - latestContext
  const turnsRemaining = Math.max(Math.round(tokensRemaining / tokensPerTurn), 0)

  // Time-based prediction
  const timeSpanMs = recent[recent.length - 1].timestamp - recent[0].timestamp
  let minutesRemaining: number | null = null
  if (timeSpanMs > 0) {
    const msPerTurn = timeSpanMs / turnCount
    minutesRemaining = Math.round((turnsRemaining * msPerTurn) / 60000)
  }

  return { turnsRemaining, minutesRemaining, tokensPerTurn }
}
