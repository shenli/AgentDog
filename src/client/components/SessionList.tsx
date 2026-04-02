import React from "react"
import type { Session, AgentType } from "../lib/api"
import { AGENT_LABELS } from "../lib/api"
import { formatCost, formatTimeAgo, formatTokens } from "../lib/format"

interface Props {
  sessions: Session[]
  selectedId: string | null
  onSelect: (id: string) => void
  isMax: boolean
}

const AGENT_BADGE_COLORS: Record<string, string> = {
  claude_code: "bg-orange-500/20 text-orange-400",
  codex_cli: "bg-emerald-500/20 text-emerald-400",
  openclaw: "bg-violet-500/20 text-violet-400",
}

const AGENT_SHORT: Record<string, string> = {
  claude_code: "CC",
  codex_cli: "CX",
  openclaw: "OC",
}

export function SessionList({ sessions, selectedId, onSelect, isMax }: Props) {
  const active = sessions.filter((s) => s.status === "active")
  const recent = sessions.filter(
    (s) => s.status === "idle" || s.status === "ended"
  )

  return (
    <div className="flex-1 overflow-auto">
      {active.length > 0 && (
        <SessionGroup label="Active" sessions={active} selectedId={selectedId} onSelect={onSelect} isMax={isMax} />
      )}
      {recent.length > 0 && (
        <SessionGroup label="Recent" sessions={recent} selectedId={selectedId} onSelect={onSelect} isMax={isMax} />
      )}
      {sessions.length === 0 && (
        <div className="px-4 py-8 text-center text-zinc-600 text-sm">
          No sessions found.
          <br />
          Start an AI coding agent to begin.
        </div>
      )}
    </div>
  )
}

function SessionGroup({
  label,
  sessions,
  selectedId,
  onSelect,
  isMax,
}: {
  label: string
  sessions: Session[]
  selectedId: string | null
  onSelect: (id: string) => void
  isMax: boolean
}) {
  return (
    <div>
      <div className="px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
        {label}
      </div>
      {sessions.map((s) => (
        <SessionItem
          key={s.id}
          session={s}
          selected={s.id === selectedId}
          onSelect={() => onSelect(s.id)}
          isMax={isMax}
        />
      ))}
    </div>
  )
}

function SessionItem({
  session,
  selected,
  onSelect,
  isMax,
}: {
  session: Session
  selected: boolean
  onSelect: () => void
  isMax: boolean
}) {
  const primaryMetric = isMax
    ? formatTokens(session.total_input_tokens + session.total_output_tokens)
    : formatCost(session.total_cost_usd)

  const health = getSessionHealth(session)
  const badgeColor = AGENT_BADGE_COLORS[session.agent_type] ?? "bg-zinc-700 text-zinc-400"
  const agentShort = AGENT_SHORT[session.agent_type] ?? "?"

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 transition-colors
        ${selected ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            session.status === "active"
              ? health === "danger" ? "bg-red-400" : health === "warning" ? "bg-yellow-400" : "bg-green-400"
              : "bg-zinc-600"
          }`}
        />
        <span className={`px-1 py-0 rounded text-[9px] font-bold leading-tight flex-shrink-0 ${badgeColor}`}
              title={AGENT_LABELS[session.agent_type as AgentType] ?? session.agent_type}>
          {agentShort}
        </span>
        <span className="text-sm font-medium truncate flex-1">
          {shortProjectName(session.project_name)}
        </span>
        <span className="text-xs text-zinc-400 tabular-nums">
          {primaryMetric}
        </span>
      </div>
      {session.status !== "active" && (
        <div className="mt-1 ml-4 text-[10px] text-zinc-500">
          {formatTimeAgo(session.started_at)}
        </div>
      )}
    </button>
  )
}

function shortProjectName(name: string): string {
  // "~/work/my-api" -> "my-api"
  const parts = name.split("/")
  return parts[parts.length - 1] || name
}

type HealthStatus = "ok" | "warning" | "danger"

function getSessionHealth(session: Session): HealthStatus {
  if (session.total_cost_usd > 20) return "danger"
  if (session.total_cost_usd > 5) return "warning"
  if (session.compaction_count > 10) return "danger"
  if (session.compaction_count > 5) return "warning"
  return "ok"
}
