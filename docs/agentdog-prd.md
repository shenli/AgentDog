# AgentDog: cost and context debugger for coding agents

A Mac menu bar app that answers three questions about Claude Code: where did my tokens go, what's inside the context window, and which memories are driving behavior. Built on transcript parsing, not just hooks. Monitors all active sessions simultaneously.

## Problem

Claude Code users hit rate limits faster than expected and have no way to diagnose why. The GitHub issue tracker has 15+ open issues about unexpected token consumption (#9094 with 30+ reports, #16856, #38239, #28537, #23706). Users see a single aggregate cost number via `/cost` and nothing else.

Three things are invisible today:

1. Per-turn token cost and what's consuming it (system prompt, memory injection, tool results, background processes)
2. Context window composition and when compaction will fire
3. Which memories were loaded, whether they influenced behavior, and whether they're stale

## Architecture

```
~/.claude/projects/
  ├── -Users-you-project-a/
  │     ├── sessions/*.jsonl ──┐
  │     └── memory/            │
  ├── -Users-you-project-b/    │
  │     ├── sessions/*.jsonl ──┤
  │     └── memory/            │
  └── ...                      │
                               ▼
                     Session Discovery
                     (scans all projects,
                      detects active by mtime)
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
    Transcript Parser   Event Collector    Memory Watcher
    (one per active     (hook events via   (fs.watch per
     session)            HTTP POST)         project memory dir)
            │                  │                  │
            └──────────────────┼──────────────────┘
                               ▼
                        SQLite (single db,
                        keyed by session_id)
                               │
                     ┌─────────┼─────────┐
                     ▼         ▼         ▼
               Menu Bar     WebSocket   HTTP API
               Widget       Server
               (tray icon,  (real-time   (Hono,
                native       events)      port 4982)
                notifications)    │
                     │            ▼
                     │      Dashboard
                     │      (React WebView
                     │       in Tauri window)
                     │            │
                     └────────────┘
                      Tauri app shell
```

### App delivery

Tauri (Rust backend, WebView frontend). Ships as a ~10MB native Mac app. The Rust process handles file watching, SQLite, session discovery, and the system tray. The frontend is React rendered in a WebView. Same React code from the dashboard, no Electron overhead.

Distribution: Homebrew tap (`brew install --cask agentdog`) and direct DMG download. Not the Mac App Store (sandboxing prevents reading `~/.claude/`).

### Components

1. **Session discovery** — scans all project directories under `~/.claude/projects/`, finds active sessions by JSONL mtime, spawns a transcript parser per active session, tears down parsers when sessions go idle. Runs on a 5-second poll interval.

2. **Transcript parser** — one instance per active session. Watches the session's JSONL file, parses each appended line, extracts token usage, model info, tool calls, system prompt content, and memory injections. This is the primary data source, not hooks.

3. **Event collector** — receives Claude Code hook events (Stop, PostToolUse, PostCompact, SubagentStart/Stop, FileChanged) via HTTP POST for real-time event correlation. Hooks are optional — the transcript has most data, hooks add timing and compaction detail.

4. **Memory watcher** — one instance per project with active sessions. Watches the memory directory with `fs.watch` for creates, updates, and deletes. Detects extractMemories and autoDream activity.

5. **Storage** — single SQLite database (via better-sqlite3 or Tauri's built-in SQLite). All sessions from all projects in one database, keyed by session ID. Stored at `~/.agentdog/data.sqlite`.

6. **Menu bar widget** — system tray icon showing the hottest active session's cost and context utilization. Native macOS notifications for anomalies and compaction warnings.

7. **Dashboard window** — React + Vite + Tailwind + shadcn/ui rendered in a Tauri WebView. Floating panel (always-on-top option). Three tabs: Cost, Context, Memory. Session list sidebar with active/recent grouping.

## Data model

### Transcript line types

Claude Code writes a JSONL transcript at `~/.claude/projects/<sanitized-cwd>/sessions/<session-id>.jsonl`. Each line is a JSON object. The relevant fields:

```typescript
// API response lines contain usage data
interface TranscriptAPIResponse {
  type: "assistant"
  message: {
    id: string
    model: string
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    stop_reason: string
  }
  costUSD?: number
}

// Tool use lines
interface TranscriptToolUse {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

// Tool result lines
interface TranscriptToolResult {
  type: "tool_result"
  tool_use_id: string
  content: string | { type: string; text?: string }[]
}

// System prompt / context injection
interface TranscriptSystem {
  type: "system"
  content: string // contains CLAUDE.md, memory, rules
}
```

### Database schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_dir TEXT NOT NULL,    -- sanitized dir name, e.g. "-Users-you-my-api"
  project_name TEXT NOT NULL,   -- human-readable, e.g. "~/my-api"
  transcript_path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT DEFAULT 'active', -- 'active' | 'idle' | 'ended'
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_read_tokens INTEGER DEFAULT 0,
  total_cache_write_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  model TEXT
);

CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant'
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  context_tokens_used INTEGER DEFAULT 0, -- estimated total context at this point
  context_tokens_available INTEGER, -- model context window minus used
  stop_reason TEXT,
  is_compaction INTEGER DEFAULT 0,
  is_background_process INTEGER DEFAULT 0, -- extractMemories, sessionMemory, autoDream
  background_process_type TEXT -- 'extract_memories' | 'session_memory' | 'auto_dream' | null
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY, -- tool_use_id
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_number INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  input_summary TEXT, -- truncated to 500 chars
  output_size_bytes INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL, -- 'success' | 'error' | 'cancelled'
  timestamp INTEGER NOT NULL
);

