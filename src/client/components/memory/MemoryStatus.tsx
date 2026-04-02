import React, { useMemo } from "react"
import type { MemoryEventRow } from "../../lib/api"

interface Props {
  events: MemoryEventRow[]
}

export function MemoryStatus({ events }: Props) {
  const stats = useMemo(() => {
    const loaded = events.filter((e) => e.event_type === "loaded")
    const written = events.filter((e) =>
      ["written", "updated"].includes(e.event_type)
    )
    const totalBytes = loaded.reduce((sum, e) => sum + (e.size_bytes ?? 0), 0)
    const typeCount = new Map<string, number>()
    for (const e of loaded) {
      const t = e.memory_type ?? "unknown"
      typeCount.set(t, (typeCount.get(t) ?? 0) + 1)
    }

    return {
      totalFiles: loaded.length,
      totalBytes,
      writtenCount: written.length,
      typeCount,
    }
  }, [events])

  const cards = [
    { label: "Files Loaded", value: `${stats.totalFiles}` },
    {
      label: "Total Size",
      value:
        stats.totalBytes > 1024
          ? `${(stats.totalBytes / 1024).toFixed(1)} KB`
          : `${stats.totalBytes} B`,
    },
    { label: "Writes This Session", value: `${stats.writtenCount}` },
  ]

  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
        >
          <div className="text-xs text-zinc-500 mb-1">{card.label}</div>
          <div className="text-xl font-semibold tabular-nums">{card.value}</div>
        </div>
      ))}
    </div>
  )
}
