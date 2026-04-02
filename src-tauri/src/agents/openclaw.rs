use crate::agent::{AgentBackend, AgentFeature, AgentParser, AgentType, DiscoveredSession};
use crate::parser::{
    truncate_str, ParseEvent, ParsedAnomaly, ParsedCompaction, ParsedToolCall, ParsedTurn,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::SystemTime;

// ─── Backend ───

pub struct OpenClawBackend;

impl AgentBackend for OpenClawBackend {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenClaw
    }

    fn discover_sessions(&self) -> Vec<DiscoveredSession> {
        let openclaw_dir = match dirs::home_dir() {
            Some(h) => h.join(".openclaw"),
            None => return vec![],
        };

        if !openclaw_dir.exists() {
            return vec![];
        }

        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let mut results = Vec::new();

        // Scan all agents under ~/.openclaw/agents/
        let agents_dir = openclaw_dir.join("agents");
        if !agents_dir.exists() {
            return vec![];
        }

        let agent_entries = match std::fs::read_dir(&agents_dir) {
            Ok(rd) => rd,
            Err(_) => return vec![],
        };

        for agent_entry in agent_entries.flatten() {
            if !agent_entry.path().is_dir() {
                continue;
            }
            let agent_name = agent_entry.file_name().to_string_lossy().to_string();
            let sessions_dir = agent_entry.path().join("sessions");
            if !sessions_dir.exists() {
                continue;
            }

            // Read sessions.json for metadata (tokens, costs, model info)
            let session_meta = load_sessions_json(&sessions_dir);

            // Scan for .jsonl transcript files
            let files = match std::fs::read_dir(&sessions_dir) {
                Ok(rd) => rd,
                Err(_) => continue,
            };

            for file_entry in files.flatten() {
                let fname = file_entry.file_name().to_string_lossy().to_string();

                // Match primary transcript files: {sessionId}.jsonl
                // Skip archive artifacts like {sessionId}.jsonl.deleted.{timestamp}
                if !fname.ends_with(".jsonl") || fname.contains(".jsonl.") {
                    continue;
                }

                let file_path = file_entry.path();
                let metadata = match file_path.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let mtime_ms = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);

                let idle_ms = now_ms - mtime_ms;
                if idle_ms > 30 * 60 * 1000 {
                    continue;
                }

                let session_key = fname.trim_end_matches(".jsonl").to_string();

                // Look up metadata from sessions.json
                let meta = session_meta.get(&session_key);
                let session_id_from_meta = meta
                    .and_then(|m| m.get("sessionId").and_then(|v| v.as_str()))
                    .map(|s| s.to_string());

                let project_name = if agent_name == "main" {
                    "OpenClaw".to_string()
                } else {
                    format!("OpenClaw/{}", agent_name)
                };

                let model = meta
                    .and_then(|m| m.get("model").and_then(|v| v.as_str()))
                    .map(|s| s.to_string());

                let display_session_id = session_id_from_meta
                    .unwrap_or_else(|| format!("openclaw-{}-{}", agent_name, session_key));

                results.push(DiscoveredSession {
                    session_id: display_session_id,
                    agent_type: AgentType::OpenClaw,
                    project_dir: format!("openclaw/{}", agent_name),
                    project_name,
                    transcript_path: file_path.to_string_lossy().to_string(),
                    last_modified: mtime_ms,
                    is_active: idle_ms < 5 * 60 * 1000,
                    is_recent: idle_ms < 30 * 60 * 1000,
                });

                let _ = model; // model extracted from sessions.json, parser gets it from transcript
            }
        }

        results.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        results
    }

    fn create_parser(&self, session_id: &str) -> Box<dyn AgentParser> {
        Box::new(OpenClawParser::new(session_id.to_string()))
    }

    fn supports_feature(&self, feature: AgentFeature) -> bool {
        matches!(
            feature,
            AgentFeature::CostTracking | AgentFeature::CacheTokens
        )
    }

    fn memory_dir(&self, _project_dir: &str) -> Option<PathBuf> {
        None
    }
}

/// Load sessions.json from a sessions directory.
fn load_sessions_json(sessions_dir: &PathBuf) -> HashMap<String, Value> {
    let path = sessions_dir.join("sessions.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str::<HashMap<String, Value>>(&content).unwrap_or_default()
        }
        Err(_) => HashMap::new(),
    }
}

// ─── Parser ───

/// OpenClaw JSONL transcript format:
/// Line 1: { "type": "session", "version": 1, "id": "session-id" }
/// Messages: { "message": { "role": "user"|"assistant", "content": "...",
///              "provider": "openai", "model": "gpt-5.4",
///              "usage": { "input": N, "output": N, "cacheRead": N, "cacheWrite": N,
///                         "cost": { "total": 0.0042 } },
///              "toolName": "..." } }
/// Tool blocks in content: [{ "type": "tool_use", "name": "read" }]
pub struct OpenClawParser {
    session_id: String,
    turn_number: i64,
    cumulative_input_tokens: i64,
    cumulative_output_tokens: i64,
    cumulative_cache_read_tokens: i64,
    cumulative_cache_write_tokens: i64,
    cumulative_cost_usd: f64,
    model: Option<String>,
    recent_turn_costs: Vec<f64>,
}

