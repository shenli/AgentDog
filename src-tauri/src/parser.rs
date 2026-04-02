use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

// ─── Shared event types used by all agent parsers ───

#[derive(Debug, Clone, Serialize)]
pub struct ParsedTurn {
    pub session_id: String,
    pub turn_number: i64,
    pub timestamp: i64,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost_usd: f64,
    pub context_tokens_estimate: i64,
    pub stop_reason: Option<String>,
    pub is_background_process: bool,
    pub background_process_type: Option<String>,
    pub cumulative_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedToolCall {
    pub session_id: String,
    pub id: String,
    pub name: String,
    pub input_summary: String,
    pub turn_number: i64,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedToolResult {
    pub session_id: String,
    pub tool_use_id: String,
    pub output_size_bytes: i64,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedAnomaly {
    pub session_id: String,
    pub turn_number: i64,
    pub timestamp: i64,
    pub actual_cost: f64,
    pub expected_cost: f64,
    pub multiplier: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedContextSnapshot {
    pub session_id: String,
    pub turn_number: i64,
    pub timestamp: i64,
    pub system_prompt_tokens: i64,
    pub config_file_tokens: i64,
    pub agent_memory_tokens: i64,
    pub memory_topic_tokens: i64,
    pub conversation_tokens: i64,
    pub tool_result_tokens: i64,
    pub available_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedCompaction {
    pub session_id: String,
    pub timestamp: i64,
    pub tokens_before: i64,
    pub tokens_after: i64,
    pub tokens_saved: i64,
}

pub enum ParseEvent {
    Turn(ParsedTurn),
    ToolCall(ParsedToolCall),
    ToolResult(ParsedToolResult),
    Anomaly(ParsedAnomaly),
    ContextSnapshot(ParsedContextSnapshot),
    Compaction(ParsedCompaction),
}

// ─── Shared utilities ───

/// Truncate a string to at most `max_bytes` bytes at a valid UTF-8 char boundary.
pub fn truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Rough token estimate: 1 token per ~4 characters
#[allow(dead_code)]
pub fn estimate_tokens(text: &str) -> i64 {
    (text.len() as f64 / 4.0).ceil() as i64
}

/// Parse an entire JSONL file using a given parser, processing events via callback.
pub fn parse_transcript_file<F>(
    parser: &mut dyn crate::agent::AgentParser,
    path: &Path,
    mut on_event: F,
) where
    F: FnMut(ParseEvent),
{
    use std::io::BufRead;

    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let reader = std::io::BufReader::new(file);

    for line_result in reader.lines() {
        let line_str = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line_str.trim().is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line_str) {
            let events = parser.process_line(&parsed);
            for event in events {
                on_event(event);
            }
        }
    }
}

/// Read new content from a file starting at the given byte offset.
/// Returns the new content and the new offset.
pub fn read_from_offset(path: &Path, offset: u64) -> Option<(String, u64)> {
    let mut file = File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    let size = metadata.len();
    if size <= offset {
        return None;
    }

    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = vec![0u8; (size - offset) as usize];
    file.read_exact(&mut buf).ok()?;

    Some((String::from_utf8_lossy(&buf).to_string(), size))
}
