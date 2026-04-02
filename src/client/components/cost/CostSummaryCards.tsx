import React from "react"
import type { Session, TurnRow } from "../../lib/api"
import { formatCost, formatTokens, formatPercent } from "../../lib/format"

interface Props {
  session: Session
  turns: TurnRow[]
  isMax: boolean
}

export function CostSummaryCards({ session, turns, isMax }: Props) {
  const totalTokens =
    session.total_input_tokens + session.total_output_tokens

  const totalCacheInput = session.total_input_tokens + session.total_cache_read_tokens + session.total_cache_write_tokens
  const cacheHitRate = totalCacheInput > 0
    ? session.total_cache_read_tokens / totalCacheInput
    : 0

  const avgCostPerTurn =
    turns.length > 0 ? session.total_cost_usd / turns.length : 0

  const avgTokensPerTurn =
    turns.length > 0 ? Math.round(totalTokens / turns.length) : 0

  // Estimate cache savings: cached tokens would have been charged at full input rate
  // Savings = cache_read_tokens * (input_price - cache_read_price) / 1M
  // Approximate: cache reads cost ~10% of input, so savings = 90% * cache_read_tokens * input_rate
  // Simpler: use the ratio of session cost to what it would have cost without caching
  const cacheSavingsEstimate = session.total_cache_read_tokens > 0
    ? session.total_cost_usd * cacheHitRate * 0.9 // rough: 90% savings on cached portion
    : 0

  // Detect model diversity (multiple models in one session)
  const models = new Set(turns.map((t) => t.model).filter(Boolean))
  const multiModel = models.size > 1

  const cards = isMax
    ? [
        { label: "Total Tokens", value: formatTokens(totalTokens) },
        { label: "Input Tokens", value: formatTokens(session.total_input_tokens) },
        { label: "Output Tokens", value: formatTokens(session.total_output_tokens) },
        { label: "Cache Hit Rate", value: formatPercent(cacheHitRate) },
        { label: "API Equivalent", value: formatCost(session.total_cost_usd), sub: `${turns.length} turns${multiModel ? `, ${models.size} models` : ""}` },
      ]
    : [
        { label: "Total Cost", value: formatCost(session.total_cost_usd) },
        { label: "Total Tokens", value: formatTokens(totalTokens) },
        { label: "Cache Hit Rate", value: formatPercent(cacheHitRate) },
        { label: "Cache Savings", value: cacheSavingsEstimate > 0 ? `~${formatCost(cacheSavingsEstimate)}` : "—", highlight: cacheSavingsEstimate > 0 },
        { label: "Turns", value: `${turns.length}${multiModel ? ` (${models.size} models)` : ""}` },
      ]

  return (
    <div className="grid grid-cols-5 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
        >
          <div className="text-xs text-zinc-500 mb-1">{card.label}</div>
          <div className={`text-xl font-semibold tabular-nums ${
            (card as any).highlight ? "text-green-400" : ""
          }`}>
            {card.value}
          </div>
          {(card as any).sub && (
            <div className="text-[10px] text-zinc-600 mt-0.5">{(card as any).sub}</div>
          )}
        </div>
      ))}
    </div>
  )
}
