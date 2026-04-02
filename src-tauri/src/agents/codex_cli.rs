use crate::agent::{AgentBackend, AgentFeature, AgentParser, AgentType, DiscoveredSession};
use crate::parser::{
    truncate_str, ParseEvent, ParsedAnomaly, ParsedCompaction, ParsedRateLimit, ParsedToolCall, ParsedToolResult, ParsedTurn,
};
use crate::pricing::calculate_cost;
use serde_json::Value;
use std::path::PathBuf;
use std::time::SystemTime;

// ─── Backend ───

pub struct CodexCliBackend;

impl AgentBackend for CodexCliBackend {
    fn agent_type(&self) -> AgentType {
        AgentType::CodexCli
    }

    fn discover_sessions(&self) -> Vec<DiscoveredSession> {
        let codex_dir = match dirs::home_dir() {
            Some(h) => h.join(".codex"),
            None => return vec![],
        };

        if !codex_dir.exists() {
            return vec![];
        }

        let now_s = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let mut results = Vec::new();
        let mut seen_paths = std::collections::HashSet::new();

        // Primary: discover from SQLite state DB (has all sessions, even before JSONL is written)
        let db_path = codex_dir.join("state_5.sqlite");
        if db_path.exists() {
            if let Ok(conn) = rusqlite::Connection::open_with_flags(
                &db_path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                let cutoff = now_s - 30 * 60; // 30 min ago
                let mut stmt = conn
                    .prepare(
                        "SELECT id, rollout_path, cwd, updated_at, source, model_provider, tokens_used
                         FROM threads
                         WHERE archived = 0 AND updated_at > ?1
                         ORDER BY updated_at DESC",
                    )
                    .ok();

                if let Some(ref mut stmt) = stmt {
                    let rows = stmt.query_map(rusqlite::params![cutoff], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    });

                    if let Ok(rows) = rows {
                        for row in rows.flatten() {
                            let (id, rollout_path, cwd, updated_at, _source, _provider, _tokens) = row;
                            let updated_ms = updated_at * 1000;
                            let idle_s = now_s - updated_at;

                            // Use the rollout filename as session ID for consistency
                            let session_id = std::path::Path::new(&rollout_path)
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or(id);

                            let project_name = shorten_home(&cwd);

                            seen_paths.insert(rollout_path.clone());

                            results.push(DiscoveredSession {
                                session_id,
                                agent_type: AgentType::CodexCli,
                                project_dir: project_name.clone(),
                                project_name,
                                transcript_path: rollout_path,
                                last_modified: updated_ms,
                                is_active: idle_s < 5 * 60,
                                is_recent: idle_s < 30 * 60,
                            });
                        }
                    }
                }
            }
        }

        // Fallback: scan JSONL files (for sessions not yet in SQLite, or if DB is unavailable)
        let sessions_dir = codex_dir.join("sessions");
        if sessions_dir.exists() {
            discover_jsonl_sessions(&sessions_dir, now_s, &mut results, &mut seen_paths);
        }

        results.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        results
    }

    fn create_parser(&self, session_id: &str) -> Box<dyn AgentParser> {
        Box::new(CodexCliParser::new(session_id.to_string()))
    }

    fn supports_feature(&self, feature: AgentFeature) -> bool {
        matches!(feature, AgentFeature::CostTracking | AgentFeature::CacheTokens | AgentFeature::Compactions)
    }

    fn memory_dir(&self, _project_dir: &str) -> Option<PathBuf> {
        None
    }
}

fn shorten_home(path: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if path.starts_with(home_str.as_ref()) {
            return format!("~{}", &path[home_str.len()..]);
        }
    }
    path.to_string()
}