CREATE TABLE context_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  system_prompt_tokens INTEGER,
  claude_md_tokens INTEGER,
  memory_index_tokens INTEGER,
  memory_topic_tokens INTEGER,
  conversation_tokens INTEGER,
  tool_result_tokens INTEGER,
  available_tokens INTEGER
);

CREATE TABLE memory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL, -- 'loaded' | 'selected' | 'written' | 'updated' | 'deleted' | 'truncated'
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source TEXT, -- 'session_start' | 'sonnet_sidequery' | 'extract_memories' | 'auto_dream' | 'user_explicit'
  memory_type TEXT, -- 'user' | 'feedback' | 'project' | 'reference' (from frontmatter)
  description TEXT, -- from frontmatter
  size_bytes INTEGER,
  age_days INTEGER
);

CREATE TABLE compaction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  timestamp INTEGER NOT NULL,
  messages_before INTEGER,
  messages_after INTEGER,
  tokens_before INTEGER,
  tokens_after INTEGER,
  tokens_saved INTEGER,
  used_session_memory INTEGER DEFAULT 0 -- whether session memory was reused
);

CREATE TABLE cost_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  anomaly_type TEXT NOT NULL, -- 'high_cost_turn' | 'cache_miss' | 'large_tool_result' | 'background_overhead'
  description TEXT NOT NULL,
  actual_cost_usd REAL,
  expected_cost_usd REAL, -- rolling average
  multiplier REAL -- actual / expected
);
```

### Model pricing table

Extracted from Claude Code source (`src/utils/modelCost.ts`). Keep as a static config, update when models change:

```typescript
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 1.5,
    contextWindow: 200_000,
  },
  "claude-sonnet-4-6": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 0.75,
    cacheReadPerMillion: 0.3,
    contextWindow: 200_000,
  },
  "claude-haiku-4-5": {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheWritePerMillion: 0.08,
    cacheReadPerMillion: 0.1,
    contextWindow: 200_000,
  },
}
```

## Session discovery

The app monitors all Claude Code sessions across all projects. On startup and every 5 seconds, it scans `~/.claude/projects/` to find active and recent sessions.

### Scanning all projects

```typescript
interface DiscoveredSession {
  sessionId: string
  projectDir: string           // sanitized dir name, e.g. "-Users-you-my-api"
  projectName: string          // human-readable, e.g. "~/my-api"
  transcriptPath: string       // full path to .jsonl
  lastModified: number         // mtime ms
  isActive: boolean            // modified in last 10 seconds
  isRecent: boolean            // modified in last 30 minutes
}

async function discoverSessions(): Promise<DiscoveredSession[]> {
  const projectsDir = path.join(os.homedir(), ".claude", "projects")
  const results: DiscoveredSession[] = []

  let projectDirs: string[]
  try {
    projectDirs = await fs.readdir(projectsDir)
  } catch {
    return [] // ~/.claude/projects doesn't exist yet
  }

  for (const dir of projectDirs) {
    const sessionsDir = path.join(projectsDir, dir, "sessions")
    let files: string[]
    try {
      files = (await fs.readdir(sessionsDir)).filter(f => f.endsWith(".jsonl"))
    } catch {
      continue // no sessions dir for this project
    }

    for (const file of files) {
      const filePath = path.join(sessionsDir, file)
      try {
        const stat = await fs.stat(filePath)
        const idleMs = Date.now() - stat.mtimeMs
        if (idleMs > 30 * 60 * 1000) continue // skip sessions idle > 30 min

        results.push({
          sessionId: file.replace(".jsonl", ""),
          projectDir: dir,
          projectName: unsanitizePath(dir),
          transcriptPath: filePath,
          lastModified: stat.mtimeMs,
          isActive: idleMs < 10_000,
          isRecent: idleMs < 30 * 60 * 1000,
        })
      } catch {
        continue
      }
    }
  }

  return results.sort((a, b) => b.lastModified - a.lastModified)
}
```

### Reversing the sanitized path for display

Claude Code sanitizes project paths by replacing non-alphanumeric characters with hyphens. Reverse this for human-readable labels:

```typescript
function unsanitizePath(sanitized: string): string {
  // "-Users-you-my-project" → "/Users/you/my-project"
  // This is lossy — hyphens in the original path are indistinguishable from separators.
  // Use the best guess: leading hyphen → /, internal hyphens → /
  // Then check if the path exists on disk to validate.
  const guess = sanitized.replace(/^-/, "/").replace(/-/g, "/")

  // Try to shorten with ~ for home directory
  const home = os.homedir()
  if (guess.startsWith(home)) {
    return "~" + guess.slice(home.length)
  }
  return guess
}
```

### Managing parser lifecycle

The discovery loop spawns and tears down transcript parsers as sessions become active or idle:

```typescript
class SessionManager {
  private parsers = new Map<string, TranscriptWatcher>()
  private memoryWatchers = new Map<string, MemoryWatcher>()
  private pollInterval: NodeJS.Timeout | null = null

