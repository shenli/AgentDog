import React from "react"
import type { AgentType } from "../lib/api"

interface Props {
  agent: AgentType | string
  size?: number
  className?: string
}

const AGENT_TITLES: Record<string, string> = {
  claude_code: "Claude Code",
  codex_cli: "Codex CLI",
  openclaw: "OpenClaw",
}

/** Inline SVG icons for each agent type. */
export function AgentIcon({ agent, size = 16, className = "" }: Props) {
  const title = AGENT_TITLES[agent] ?? agent

  switch (agent) {
    case "claude_code":
      return <span title={title}><ClaudeCodeIcon size={size} className={className} /></span>
    case "codex_cli":
      return <span title={title}><CodexIcon size={size} className={className} /></span>
    case "openclaw":
      return <span title={title}><OpenClawIcon size={size} className={className} /></span>
    default:
      return <span title={title}><DefaultIcon size={size} className={className} /></span>
  }
}

/** Claude Code — Anthropic orange/amber gradient with "C" */
function ClaudeCodeIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <rect width="24" height="24" rx="6" fill="#D97706" />
      <text x="12" y="16.5" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="system-ui">C</text>
    </svg>
  )
}

/** Codex CLI — OpenAI green with ">_" terminal prompt */
function CodexIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <rect width="24" height="24" rx="6" fill="#059669" />
      <text x="12" y="16.5" textAnchor="middle" fill="white" fontSize="11" fontWeight="700" fontFamily="monospace">{">_"}</text>
    </svg>
  )
}

/** OpenClaw — red with simplified mascot face */
function OpenClawIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <rect width="24" height="24" rx="6" fill="#DC2626" />
      {/* Eyes */}
      <circle cx="9" cy="11" r="2" fill="#0F172A" />
      <circle cx="15" cy="11" r="2" fill="#0F172A" />
      <circle cx="9" cy="10.7" r="1.1" fill="#2DD4BF" />
      <circle cx="15" cy="10.7" r="1.1" fill="#2DD4BF" />
      {/* Antennae */}
      <line x1="9" y1="5" x2="8" y2="2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="15" y1="5" x2="16" y2="2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function DefaultIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <rect width="24" height="24" rx="6" fill="#3F3F46" />
      <circle cx="12" cy="12" r="4" stroke="#71717A" strokeWidth="1.5" fill="none" />
    </svg>
  )
}