/// Walk YYYY/MM/DD directory tree for rollout JSONL files.
fn discover_jsonl_sessions(
    sessions_dir: &PathBuf,
    now_s: i64,
    results: &mut Vec<DiscoveredSession>,
    seen_paths: &mut std::collections::HashSet<String>,
) {
    let years = match std::fs::read_dir(sessions_dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for year_entry in years.flatten() {
        if !year_entry.path().is_dir() { continue; }
        let months = match std::fs::read_dir(year_entry.path()) { Ok(rd) => rd, Err(_) => continue };
        for month_entry in months.flatten() {
            if !month_entry.path().is_dir() { continue; }
            let days = match std::fs::read_dir(month_entry.path()) { Ok(rd) => rd, Err(_) => continue };
            for day_entry in days.flatten() {
                if !day_entry.path().is_dir() { continue; }
                let files = match std::fs::read_dir(day_entry.path()) { Ok(rd) => rd, Err(_) => continue };
                for file_entry in files.flatten() {
                    let fname = file_entry.file_name().to_string_lossy().to_string();
                    if !fname.starts_with("rollout-") || !fname.ends_with(".jsonl") { continue; }

                    let file_path = file_entry.path();
                    let path_str = file_path.to_string_lossy().to_string();

                    // Skip if already found via SQLite
                    if seen_paths.contains(&path_str) { continue; }

                    let metadata = match file_path.metadata() { Ok(m) => m, Err(_) => continue };
                    let mtime_s = metadata.modified().ok()
                        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);

                    let idle_s = now_s - mtime_s;
                    if idle_s > 30 * 60 { continue; }

                    let session_id = fname.trim_end_matches(".jsonl").to_string();
                    let project_name = read_session_cwd(&file_path)
                        .unwrap_or_else(|| "Codex CLI".to_string());

                    results.push(DiscoveredSession {
                        session_id,
                        agent_type: AgentType::CodexCli,
                        project_dir: project_name.clone(),
                        project_name,
                        transcript_path: path_str,
                        last_modified: mtime_s * 1000,
                        is_active: idle_s < 5 * 60,
                        is_recent: idle_s < 30 * 60,
                    });
                }
            }
        }
    }
}

/// Read the cwd from the session_meta line (first line of the file).
fn read_session_cwd(path: &PathBuf) -> Option<String> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    for line_result in reader.lines() {
        let line_str = line_result.ok()?;
        if let Ok(obj) = serde_json::from_str::<Value>(&line_str) {
            if obj.get("type").and_then(|v| v.as_str()) == Some("session_meta") {
                if let Some(cwd) = obj.pointer("/payload/cwd").and_then(|v| v.as_str()) {
                    return Some(shorten_home(cwd));
                }
            }
        }
        break;
    }
    None
}

// ─── Parser ───

/// Codex CLI JSONL format:
///
/// Each line: { "timestamp": "...", "type": "...", "payload": {...} }
///
/// Key event types:
/// - `session_meta`: Session metadata (cwd, source, model_provider, git info)
/// - `turn_context`: Per-turn context (model name, cwd, policies)
/// - `event_msg`: Lifecycle events with subtypes:
///   - `task_started`: Turn begins (has model_context_window)
///   - `token_count`: Token usage (total_token_usage + last_token_usage)
///   - `task_complete`: Turn ends
///   - `user_message`, `agent_message`
/// - `response_item`: Model responses with subtypes:
///   - `function_call`: Tool invocation (name, arguments, call_id)
///   - `function_call_output`: Tool result (output, call_id)
///   - `local_shell_call`: Shell command execution
///   - `message`: Text response (role, content)
///   - `reasoning`: Reasoning blocks
/// - `compacted`: Conversation compaction event
///
/// Token accounting:
/// - `input_tokens` includes `cached_input_tokens` (cache is a subset)
/// - `last_token_usage` is per-API-call, not per-turn
/// - Multiple `token_count` events can occur within a single turn
/// - `total_token_usage` is cumulative across the entire session
pub struct CodexCliParser {
    session_id: String,
    turn_number: i64,
    // Track cumulative from total_token_usage (authoritative)
    last_seen_total_input: i64,
    last_seen_total_output: i64,
    last_seen_total_cached: i64,
    cumulative_cost_usd: f64,
    model: Option<String>,
    model_context_window: Option<i64>,
    recent_turn_costs: Vec<f64>,
    // Pending tool calls collected during a turn, emitted at turn end
    pending_tool_calls: Vec<ParseEvent>,
    // Track whether we're inside a turn (between task_started and task_complete/next token_count)
    in_turn: bool,
    // Last token_count snapshot to compute per-turn deltas
    prev_total_input: i64,
    prev_total_output: i64,
    prev_total_cached: i64,
}

