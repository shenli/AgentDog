import React, { useMemo } from "react"
import type { ToolCallRow, TurnRow, Session } from "../../lib/api"
import { formatCost, formatTokens } from "../../lib/format"

interface Props {
  tools: ToolCallRow[]
  turns: TurnRow[]
  session: Session
}

interface ToolStats {
  name: string
  callCount: number
  totalOutputBytes: number
  estimatedTokens: number
  estimatedCostPct: number
}

export function ToolCostRanking({ tools, turns, session }: Props) {
  const rankings = useMemo(() => {
    const byTool = new Map<string, ToolStats>()

    for (const tool of tools) {
      const existing = byTool.get(tool.tool_name) ?? {
        name: tool.tool_name,
        callCount: 0,
        totalOutputBytes: 0,
        estimatedTokens: 0,
        estimatedCostPct: 0,
      }
      existing.callCount++
      existing.totalOutputBytes += tool.output_size_bytes ?? 0
      // Rough token estimate: 1 token per 4 bytes
      existing.estimatedTokens += Math.ceil(
        (tool.output_size_bytes ?? 0) / 4
      )
      byTool.set(tool.tool_name, existing)
    }

    const totalTokens = session.total_input_tokens + session.total_output_tokens
    const results = Array.from(byTool.values())
    for (const r of results) {
      r.estimatedCostPct =
        totalTokens > 0 ? r.estimatedTokens / totalTokens : 0
    }
    return results.sort((a, b) => b.estimatedTokens - a.estimatedTokens)
  }, [tools, session])

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">
        Tool Cost Ranking
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 pr-4">Tool</th>
              <th className="text-right pb-2 pr-4">Calls</th>
              <th className="text-right pb-2 pr-4">Est. Tokens</th>
              <th className="text-right pb-2 pr-4">% of Session</th>
            </tr>
          </thead>
          <tbody>
            {rankings.map((r) => (
              <tr
                key={r.name}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
              >
                <td className="py-2 pr-4 font-mono text-xs">{r.name}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {r.callCount}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatTokens(r.estimatedTokens)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {(r.estimatedCostPct * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