  start(): void {
    this.poll() // immediate first scan
    this.pollInterval = setInterval(() => this.poll(), 5_000)
  }

  private async poll(): Promise<void> {
    const sessions = await discoverSessions()
    const activeIds = new Set(sessions.filter(s => s.isRecent).map(s => s.sessionId))

    // Start parsers for new sessions
    for (const session of sessions) {
      if (session.isRecent && !this.parsers.has(session.sessionId)) {
        const parser = new TranscriptWatcher()
        await parser.start(session.transcriptPath)
        this.parsers.set(session.sessionId, parser)

        // Start memory watcher for this project if not already watching
        if (!this.memoryWatchers.has(session.projectDir)) {
          const memDir = path.join(
            os.homedir(), ".claude", "projects", session.projectDir, "memory"
          )
          const watcher = new MemoryWatcher()
          await watcher.start(memDir)
          this.memoryWatchers.set(session.projectDir, watcher)
        }

        emit("session_discovered", session)
      }
    }

    // Tear down parsers for sessions that went idle
    for (const [id, parser] of this.parsers) {
      if (!activeIds.has(id)) {
        parser.stop()
        this.parsers.delete(id)
        emit("session_ended", { sessionId: id })
      }
    }
  }
}
```

## Transcript parser

The core engine. One instance per active session. Watches the JSONL file and extracts structured data on each new line.

### Watching for new lines

Use `fs.watch` on the transcript file. On change, read from the last known byte offset to EOF. Split by newlines, parse each as JSON. Handle partial lines (buffer incomplete JSON until next newline).

```typescript
class TranscriptWatcher {
  private offset = 0
  private buffer = ""
  private watcher: fs.FSWatcher | null = null

  async start(filePath: string): Promise<void> {
    // Read existing content first (catch up)
    const content = await fs.readFile(filePath, "utf-8")
    this.processLines(content)
    this.offset = Buffer.byteLength(content)

    // Watch for appends
    this.watcher = fs.watch(filePath, async () => {
      const fd = await fs.open(filePath, "r")
      const stat = await fd.stat()
      if (stat.size <= this.offset) return

      const buf = Buffer.alloc(stat.size - this.offset)
      await fd.read(buf, 0, buf.length, this.offset)
      await fd.close()
      this.offset = stat.size

      this.processLines(buf.toString("utf-8"))
    })
  }

