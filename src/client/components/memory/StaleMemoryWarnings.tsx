import React from "react"
import type { MemoryEventRow } from "../../lib/api"

interface Props {
  memories: MemoryEventRow[]
}

export function StaleMemoryWarnings({ memories }: Props) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-amber-400 mb-3">
        Stale Memories ({">"}7 days old)
      </h3>
      <div className="space-y-2">
        {memories.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-3 text-sm py-1"
          >
            <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
            <span className="font-medium">{m.file_name}</span>
            <span className="text-zinc-500 text-xs">
              {m.memory_type ?? "unknown"}
            </span>
            <span className="text-amber-400 text-xs ml-auto tabular-nums">
              {m.age_days}d old
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-500 mt-3">
        Consider reviewing these memories — they may be outdated.
      </p>
    </div>
  )
}