impl CodexCliParser {
    pub fn new(session_id: String) -> Self {
        Self {
            session_id,
            turn_number: 0,
            last_seen_total_input: 0,
            last_seen_total_output: 0,
            last_seen_total_cached: 0,
            cumulative_cost_usd: 0.0,
            model: None,
            model_context_window: None,
            recent_turn_costs: Vec::new(),
            pending_tool_calls: Vec::new(),
            in_turn: false,
            prev_total_input: 0,
            prev_total_output: 0,
            prev_total_cached: 0,
        }
    }
}

impl AgentParser for CodexCliParser {
    fn process_line(&mut self, line: &Value) -> Vec<ParseEvent> {
        let mut events = Vec::new();
        let line_type = line.get("type").and_then(|v| v.as_str()).unwrap_or("");

        let timestamp = line
            .get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.timestamp_millis())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        match line_type {
            "session_meta" => {
                // model_provider is the provider, not the model name
                // Actual model comes from turn_context
            }

            "turn_context" => {
                if let Some(model) = line.pointer("/payload/model").and_then(|v| v.as_str()) {
                    self.model = Some(model.to_string());
                }
            }

            "event_msg" => {
                let payload = line.get("payload").unwrap_or(line);
                let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match event_type {
                    "task_started" => {
                        self.in_turn = true;
                        // Snapshot current totals as baseline for this turn
                        self.prev_total_input = self.last_seen_total_input;
                        self.prev_total_output = self.last_seen_total_output;
                        self.prev_total_cached = self.last_seen_total_cached;

                        if let Some(ctx_window) = payload.get("model_context_window").and_then(|v| v.as_i64()) {
                            self.model_context_window = Some(ctx_window);
                        }
                    }

                    "token_count" => {
                        // Extract total (cumulative) token usage — this is authoritative
                        if let Some(info) = payload.get("info") {
                            if let Some(total_usage) = info.get("total_token_usage") {
                                self.last_seen_total_input = total_usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(self.last_seen_total_input);
                                self.last_seen_total_output = total_usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(self.last_seen_total_output);
                                self.last_seen_total_cached = total_usage.get("cached_input_tokens").and_then(|v| v.as_i64()).unwrap_or(self.last_seen_total_cached);
                            }

                            if let Some(ctx_window) = info.get("model_context_window").and_then(|v| v.as_i64()) {
                                self.model_context_window = Some(ctx_window);
                            }
                        }

                        // Extract rate limits
                        if let Some(rl) = payload.get("rate_limits") {
                            let primary = rl.get("primary");
                            let secondary = rl.get("secondary");
                            events.push(ParseEvent::RateLimit(ParsedRateLimit {
                                session_id: self.session_id.clone(),
                                timestamp,
                                plan_type: rl.get("plan_type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                primary_used_percent: primary.and_then(|p| p.get("used_percent").and_then(|v| v.as_f64())),
                                primary_resets_at: primary.and_then(|p| p.get("resets_at").and_then(|v| v.as_i64())),
                                secondary_used_percent: secondary.and_then(|p| p.get("used_percent").and_then(|v| v.as_f64())),
                                secondary_resets_at: secondary.and_then(|p| p.get("resets_at").and_then(|v| v.as_i64())),
                            }));
                        }
                    }

                    "task_complete" => {
                        if !self.in_turn {
                            return events;
                        }
                        self.in_turn = false;

                        // Compute per-turn deltas from total usage snapshots
                        let delta_input = self.last_seen_total_input - self.prev_total_input;
                        let delta_output = self.last_seen_total_output - self.prev_total_output;
                        let delta_cached = self.last_seen_total_cached - self.prev_total_cached;

                        if delta_input == 0 && delta_output == 0 {
                            // No actual API calls in this turn — skip
                            return events;
                        }

                        let model = self.model.clone().unwrap_or_else(|| "unknown".to_string());

                        // cached_input_tokens is a SUBSET of input_tokens in Codex
                        // For cost: charge non-cached input at full rate, cached at cache rate
                        let non_cached_input = delta_input - delta_cached;
                        let cost = calculate_cost(non_cached_input, delta_output, 0, delta_cached, &model);

                        self.turn_number += 1;
                        self.cumulative_cost_usd += cost;

                        // Anomaly detection
                        self.recent_turn_costs.push(cost);
                        if self.recent_turn_costs.len() > 10 {
                            self.recent_turn_costs.remove(0);
                        }
                        if self.recent_turn_costs.len() >= 3 {
                            let avg: f64 = self.recent_turn_costs.iter().sum::<f64>()
                                / self.recent_turn_costs.len() as f64;
                            if avg > 0.0 && cost > avg * 3.0 {
                                events.push(ParseEvent::Anomaly(ParsedAnomaly {
                                    session_id: self.session_id.clone(),
                                    turn_number: self.turn_number,
                                    timestamp,
                                    actual_cost: cost,
                                    expected_cost: avg,
                                    multiplier: cost / avg,
                                }));
                            }
                        }

                        // Emit pending tool calls with correct turn number
                        for tc in self.pending_tool_calls.drain(..) {
                            match tc {
                                ParseEvent::ToolCall(mut tool) => {
                                    tool.turn_number = self.turn_number;
                                    events.push(ParseEvent::ToolCall(tool));
                                }
                                ParseEvent::ToolResult(tr) => {
                                    events.push(ParseEvent::ToolResult(tr));
                                }
                                other => events.push(other),
                            }
                        }

                        // Context estimate: input_tokens is the full context sent to the model
                        // (includes cached portion)
                        let context_estimate = delta_input;

                        events.push(ParseEvent::Turn(ParsedTurn {
                            session_id: self.session_id.clone(),
                            turn_number: self.turn_number,
                            timestamp,
                            model: model.clone(),
                            input_tokens: non_cached_input,
                            output_tokens: delta_output,
                            cache_read_tokens: delta_cached,
                            cache_write_tokens: 0,
                            cost_usd: cost,
                            context_tokens_estimate: context_estimate,
                            stop_reason: None,
                            is_background_process: false,
                            background_process_type: None,
                            cumulative_cost_usd: self.cumulative_cost_usd,
                        }));
                    }

                    _ => {}
                }
            }

            "response_item" => {
                let payload = line.get("payload").unwrap_or(line);
                let item_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match item_type {
                    "function_call" => {
                        let call_id = payload.get("call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let args = payload.get("arguments").and_then(|v| v.as_str()).unwrap_or("");
                        let input_summary = truncate_str(args, 500).to_string();

                        self.pending_tool_calls.push(ParseEvent::ToolCall(ParsedToolCall {
                            session_id: self.session_id.clone(),
                            id: call_id,
                            name,
                            input_summary,
                            turn_number: 0, // Will be set at task_complete
                            timestamp,
                        }));
                    }

                    "local_shell_call" => {
                        let call_id = payload.get("call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let action = payload.get("action");
                        let command = action
                            .and_then(|a| a.get("command").and_then(|v| v.as_str()))
                            .unwrap_or("");
                        let input_summary = truncate_str(command, 500).to_string();

                        self.pending_tool_calls.push(ParseEvent::ToolCall(ParsedToolCall {
                            session_id: self.session_id.clone(),
                            id: call_id,
                            name: "shell".to_string(),
                            input_summary,
                            turn_number: 0,
                            timestamp,
                        }));
                    }

                    "function_call_output" => {
                        let call_id = payload.get("call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let output = payload.get("output").and_then(|v| v.as_str()).unwrap_or("");

                        self.pending_tool_calls.push(ParseEvent::ToolResult(ParsedToolResult {
                            session_id: self.session_id.clone(),
                            tool_use_id: call_id,
                            output_size_bytes: output.len() as i64,
                            timestamp,
                        }));
                    }

                    _ => {}
                }
            }

            "compacted" => {
                events.push(ParseEvent::Compaction(ParsedCompaction {
                    session_id: self.session_id.clone(),
                    timestamp,
                    tokens_before: 0,
                    tokens_after: 0,
                    tokens_saved: 0,
                }));
            }

            _ => {}
        }

        events
    }

    fn session_id(&self) -> &str {
        &self.session_id
    }

    fn turn_number(&self) -> i64 {
        self.turn_number
    }

    fn model(&self) -> Option<&str> {
        self.model.as_deref()
    }
}
