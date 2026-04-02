import React from "react"
import type { AgentType } from "../lib/api"

interface Props {
  agent: AgentType | string
  size?: number
  className?: string
}

/** Inline SVG icons for each agent type. Renders at the given size (default 16px). */
export function AgentIcon({ agent, size = 16, className = "" }: Props) {
  const s = size

  switch (agent) {
    case "claude_code":
      return <ClaudeCodeIcon size={s} className={className} />
    case "codex_cli":
      return <CodexIcon size={s} className={className} />
    case "openclaw":
      return <OpenClawIcon size={s} className={className} />
    default:
      return <DefaultIcon size={s} className={className} />
  }
}

/** Claude Code — Anthropic star/sparkle shape */
function ClaudeCodeIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect width="24" height="24" rx="5" fill="#D97706" fillOpacity="0.15" />
      <path
        d="M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z"
        fill="#F59E0B"
      />
    </svg>
  )
}

/** Codex CLI — terminal/code bracket */
function CodexIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect width="24" height="24" rx="5" fill="#059669" fillOpacity="0.15" />
      <path
        d="M8 7L4 12L8 17M16 7L20 12L16 17"
        stroke="#10B981"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** OpenClaw — red round character with antennae and teal eyes */
function OpenClawIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect width="24" height="24" rx="5" fill="#DC2626" fillOpacity="0.12" />
      {/* Antennae */}
      <line x1="9" y1="5" x2="8" y2="3" stroke="#DC2626" strokeWidth="1" strokeLinecap="round" />
      <line x1="15" y1="5" x2="16" y2="3" stroke="#DC2626" strokeWidth="1" strokeLinecap="round" />
      {/* Body */}
      <ellipse cx="12" cy="12" rx="7" ry="6.5" fill="#DC2626" />
      {/* Arms */}
      <circle cx="4.5" cy="12" r="1.5" fill="#B91C1C" />
      <circle cx="19.5" cy="12" r="1.5" fill="#B91C1C" />
      {/* Eyes */}
      <circle cx="9.5" cy="11" r="1.8" fill="#0D0D0D" />
      <circle cx="14.5" cy="11" r="1.8" fill="#0D0D0D" />
      <circle cx="9.5" cy="10.8" r="1" fill="#2DD4BF" />
      <circle cx="14.5" cy="10.8" r="1" fill="#2DD4BF" />
      {/* Legs */}
      <rect x="8" y="18" width="1.5" height="3" rx="0.5" fill="#DC2626" />
      <rect x="11" y="18" width="1.5" height="3" rx="0.5" fill="#DC2626" />
      <rect x="14" y="18" width="1.5" height="3" rx="0.5" fill="#DC2626" />
    </svg>
  )
}

function DefaultIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect width="24" height="24" rx="5" fill="#52525B" fillOpacity="0.3" />
      <circle cx="12" cy="12" r="4" stroke="#71717A" strokeWidth="1.5" />
    </svg>
  )
}
