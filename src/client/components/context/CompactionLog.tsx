import React from "react"
import type { CompactionEventRow } from "../../lib/api"
import { formatTokens, formatTimeAgo } from "../../lib/format"

interface Props {
  compactions: CompactionEventRow[]
}

export function CompactionLog({ compactions }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">
        Compaction Events
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left pb-2 pr-4">Time</th>
              <th className="text-left pb-2 pr-4">Status</th>
              <th className="text-right pb-2 pr-4">Tokens Before</th>
              <th className="text-right pb-2 pr-4">Tokens After</th>
              <th className="text-right pb-2 pr-4">Saved</th>
              <th className="text-left pb-2">Session Memory</th>
            </tr>
          </thead>
          <tbody>
            {compactions.map((c) => {
              const saved = c.tokens_saved ?? 0
              const hasBefore = c.tokens_before != null && c.tokens_before > 0
              const success = saved > 0
              const failed = hasBefore && saved <= 0

              return (
                <tr
                  key={c.id}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                >
                  <td className="py-2 pr-4 text-zinc-400 text-xs">
                    {formatTimeAgo(c.timestamp)}
                  </td>
                  <td className="py-2 pr-4">
                    {success ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400">
                        success
                      </span>
                    ) : failed ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400">
                        failed
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-400">
                        unknown
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {c.tokens_before != null ? formatTokens(c.tokens_before) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {c.tokens_after != null ? formatTokens(c.tokens_after) : "—"}
                  </td>
                  <td className={`py-2 pr-4 text-right tabular-nums ${
                    success ? "text-green-400" : failed ? "text-red-400" : ""
                  }`}>
                    {c.tokens_saved != null ? formatTokens(c.tokens_saved) : "—"}
                  </td>
                  <td className="py-2 text-xs">
                    {c.used_session_memory ? (
                      <span className="text-green-400">Yes</span>
                    ) : (
                      <span className="text-zinc-500">No</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
