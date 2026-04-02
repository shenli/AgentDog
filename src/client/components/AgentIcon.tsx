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

/** OpenClaw — cloud with terminal prompt, inspired by their logo */
function OpenClawIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect width="24" height="24" rx="5" fill="#7C3AED" fillOpacity="0.15" />
      <path
        d="M6 16C4.34 16 3 14.66 3 13C3 11.34 4.34 10 6 10C6 7.24 8.24 5 11 5C13.42 5 15.44 6.72 15.9 9.03C16.26 9.01 16.63 9 17 9C19.21 9 21 10.79 21 13C21 15.21 19.21 17 17 17"
        stroke="#8B5CF6"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M9 15L11 17L9 19"
        stroke="#A78BFA"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="13" y1="19" x2="16" y2="19" stroke="#A78BFA" strokeWidth="1.5" strokeLinecap="round" />
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
