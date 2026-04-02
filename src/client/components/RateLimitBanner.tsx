import React, { useState, useEffect } from "react"
import type { RateLimitInfo } from "../lib/api"

interface Props {
  ws: { on: (type: string, handler: (msg: any) => void) => () => void }
}

function formatResetTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()

  if (diffMs < 0) return "now"
  if (diffMs < 60 * 60 * 1000) {
    return `${Math.ceil(diffMs / 60_000)}min`
  }

  const isToday = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

  if (isToday) return time
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
}

/** Shows rate limit usage bars. Only fires for agents that embed rate limit
 *  data in their transcripts (currently Codex CLI). */
export function RateLimitBanner({ ws }: Props) {
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)

  useEffect(() => {
    const unsub = ws.on("rate_limit", (msg: RateLimitInfo) => {
      setRateLimit(msg)
    })
    return unsub
  }, [ws])

  if (!rateLimit) return null

  const primary = rateLimit.primary_used_percent
  const secondary = rateLimit.secondary_used_percent

  // Only show when usage is notable (>50%)
  const showPrimary = primary != null && primary > 50
  const showSecondary = secondary != null && secondary > 50

  if (!showPrimary && !showSecondary) return null

  return (
    <div className="space-y-2">
      {showPrimary && (
        <UsageBar
          label="Session limit"
          percent={primary!}
          resetsAt={rateLimit.primary_resets_at}
          planType={rateLimit.plan_type}
        />
      )}
      {showSecondary && (
        <UsageBar
          label="Weekly limit"
          percent={secondary!}
          resetsAt={rateLimit.secondary_resets_at}
          planType={rateLimit.plan_type}
        />
      )}
    </div>
  )
}

function UsageBar({ label, percent, resetsAt, planType }: {
  label: string
  percent: number
  resetsAt: number | null
  planType: string | null
}) {
  const isUrgent = percent >= 90
  const isWarning = percent >= 75

  const barColor = isUrgent
    ? "bg-red-500"
    : isWarning
      ? "bg-amber-500"
      : "bg-blue-500"

  const borderColor = isUrgent
    ? "border-red-500/30"
    : isWarning
      ? "border-amber-500/30"
      : "border-zinc-800"

  const textColor = isUrgent
    ? "text-red-400"
    : isWarning
      ? "text-amber-400"
      : "text-zinc-400"

  return (
    <div className={`rounded-lg p-3 border ${borderColor} bg-zinc-900`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${textColor}`}>{label}</span>
          {planType && (
            <span className="text-[10px] text-zinc-600">{planType} plan</span>
          )}
        </div>
        <span className={`text-xs font-semibold tabular-nums ${textColor}`}>
          {percent.toFixed(0)}% used
        </span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {resetsAt && (
        <div className="text-[10px] text-zinc-600 mt-1">
          Resets {formatResetTime(resetsAt)}
        </div>
      )}
    </div>
  )
}
