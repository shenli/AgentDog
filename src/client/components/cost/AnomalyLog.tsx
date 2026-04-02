import React from "react"
import type { AnomalyRow } from "../../lib/api"
import { formatCost } from "../../lib/format"

interface Props {
  anomalies: AnomalyRow[]
}

export function AnomalyLog({ anomalies }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">
        Cost Anomalies
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 pr-4">Turn</th>
              <th className="text-left pb-2 pr-4">Type</th>
              <th className="text-right pb-2 pr-4">Actual</th>
              <th className="text-right pb-2 pr-4">Expected</th>
              <th className="text-right pb-2 pr-4">Multiplier</th>
              <th className="text-left pb-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a) => (
              <tr
                key={a.id}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
              >
                <td className="py-2 pr-4 tabular-nums">{a.turn_number}</td>
                <td className="py-2 pr-4">
                  <AnomalyBadge type={a.anomaly_type} />
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-red-400">
                  {formatCost(a.actual_cost_usd)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">
                  {formatCost(a.expected_cost_usd)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-medium text-amber-400">
                  {a.multiplier.toFixed(1)}x
                </td>
                <td className="py-2 text-zinc-400 text-xs">
                  {a.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AnomalyBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    cache_miss: "bg-orange-500/20 text-orange-400",
    large_tool_result: "bg-blue-500/20 text-blue-400",
    background_overhead: "bg-purple-500/20 text-purple-400",
    high_cost_turn: "bg-red-500/20 text-red-400",
  }
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-medium ${
        colors[type] ?? "bg-zinc-700 text-zinc-400"
      }`}
    >
      {type.replace(/_/g, " ")}
    </span>
  )
}
