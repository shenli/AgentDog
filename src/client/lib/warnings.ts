import type { Session, TurnRow, AgentType } from "./api"
import { AGENT_LABELS } from "./api"

export type WarningSeverity = "info" | "warning" | "critical"

export interface Warning {
  id: string
  severity: WarningSeverity
  title: string
  detail: string
  sessionId?: string
  agent?: string
}

/** Analyze all sessions and return warnings for the Overview dashboard. */
export function computeOverviewWarnings(sessions: Session[]): Warning[] {
  const warnings: Warning[] = []

  for (const s of sessions) {
    if (s.status !== "active" && s.status !== "idle") continue

    const agentLabel = AGENT_LABELS[s.agent_type as AgentType] ?? s.agent_type
    const projectName = s.project_name.split("/").pop() ?? s.project_name

    // High cost session
    if (s.total_cost_usd > 10) {
      warnings.push({
        id: `high-cost-${s.id}`,
        severity: s.total_cost_usd > 50 ? "critical" : "warning",
        title: `High cost: ${projectName}`,
        detail: `$${s.total_cost_usd.toFixed(2)} spent (${agentLabel})`,
        sessionId: s.id,
        agent: s.agent_type,
      })
    }

    // Frequent compactions — context pressure
    if (s.compaction_count > 5) {
      warnings.push({
        id: `compaction-pressure-${s.id}`,
        severity: s.compaction_count > 10 ? "critical" : "warning",
        title: `Context pressure: ${projectName}`,
        detail: `${s.compaction_count} compactions — session may be losing context`,
        sessionId: s.id,
        agent: s.agent_type,
      })
    }

    // Input-heavy session (possible waste)
    if (s.total_input_tokens > 0 && s.total_output_tokens > 0) {
      const ratio = s.total_input_tokens / s.total_output_tokens
      if (ratio > 20 && s.total_input_tokens > 100_000) {
        warnings.push({
          id: `input-heavy-${s.id}`,
          severity: "info",
          title: `Input-heavy: ${projectName}`,
          detail: `${ratio.toFixed(0)}:1 input/output ratio — large system prompts or tool outputs`,
          sessionId: s.id,
          agent: s.agent_type,
        })
      }
    }

    // Low cache hit rate (for sessions with significant cache activity)
    const cacheTotal = s.total_input_tokens + s.total_cache_read_tokens + s.total_cache_write_tokens
    if (cacheTotal > 50_000) {
      const hitRate = s.total_cache_read_tokens / cacheTotal
      if (hitRate < 0.3) {
        warnings.push({
          id: `low-cache-${s.id}`,
          severity: "warning",
          title: `Low cache efficiency: ${projectName}`,
          detail: `${(hitRate * 100).toFixed(0)}% cache hit rate — prompt caching may be broken`,
          sessionId: s.id,
          agent: s.agent_type,
        })
      }
    }
  }

  // Sort: critical first, then warning, then info
  const order: Record<WarningSeverity, number> = { critical: 0, warning: 1, info: 2 }
  warnings.sort((a, b) => order[a.severity] - order[b.severity])

  return warnings
}

/** Analyze a single session's turns and return detailed warnings. */
export function computeSessionWarnings(session: Session, turns: TurnRow[]): Warning[] {
  const warnings: Warning[] = []
  if (turns.length === 0) return warnings

  // Context utilization check
  const latestTurn = turns[turns.length - 1]
  // We don't have the context window here, but we can flag absolute values
  if (latestTurn.context_tokens_used > 150_000) {
    warnings.push({
      id: "context-high",
      severity: latestTurn.context_tokens_used > 180_000 ? "critical" : "warning",
      title: "Context window filling up",
      detail: `${(latestTurn.context_tokens_used / 1000).toFixed(0)}K tokens used — compaction likely soon`,
    })
  }

  // Cache invalidation detection: look for sharp drops in cache rate
  const recentTurns = turns.filter((t) => !t.is_background_process).slice(-20)
  if (recentTurns.length >= 5) {
    let invalidations = 0
    for (let i = 1; i < recentTurns.length; i++) {
      const prev = recentTurns[i - 1]
      const curr = recentTurns[i]
      const prevTotal = prev.input_tokens + prev.cache_read_tokens + prev.cache_write_tokens
      const currTotal = curr.input_tokens + curr.cache_read_tokens + curr.cache_write_tokens
      const prevRate = prevTotal > 0 ? prev.cache_read_tokens / prevTotal : 0
      const currRate = currTotal > 0 ? curr.cache_read_tokens / currTotal : 0
      if (prevRate - currRate > 0.3 && prevRate > 0.4) {
        invalidations++
      }
    }
    if (invalidations > 0) {
      warnings.push({
        id: "cache-invalidation",
        severity: invalidations > 2 ? "warning" : "info",
        title: "Prompt cache instability",
        detail: `${invalidations} cache invalidation${invalidations > 1 ? "s" : ""} in recent turns — cache efficiency may be degraded`,
      })
    }
  }

  // Tool output bloat: check if tool results dominate input
  const toolHeavyTurns = recentTurns.filter((t) => {
    // A turn where context estimate is very high relative to output
    return t.context_tokens_used > 0 && t.output_tokens > 0 && t.context_tokens_used / t.output_tokens > 50
  })
  if (toolHeavyTurns.length > recentTurns.length * 0.5 && recentTurns.length >= 5) {
    warnings.push({
      id: "tool-bloat",
      severity: "info",
      title: "Large tool outputs",
      detail: "Most recent turns have very high input-to-output ratios — tool results may be consuming excessive context",
    })
  }

  // Session stall detection
  if (session.status === "active") {
    const lastTurnTime = latestTurn.timestamp
    const now = Date.now()
    const idleMs = now - lastTurnTime
    if (idleMs > 10 * 60 * 1000) {
      warnings.push({
        id: "session-stall",
        severity: "info",
        title: "Session may be stalled",
        detail: `No turns for ${Math.floor(idleMs / 60_000)} minutes`,
      })
    }
  }

  // Cost spike: check last turn vs average
  if (recentTurns.length >= 3) {
    const lastCost = recentTurns[recentTurns.length - 1].cost_usd
    const avgCost = recentTurns.reduce((s, t) => s + t.cost_usd, 0) / recentTurns.length
    if (avgCost > 0 && lastCost > avgCost * 5) {
      warnings.push({
        id: "cost-spike",
        severity: "warning",
        title: "Cost spike on last turn",
        detail: `$${lastCost.toFixed(4)} (${(lastCost / avgCost).toFixed(1)}x average)`,
      })
    }
  }

  const order: Record<WarningSeverity, number> = { critical: 0, warning: 1, info: 2 }
  warnings.sort((a, b) => order[a.severity] - order[b.severity])

  return warnings
}