  private processLines(raw: string): void {
    this.buffer += raw
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() ?? "" // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        this.emit("line", parsed)
      } catch {
        // skip malformed lines
      }
    }
  }
}
```

### Extracting data from each line

The parser maintains running state per session:

```typescript
interface ParserState {
  sessionId: string
  turnNumber: number
  cumulativeInputTokens: number
  cumulativeOutputTokens: number
  cumulativeCacheReadTokens: number
  cumulativeCacheWriteTokens: number
  cumulativeCostUSD: number
  contextTokensEstimate: number
  model: string | null
  recentTurnCosts: number[] // last 10, for anomaly detection
}
```

For each parsed line, classify and extract:

```typescript
function processLine(line: any, state: ParserState): void {
  // API response — contains token usage
  if (line.type === "assistant" && line.message?.usage) {
    const u = line.message.usage
    state.turnNumber++
    state.cumulativeInputTokens += u.input_tokens
    state.cumulativeOutputTokens += u.output_tokens
    state.cumulativeCacheReadTokens += u.cache_read_input_tokens ?? 0
    state.cumulativeCacheWriteTokens += u.cache_creation_input_tokens ?? 0

    const cost = calculateCost(u, line.message.model)
    state.cumulativeCostUSD += cost
    state.model = line.message.model

    // Estimate context size: input_tokens approximates total context sent
    state.contextTokensEstimate = u.input_tokens

    // Anomaly detection
    state.recentTurnCosts.push(cost)
    if (state.recentTurnCosts.length > 10) state.recentTurnCosts.shift()
    const avg = state.recentTurnCosts.reduce((a, b) => a + b, 0) / state.recentTurnCosts.length
    if (cost > avg * 3 && state.recentTurnCosts.length >= 3) {
      // Flag as anomaly
      emitAnomaly({ turnNumber: state.turnNumber, actual: cost, expected: avg })
    }

    emitTurn({ ...state, cost, usage: u })
  }

  // Tool use
  if (line.type === "tool_use") {
    emitToolStart({ id: line.id, name: line.name, input: line.input })
  }

  // Tool result
  if (line.type === "tool_result") {
    const size = typeof line.content === "string"
      ? line.content.length
      : JSON.stringify(line.content).length
    emitToolEnd({ id: line.tool_use_id, outputSize: size })
  }

  // System prompt — extract context composition
  if (line.type === "system" || (line.role === "user" && line.content?.includes?.("<system-reminder>"))) {
    extractContextComposition(line, state)
  }
}
```

### Extracting context composition

The system prompt and system-reminder messages contain CLAUDE.md content, memory content, and rules. Parse them to estimate token allocation:

```typescript
function extractContextComposition(line: any, state: ParserState): void {
  const content = typeof line.content === "string"
    ? line.content
    : line.content?.map((c: any) => c.text ?? "").join("") ?? ""

  const snapshot: ContextSnapshot = {
    systemPromptTokens: 0,
    claudeMdTokens: 0,
    memoryIndexTokens: 0,
    memoryTopicTokens: 0,
    conversationTokens: 0,
    toolResultTokens: 0,
  }

  // Detect CLAUDE.md content blocks
  // Pattern: "Contents of <path>/CLAUDE.md:\n\n<content>"
  const claudeMdPattern = /Contents of .*?CLAUDE\.md:\n\n([\s\S]*?)(?=\nContents of|\n# |\n---|\Z)/g
  let match
  while ((match = claudeMdPattern.exec(content)) !== null) {
    snapshot.claudeMdTokens += estimateTokens(match[1])
  }

  // Detect MEMORY.md content
  // Pattern: "# auto memory" section or MEMORY.md content
  const memoryPattern = /# auto memory\n([\s\S]*?)(?=\n# [a-z]|\Z)/
  const memMatch = memoryPattern.exec(content)
  if (memMatch) {
    snapshot.memoryIndexTokens = estimateTokens(memMatch[1])
  }

  // Everything else in the system block is base system prompt
  snapshot.systemPromptTokens = estimateTokens(content)
    - snapshot.claudeMdTokens
    - snapshot.memoryIndexTokens

  emitContextSnapshot(snapshot)
}

// Rough token estimate: 1 token per ~4 characters
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
```

## Hook integration

### Setup

Provide a CLI command to install hooks into Claude Code's `settings.json`:

```bash
npx agentdog setup
```

This writes to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentdog/hooks/hook.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentdog/hooks/hook.sh"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentdog/hooks/hook.sh"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentdog/hooks/hook.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentdog/hooks/hook.sh"
          }
        ]
      }
    ],
    "FileChanged": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentdog/hooks/hook.sh"
          }
        ]
      }
    ]
  }
}
```

### Hook script

Keep it fast. Background the heavy work:

```bash
#!/bin/bash
# Read hook payload from stdin, POST to local server
INPUT=$(cat)
# Fire and forget — don't block Claude Code
curl -s -X POST http://localhost:4982/api/events \
  -H "Content-Type: application/json" \
  -d "$INPUT" &>/dev/null &
```

### Hooks used and why

| Hook | What we extract |
|------|----------------|
| Stop | Turn completed, correlate with transcript token data |
| PostToolUse | Tool call timing (duration not in transcript) |
| PostCompact | Compaction metadata (messages_removed, tokens_saved) |
| SubagentStart | Background process detection (extractMemories, sessionMemory, autoDream) |
| SubagentStop | Background process completion, transcript_path for subagent |
| FileChanged | Memory file writes (filter for memory directory paths) |

## Memory watcher

Watch `~/.claude/projects/<sanitized-cwd>/memory/` with `fs.watch({ recursive: true })`.

```typescript
class MemoryWatcher {
  async start(memoryDir: string): Promise<void> {
    // Initial scan — snapshot current state
    const files = await this.scanDirectory(memoryDir)
    for (const file of files) {
      this.emitMemoryEvent("loaded", file)
    }

    // Watch for changes
    fs.watch(memoryDir, { recursive: true }, async (eventType, filename) => {
      if (!filename?.endsWith(".md")) return
      const filePath = path.join(memoryDir, filename)

      try {
        const stat = await fs.stat(filePath)
        const content = await fs.readFile(filePath, "utf-8")
        const frontmatter = this.parseFrontmatter(content)

        this.emitMemoryEvent(eventType === "rename" ? "written" : "updated", {
          path: filePath,
          name: filename,
          type: frontmatter.type,
          description: frontmatter.description,
          sizeBytes: stat.size,
          ageDays: Math.floor((Date.now() - stat.mtimeMs) / 86_400_000),
        })
      } catch {
        // File deleted
        this.emitMemoryEvent("deleted", { path: filePath, name: filename })
      }
    })
  }

  private parseFrontmatter(content: string): { type?: string; description?: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return {}
    const lines = match[1].split("\n")
    const result: Record<string, string> = {}
    for (const line of lines) {
      const [key, ...rest] = line.split(":")
      if (key && rest.length) {
        result[key.trim()] = rest.join(":").trim()
      }
    }
    return result
  }
}
```

### Detecting which process wrote a memory

Correlate `FileChanged` hook events (which include `session_id` and `agent_id`) with SubagentStart events:

- If `agent_type` contains "extract" or the subagent prompt mentions memory extraction: `source = "extract_memories"`
- If `agent_type` contains "dream" or "consolidat": `source = "auto_dream"`
- If no subagent is active and the file change came during a user turn: `source = "user_explicit"`

## Server

### Technology

- Runtime: Node.js (not Bun — broader compatibility for user installs)
- Framework: Hono
- Database: better-sqlite3 (synchronous, fast for local use)
- WebSocket: Hono built-in websocket upgrade or ws library
- Port: 4982 (avoid 4981 conflict with agents-observe)

### API endpoints

```
GET  /api/sessions                    → list all sessions (active first, then recent, then historical)
GET  /api/sessions/active             → active sessions only, with live stats + burn rate
GET  /api/sessions/:id                → session detail with aggregated metrics
GET  /api/sessions/:id/turns          → per-turn token and cost data
GET  /api/sessions/:id/context        → context composition snapshots over time
GET  /api/sessions/:id/memory         → memory events for this session
GET  /api/sessions/:id/compactions    → compaction events
GET  /api/sessions/:id/anomalies      → cost anomalies
GET  /api/sessions/:id/tools          → tool call log with durations and sizes
POST /api/events                      → hook event ingestion
GET  /api/health                      → health check
WS   /ws                              → real-time event stream (all sessions by default)
WS   /ws?session=:id                  → subscribe to a specific session
```

### WebSocket message types

```typescript
type WSMessage =
  | { type: "turn"; sessionId: string; data: Turn }
  | { type: "context_snapshot"; sessionId: string; data: ContextSnapshot }
  | { type: "memory_event"; sessionId: string; data: MemoryEvent }
  | { type: "compaction"; sessionId: string; data: CompactionEvent }
  | { type: "anomaly"; sessionId: string; data: CostAnomaly }
  | { type: "tool_call"; sessionId: string; data: ToolCall }
  | { type: "session_discovered"; data: DiscoveredSession }
  | { type: "session_status_change"; data: { sessionId: string; status: "active" | "idle" | "ended" } }
```

All messages include `sessionId` so the client can route events to the correct session panel. The `session_discovered` and `session_status_change` messages update the sidebar session list in real time.

## Menu bar widget

The app lives in the macOS menu bar. The tray icon shows a compact readout of the hottest active session (highest burn rate in the last minute).

### What the icon shows without clicking

A small text readout next to the tray icon: `$1.24 67%`. The first number is the session cost so far. The second is context utilization. Both update every few seconds.

If multiple sessions are active, show the one burning the most tokens per minute. Prefix with the project name if more than one session is active: `api: $1.24 67%`.

Color coding: the context percentage text turns yellow at 70%, red at 85%.

### Click to expand

Clicking the tray icon opens a dropdown showing all active sessions:

```
ACTIVE
  ● my-api        $2.14  context: 67%  ██████░░░░
  ● frontend      $0.38  context: 23%  ██░░░░░░░░
  ● scripts       $0.02  idle 4m       █░░░░░░░░░

RECENT (today)
  ○ my-api        $4.21  32 min ago
  ○ frontend      $1.05  1h ago

  ─────────────────────────────
  Open Dashboard        ⌘D
  Preferences...        ⌘,
  Quit                  ⌘Q
```

Active sessions show a live-updating cost and context bar. The green dot means the JSONL was modified in the last 10 seconds. Click any session to open the full dashboard focused on that session.

### Native notifications

Triggered by the anomaly detector and context analyzer:
- "Turn 14 cost $0.42 (5x your average) — likely cause: cache miss after CLAUDE.md edit"
- "Context is 85% full. Compaction expected in ~3 turns."
- "Rate limit projected in 18 minutes at current burn rate."
- "autoDream is running — consolidating memories from 7 sessions."

Notifications are opt-in per type in preferences. Default: rate limit warnings on, anomalies on, compaction warnings off, background process notifications off.

## Dashboard window

Opens as a floating panel (option to pin always-on-top). Can be opened from the menu bar dropdown or with a global keyboard shortcut (default: ⌘⇧O, configurable).

### Layout

Sidebar on the left with session list grouped by status. Main content area with three tabs: Cost, Context, Memory. Top bar shows the selected session's summary: project name, model, total cost, total tokens, duration, rate limit projection.

### Tab 1: Cost

**Top row — summary cards:**
- Total cost (USD)
- Total tokens (input + output)
- Cache hit rate (cache_read / (cache_read + input) as percentage)
- Average cost per turn
- Projected time to rate limit (based on burn rate and known limits)

**Main chart — per-turn cost over time:**
Stacked bar chart. X-axis is turn number. Y-axis is cost in USD. Four stacked segments per bar:
- Input tokens (regular, uncached)
- Output tokens
- Cache write tokens
- Cache read tokens

Color-code background process turns differently (extractMemories, sessionMemory, autoDream) so users can see their overhead.

Mark compaction events as vertical lines on the chart.

**Below chart — cost anomaly log:**
Table listing turns where cost exceeded 3x the rolling average. Columns: turn number, cost, expected cost, multiplier, likely cause (large file read, cache miss, long output, background process).

**Bottom — tool cost ranking:**
Table sorted by total token consumption. Columns: tool name, call count, total input tokens contributed (estimated from tool result sizes), percentage of session cost.

### Tab 2: Context

**Main chart — context composition over time:**
Stacked area chart. X-axis is turn number. Y-axis is tokens. Stacked areas:
- System prompt (base) — gray
- CLAUDE.md files — blue
- Memory (index + topics) — green
- Conversation history — amber
- Tool results — red
- Available headroom — transparent with dashed border

Mark compaction events as vertical lines. After compaction, the conversation area should shrink visibly.

**Right panel — current context breakdown:**
Pie chart or horizontal bar showing the current turn's context composition with exact token counts and percentages.

**Below chart — compaction log:**
Table of compaction events. Columns: timestamp, turn number, tokens before, tokens after, tokens saved, messages removed, used session memory (yes/no).

**Warning banner:**
When context utilization exceeds 80%, show a yellow banner: "Context is 83% full. Compaction expected in ~3 turns at current rate."

### Tab 3: Memory

**Top — MEMORY.md status:**
Card showing: total lines loaded (out of 200 max), total bytes (out of 25KB max), truncated (yes/no), number of topic files on disk, number selected this session.

**Main — memory event timeline:**
Vertical timeline showing all memory interactions in chronological order. Each event is a card:

- **Loaded at session start**: file name, type badge (user/feedback/project/reference), size, age
- **Selected by Sonnet**: file name, turn number when selected, which user query triggered it
- **Written by extractMemories**: file name, what was written (content preview), turn that triggered it
- **Written by autoDream**: file name, what changed (diff preview if update, full preview if new)
- **Written by user**: file name, content preview

Color-code by source: blue for session start, green for Sonnet selection, orange for extractMemories, purple for autoDream, gray for user.

**Right panel — active memories this session:**
List of all memory files that have been loaded or selected during this session. For each: name, type, last selected turn, age, size. Sort by most recently selected.

**Bottom — stale memory warnings:**
List of memories older than 7 days that were selected during this session. Flag for review.

## Anomaly detection

Simple statistical approach. No ML needed:

```typescript
function detectAnomalies(turns: Turn[]): CostAnomaly[] {
  const anomalies: CostAnomaly[] = []
  const window = 10 // rolling window size
  const threshold = 3 // multiplier to flag

  for (let i = window; i < turns.length; i++) {
    const recent = turns.slice(i - window, i)
    const avg = recent.reduce((sum, t) => sum + t.cost_usd, 0) / window

    if (avg === 0) continue
    const multiplier = turns[i].cost_usd / avg

    if (multiplier >= threshold) {
      anomalies.push({
        turnNumber: turns[i].turn_number,
        timestamp: turns[i].timestamp,
        anomalyType: classifyAnomaly(turns[i]),
        actualCost: turns[i].cost_usd,
        expectedCost: avg,
        multiplier,
        description: describeAnomaly(turns[i], avg),
      })
    }
  }
  return anomalies
}

function classifyAnomaly(turn: Turn): string {
  // Cache miss: high input tokens, low cache read
  if (turn.cache_read_tokens < turn.input_tokens * 0.1) return "cache_miss"
  // Large tool result: check associated tool calls
  if (turn.input_tokens > 50_000) return "large_tool_result"
  // Background process
  if (turn.is_background_process) return "background_overhead"
  return "high_cost_turn"
}
```

## Rate limit projection

Estimate time to rate limit based on burn rate:

```typescript
function projectRateLimit(session: Session, turns: Turn[]): RateLimitProjection | null {
  if (turns.length < 3) return null

  // Calculate burn rate from last 5 minutes of turns
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  const recentTurns = turns.filter(t => t.timestamp > fiveMinAgo)
  if (recentTurns.length < 2) return null

  const timeSpanMs = recentTurns[recentTurns.length - 1].timestamp - recentTurns[0].timestamp
  if (timeSpanMs === 0) return null

  const tokensBurned = recentTurns.reduce((sum, t) => sum + t.input_tokens + t.output_tokens, 0)
  const tokensPerMinute = (tokensBurned / timeSpanMs) * 60_000

  // Known rate limits (approximate, from public documentation)
  // These are rough and vary by plan — make configurable
  const limits = {
    "max-5x": { tokensPerFiveHours: 50_000_000 },
    "max-20x": { tokensPerFiveHours: 200_000_000 },
    "pro": { tokensPerFiveHours: 10_000_000 },
  }

  const plan = getPlanFromConfig() ?? "pro"
  const limit = limits[plan]
  if (!limit) return null

  const tokensRemaining = limit.tokensPerFiveHours - session.total_input_tokens - session.total_output_tokens
  const minutesRemaining = tokensRemaining / tokensPerMinute

  return {
    tokensPerMinute: Math.round(tokensPerMinute),
    estimatedMinutesRemaining: Math.round(minutesRemaining),
    confidence: recentTurns.length >= 5 ? "high" : "low",
  }
}
```

## Project structure

```
agentdog/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── justfile
├── README.md
├── src-tauri/                        # Tauri Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json               # app name, window config, tray icon
│   ├── src/
│   │   ├── main.rs                   # entry point
│   │   ├── tray.rs                   # system tray icon + menu
│   │   └── notifications.rs          # native macOS notifications
│   └── icons/                        # app icons for menu bar and dock
├── src/
│   ├── server/
│   │   ├── index.ts                  # entry point, starts server + session manager
│   │   ├── app.ts                    # Hono app with routes
│   │   ├── db.ts                     # SQLite setup and migrations
│   │   ├── routes/
│   │   │   ├── sessions.ts
│   │   │   ├── events.ts
│   │   │   └── health.ts
│   │   └── ws.ts                     # WebSocket broadcast with session filtering
│   ├── core/
│   │   ├── session-discovery.ts      # scan ~/.claude/projects/, detect active sessions
│   │   ├── session-manager.ts        # lifecycle: spawn/teardown parsers and watchers
│   │   ├── transcript-parser.ts      # JSONL watcher and parser (one per session)
│   │   ├── event-collector.ts        # hook event processing
│   │   ├── memory-watcher.ts         # fs.watch on memory dir (one per project)
│   │   ├── anomaly-detector.ts       # cost anomaly detection
│   │   ├── rate-projector.ts         # rate limit projection
│   │   ├── context-analyzer.ts       # context composition extraction
│   │   └── model-pricing.ts          # pricing tables
│   ├── hooks/
│   │   ├── hook.sh                   # fast hook script
│   │   └── setup.ts                  # install hooks into settings.json
│   └── client/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── Layout.tsx            # sidebar + main content
│       │   ├── SessionList.tsx       # sidebar with active/recent/historical grouping
│       │   ├── TopBar.tsx            # selected session summary + rate limit warning
│       │   ├── cost/
│       │   │   ├── CostTab.tsx
│       │   │   ├── CostChart.tsx           # stacked bar chart
│       │   │   ├── CostSummaryCards.tsx
│       │   │   ├── AnomalyLog.tsx
│       │   │   └── ToolCostRanking.tsx
│       │   ├── context/
│       │   │   ├── ContextTab.tsx
│       │   │   ├── ContextChart.tsx        # stacked area chart
│       │   │   ├── ContextBreakdown.tsx    # current composition
│       │   │   ├── CompactionLog.tsx
│       │   │   └── ContextWarning.tsx
│       │   └── memory/
│       │       ├── MemoryTab.tsx
│       │       ├── MemoryTimeline.tsx
│       │       ├── MemoryStatus.tsx        # MEMORY.md status card
│       │       ├── ActiveMemories.tsx
│       │       └── StaleMemoryWarnings.tsx
│       ├── hooks/
│       │   ├── use-websocket.ts
│       │   ├── use-sessions.ts
│       │   └── use-turns.ts
│       └── lib/
│           ├── api.ts                # fetch wrapper
│           └── format.ts             # number/token/cost formatters
├── __tests__/
│   ├── session-discovery.test.ts
│   ├── transcript-parser.test.ts
│   ├── anomaly-detector.test.ts
│   ├── context-analyzer.test.ts
│   └── memory-watcher.test.ts
└── fixtures/
    ├── sample-transcript.jsonl       # real transcript for testing
    └── sample-hooks/                 # sample hook payloads
```

## Implementation order

### Phase 1: session discovery + transcript parser + cost view (web)

Build as a web app first (no Tauri yet). Get session discovery scanning all projects. Get the transcript parser working with real JSONL files. Stand up the Hono server with SQLite. Build the Cost tab with per-turn stacked bar chart and summary cards. Build the session list sidebar with active/recent grouping.

Deliverable: user runs `npx agentdog`, opens `localhost:4982`, sees all active sessions with per-turn cost breakdown. Multiple simultaneous sessions show up automatically.

### Phase 2: hook integration + context view

Add hook installation CLI (`npx agentdog setup`). Process PostCompact and SubagentStart/Stop events. Build the context composition extraction from system prompt content. Build the Context tab with the stacked area chart and compaction log.

Deliverable: user sees context window composition over time, compaction events, and gets a warning when context is nearly full.

### Phase 3: memory watcher + memory view

Add fs.watch on memory directories (one per project with active sessions). Correlate with SubagentStart/Stop hooks to attribute writes to extractMemories vs autoDream vs user. Build the Memory tab with the event timeline and MEMORY.md status card.

Deliverable: user sees which memories were loaded, when, and by what process.

### Phase 4: anomaly detection + rate limit projection

Add the rolling-average anomaly detector. Add rate limit projection based on burn rate. Add anomaly log to Cost tab. Add rate limit countdown to the top bar.

Deliverable: user gets proactive warnings about unusual cost and time-to-rate-limit.

### Phase 5: Tauri Mac app

Wrap the working web app in Tauri. Add the system tray icon with cost/context readout. Add native macOS notifications for anomalies and compaction warnings. Add the floating panel window behavior. Package as DMG and Homebrew cask.

Deliverable: user installs via `brew install --cask agentdog`, the app lives in the menu bar, all sessions are monitored automatically from the moment the app launches.

### Phase 6 (stretch): cross-session analytics

Add historical analytics across sessions: daily/weekly cost trends, cost per project, average session length, most expensive tool calls across all sessions, compaction frequency trends. This is the data that helps users answer "is my usage normal" and "what's changed since last week."

## Open questions

1. **Transcript format stability.** The JSONL format is internal to Claude Code and not documented as a public API. It could change between versions. The parser should be defensive and skip lines it doesn't understand rather than crashing. Version-detect by checking for known field patterns.

2. **Hook latency budget.** Claude Code hooks should complete in under 50ms to avoid slowing the agent. The bash script backgrounds the curl, so this should be fine. Test on slow machines.

3. **Disk usage.** Storing every turn's data in SQLite could grow large for heavy users. Add a retention policy: keep detailed per-turn data for 30 days, aggregate into daily summaries beyond that. The SQLite database lives at `~/.agentdog/data.sqlite`.

4. **Privacy.** The transcript contains full conversation content, tool inputs, and tool outputs. The dashboard should NOT display conversation content, only metadata (token counts, tool names, cost). The SQLite database should not store message text. Tool inputs are truncated to 500 chars in the tool_calls table for context (e.g., file paths) but not full content.

5. **Rate limit accuracy.** The rate limit numbers used for projection are approximate. Different plans have different limits, and Anthropic doesn't publish exact token budgets. Make the limits configurable in preferences and default to conservative estimates.

6. **Tauri vs Electron.** The PRD specifies Tauri for smaller binary size and native feel. If the team doesn't have Rust experience, Electron is a viable fallback. The web dashboard code is identical either way. Decision can be deferred to Phase 5.

7. **Session ID collision.** Claude Code uses UUIDs for session IDs. Collisions are practically impossible, but the SQLite schema uses session ID as primary key. If a collision somehow occurs (e.g., file copied), the parser should detect and skip rather than overwrite.

8. **File descriptor limits.** With many active projects, fs.watch instances accumulate (one per session JSONL, one per memory directory). On macOS the default ulimit is 256. If users have 20+ active projects, this could be a problem. Use a single recursive watcher on `~/.claude/projects/` instead of per-directory watchers if fd count becomes an issue.
