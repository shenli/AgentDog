import React from "react"
import type { MemoryEventRow } from "../../lib/api"
import { formatTimeAgo } from "../../lib/format"

interface Props {
  events: MemoryEventRow[]
}

const EVENT_COLORS: Record<string, string> = {
  loaded: "bg-blue-500",
  written: "bg-orange-500",
  updated: "bg-amber-500",
  deleted: "bg-red-500",
  selected: "bg-green-500",
}

const TYPE_BADGES: Record<string, string> = {
  user: "bg-blue-500/20 text-blue-400",
  feedback: "bg-purple-500/20 text-purple-400",
  project: "bg-amber-500/20 text-amber-400",
  reference: "bg-cyan-500/20 text-cyan-400",
}

export function MemoryTimeline({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
        No memory events yet
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-4">
        Memory Event Timeline
      </h3>
      <div className="space-y-1">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-3 py-2 px-2 rounded hover:bg-zinc-800/30"
          >
            {/* Dot */}
            <div className="mt-1.5 flex-shrink-0">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  EVENT_COLORS[event.event_type] ?? "bg-zinc-500"
                }`}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {event.file_name}
                </span>
                {event.memory_type && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      TYPE_BADGES[event.memory_type] ??
                      "bg-zinc-700 text-zinc-400"
                    }`}
                  >
                    {event.memory_type}
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400">
                  {event.event_type}
                </span>
              </div>
              {event.description && (
                <p className="text-xs text-zinc-500 mt-0.5 truncate">
                  {event.description}
                </p>
              )}
              <div className="text-[10px] text-zinc-600 mt-0.5 flex gap-3">
                <span>{formatTimeAgo(event.timestamp)}</span>
                {event.size_bytes != null && (
                  <span>
                    {event.size_bytes > 1024
                      ? `${(event.size_bytes / 1024).toFixed(1)} KB`
                      : `${event.size_bytes} B`}
                  </span>
                )}
                {event.age_days != null && event.age_days > 0 && (
                  <span>{event.age_days}d old</span>
                )}
                {event.source && <span>via {event.source}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