impl OpenClawParser {
    pub fn new(session_id: String) -> Self {
        Self {
            session_id,
            turn_number: 0,
            cumulative_input_tokens: 0,
            cumulative_output_tokens: 0,
            cumulative_cache_read_tokens: 0,
            cumulative_cache_write_tokens: 0,
            cumulative_cost_usd: 0.0,
            model: None,
            recent_turn_costs: Vec::new(),
        }
    }
}

impl AgentParser for OpenClawParser {
    fn process_line(&mut self, line: &Value) -> Vec<ParseEvent> {
        let mut events = Vec::new();

        // Skip session header line
        let line_type = line.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if line_type == "session" {
            return events;
        }

        // Detect compaction events
        if line_type == "compaction" {
            let timestamp = line
                .get("timestamp")
                .and_then(|v| v.as_str())
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.timestamp_millis())
                .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
            let tokens_before = line.get("tokensBefore").and_then(|v| v.as_i64()).unwrap_or(0);
            let tokens_after = line.get("tokensAfter").and_then(|v| v.as_i64()).unwrap_or(0);
            events.push(ParseEvent::Compaction(ParsedCompaction {
                session_id: self.session_id.clone(),
                timestamp,
                tokens_before,
                tokens_after,
                tokens_saved: tokens_before - tokens_after,
            }));
            return events;
        }

        let message = match line.get("message") {
            Some(m) => m,
            None => return events,
        };

        let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("");

        // Extract timestamp from line or message
        let timestamp = line
            .get("timestamp")
            .or_else(|| message.get("timestamp"))
            .and_then(|v| {
                v.as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.timestamp_millis())
                    .or_else(|| v.as_i64())
                    .or_else(|| v.as_f64().map(|f| f as i64))
            })
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        if role == "assistant" {
            // Skip delivery mirrors
            let provider = message.get("provider").and_then(|v| v.as_str()).unwrap_or("");
            if provider == "openclaw" {
                let model_name = message.get("model").and_then(|v| v.as_str()).unwrap_or("");
                if model_name == "delivery-mirror" {
                    return events;
                }
            }

            // Extract model info
            if let Some(model) = message.get("model").and_then(|v| v.as_str()) {
                if !model.is_empty() && model != "delivery-mirror" {
                    self.model = Some(model.to_string());
                }
            }

            // Extract usage data
            let usage = message.get("usage");
            let input_tokens = usage
                .and_then(|u| u.get("input").and_then(|v| v.as_i64()))
                .unwrap_or(0);
            let output_tokens = usage
                .and_then(|u| u.get("output").and_then(|v| v.as_i64()))
                .unwrap_or(0);
            let cache_read = usage
                .and_then(|u| u.get("cacheRead").and_then(|v| v.as_i64()))
                .unwrap_or(0);
            let cache_write = usage
                .and_then(|u| u.get("cacheWrite").and_then(|v| v.as_i64()))
                .unwrap_or(0);
            let cost = usage
                .and_then(|u| u.get("cost"))
                .and_then(|c| c.get("total").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);

            self.turn_number += 1;
            self.cumulative_input_tokens += input_tokens;
            self.cumulative_output_tokens += output_tokens;
            self.cumulative_cache_read_tokens += cache_read;
            self.cumulative_cache_write_tokens += cache_write;
            self.cumulative_cost_usd += cost;

            // Anomaly detection
            if cost > 0.0 {
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
            }

            // Extract tool calls from content blocks
            if let Some(content) = message.get("content").and_then(|v| v.as_array()) {
                for block in content {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    if block_type == "tool_use" || block_type == "tool_call" {
                        let tool_name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let tool_id = block
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let input_str = block
                            .get("input")
                            .map(|v| v.to_string())
                            .unwrap_or_default();
                        let input_summary = truncate_str(&input_str, 500).to_string();

                        events.push(ParseEvent::ToolCall(ParsedToolCall {
                            session_id: self.session_id.clone(),
                            id: if tool_id.is_empty() {
                                format!("oc-{}-{}", self.turn_number, tool_name)
                            } else {
                                tool_id
                            },
                            name: tool_name,
                            input_summary,
                            turn_number: self.turn_number,
                            timestamp,
                        }));
                    }
                }
            }

            // Also check for toolName field (shorthand in OpenClaw)
            if let Some(tool_name) = message.get("toolName").and_then(|v| v.as_str()) {
                if !tool_name.is_empty() {
                    // Only emit if we didn't already extract from content blocks
                    let already_emitted = events.iter().any(|e| matches!(e, ParseEvent::ToolCall(_)));
                    if !already_emitted {
                        events.push(ParseEvent::ToolCall(ParsedToolCall {
                            session_id: self.session_id.clone(),
                            id: format!("oc-{}-{}", self.turn_number, tool_name),
                            name: tool_name.to_string(),
                            input_summary: String::new(),
                            turn_number: self.turn_number,
                            timestamp,
                        }));
                    }
                }
            }

            let model_str = self.model.clone().unwrap_or_else(|| "unknown".to_string());

            events.push(ParseEvent::Turn(ParsedTurn {
                session_id: self.session_id.clone(),
                turn_number: self.turn_number,
                timestamp,
                model: model_str,
                input_tokens,
                output_tokens,
                cache_read_tokens: cache_read,
                cache_write_tokens: cache_write,
                cost_usd: cost,
                context_tokens_estimate: input_tokens + cache_read + cache_write,
                stop_reason: None,
                is_background_process: false,
                background_process_type: None,
                cumulative_cost_usd: self.cumulative_cost_usd,
            }));
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
