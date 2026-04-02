use crate::agent::{AgentParser, AgentType};
use crate::agents;
use crate::config;
use crate::db::Database;
use crate::memory::MemoryWatcher;
use crate::parser::{parse_transcript_file, read_from_offset, ParseEvent};
use crate::tray;
use crate::TrayHandle;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[allow(dead_code)]
struct WatchedSession {
    parser: Box<dyn AgentParser>,
    agent_type: AgentType,
    offset: u64,
    transcript_path: PathBuf,
    buffer: String,
    project_dir: String,
}

pub struct SessionWatcher {
    watched: Arc<Mutex<HashMap<String, WatchedSession>>>,
    db: Arc<Database>,
}

impl SessionWatcher {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            watched: Arc::new(Mutex::new(HashMap::new())),
            db,
        }
    }

    /// Start the polling loop. Call from a background thread.
    pub fn start(&self, app_handle: AppHandle) {
        let watched = self.watched.clone();
        let db = self.db.clone();

        std::thread::spawn(move || {
            let mut memory_watcher = MemoryWatcher::new(db.clone());
            let mut tray_fingerprint = String::new();

            loop {
                Self::poll(&watched, &db, &app_handle, &mut memory_watcher, &mut tray_fingerprint);
                std::thread::sleep(Duration::from_secs(5));
            }
        });
    }

    fn poll(
        watched: &Arc<Mutex<HashMap<String, WatchedSession>>>,
        db: &Arc<Database>,
        app_handle: &AppHandle,
        memory_watcher: &mut MemoryWatcher,
        tray_fingerprint: &mut String,
    ) {
        let cfg = config::load_config();
        let backends = agents::all_backends(&cfg);

        // Discover sessions from all enabled agent backends
        let mut all_sessions = Vec::new();
        // Track which backend handles which agent type for memory dir lookups
        let mut agent_backends: HashMap<AgentType, &dyn crate::agent::AgentBackend> = HashMap::new();

        for backend in &backends {
            let sessions = backend.discover_sessions();
            agent_backends.insert(backend.agent_type(), backend.as_ref());
            all_sessions.extend(sessions);
        }

        // Sort by last_modified descending
        all_sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

        let recent_ids: HashSet<String> = all_sessions
            .iter()
            .filter(|s| s.is_recent)
            .map(|s| s.session_id.clone())
            .collect();

        // Track active project dirs for memory watching (with their memory dirs resolved)
        let mut memory_dirs: HashMap<String, PathBuf> = HashMap::new();
        let mut project_session_map: HashMap<String, String> = HashMap::new();

        for session in &all_sessions {
            if !session.is_recent {
                continue;
            }

            project_session_map.insert(
                session.project_dir.clone(),
                session.session_id.clone(),
            );

            // Resolve memory dir from the appropriate backend
            if let Some(backend) = agent_backends.get(&session.agent_type) {
                if let Some(mem_dir) = backend.memory_dir(&session.project_dir) {
                    memory_dirs.insert(session.project_dir.clone(), mem_dir);
                }
            }

            let mut watched_guard = watched.lock().unwrap();

            if !watched_guard.contains_key(&session.session_id) {
                // New session — find the right backend to create a parser
                let backend = match agent_backends.get(&session.agent_type) {
                    Some(b) => *b,
                    None => continue,
                };

                let path = PathBuf::from(&session.transcript_path);
                let mut parser = backend.create_parser(&session.session_id);

                // Parse existing content (streaming, low memory)
                parse_transcript_file(parser.as_mut(), &path, |event| {
                    Self::process_event_db_only(db, &event);
                });

                let offset = std::fs::metadata(&path)
                    .map(|m| m.len())
                    .unwrap_or(0);

                // Upsert session in DB
                let _ = db.upsert_session(
                    &session.session_id,
                    &session.project_dir,
                    &session.project_name,
                    &session.transcript_path,
                    session.last_modified,
                    if session.is_active { "active" } else { "idle" },
                    parser.model(),
                    session.agent_type.as_str(),
                );

                // Initial memory scan for this project
                if let Some(mem_dir) = memory_dirs.get(&session.project_dir) {
                    memory_watcher.initial_scan_dir(
                        &session.project_dir,
                        &session.session_id,
                        mem_dir,
                        app_handle,
                    );
                }

                watched_guard.insert(
                    session.session_id.clone(),
                    WatchedSession {
                        parser,
                        agent_type: session.agent_type,
                        offset,
                        transcript_path: path,
                        buffer: String::new(),
                        project_dir: session.project_dir.clone(),
                    },
                );

                log::info!(
                    "Discovered {} session: {} ({})",
                    session.agent_type,
                    session.project_name,
                    &session.session_id[..8.min(session.session_id.len())]
                );

                // Emit discovery event with agent_type
                let _ = app_handle.emit("session_discovered", serde_json::json!({
                    "session_id": session.session_id,
                    "agent_type": session.agent_type.as_str(),
                    "project_dir": session.project_dir,
                    "project_name": session.project_name,
                    "transcript_path": session.transcript_path,
                    "last_modified": session.last_modified,
                    "is_active": session.is_active,
                    "is_recent": session.is_recent,
                }));
            } else {
                // Existing session — check for new content
                let ws = watched_guard.get_mut(&session.session_id).unwrap();

                if let Some((new_content, new_offset)) =
                    read_from_offset(&ws.transcript_path, ws.offset)
                {
                    ws.offset = new_offset;
                    ws.buffer.push_str(&new_content);

                    let lines: Vec<&str> = ws.buffer.split('\n').collect();
                    let (complete, remainder) = if ws.buffer.ends_with('\n') {
                        (lines.as_slice(), "")
                    } else {
                        let last = lines.last().copied().unwrap_or("");
                        (&lines[..lines.len() - 1], last)
                    };

                    let mut all_events = Vec::new();
                    for line_str in complete {
                        if line_str.trim().is_empty() {
                            continue;
                        }
                        if let Ok(parsed) = serde_json::from_str::<Value>(line_str) {
                            let events = ws.parser.process_line(&parsed);
                            all_events.extend(events);
                        }
                    }
                    ws.buffer = remainder.to_string();

                    Self::process_events(db, &all_events, app_handle);
                }

                // Update session status
                let new_status = if session.is_active { "active" } else { "idle" };
                let _ = db.update_session_status(&session.session_id, new_status);
            }
        }

        // Scan memory directories for changes
        memory_watcher.scan_dirs(&memory_dirs, &project_session_map, app_handle);

        // Mark sessions that dropped out of discovery as ended
        let mut watched_guard = watched.lock().unwrap();
        let ended: Vec<String> = watched_guard
            .keys()
            .filter(|id| !recent_ids.contains(*id))
            .cloned()
            .collect();

        for id in ended {
            watched_guard.remove(&id);
            let _ = db.update_session_status(&id, "ended");
            let _ = app_handle.emit(
                "session_status_change",
                serde_json::json!({"sessionId": id, "status": "ended"}),
            );
            log::info!("Session ended: {}", &id[..8.min(id.len())]);
        }

        // Drop the watched_guard before updating tray to avoid holding it longer than needed
        drop(watched_guard);

        // Update tray menu with current session info
        if let Some(tray_handle) = app_handle.try_state::<TrayHandle>() {
            match tray_handle.0.lock() {
                Ok(tray) => {
                    tray::update_tray_menu(app_handle, &tray, db, tray_fingerprint);
                }
                Err(e) => {
                    log::error!("Failed to lock tray handle: {}", e);
                }
            }
        }
    }

    /// Process event — DB only, no frontend emission. Used during initial catch-up.
    fn process_event_db_only(db: &Database, event: &ParseEvent) {
        match event {
            ParseEvent::Turn(turn) => {
                let _ = db.insert_turn(
                    &turn.session_id, turn.turn_number, turn.timestamp,
                    Some(&turn.model), turn.input_tokens, turn.output_tokens,
                    turn.cache_read_tokens, turn.cache_write_tokens, turn.cost_usd,
                    turn.context_tokens_estimate, turn.stop_reason.as_deref(),
                    turn.is_background_process, turn.background_process_type.as_deref(),
                );
            }
            ParseEvent::ToolCall(tc) => {
                let _ = db.insert_tool_call(&tc.id, &tc.session_id, tc.turn_number, &tc.name, Some(&tc.input_summary), tc.timestamp);
            }
            ParseEvent::ToolResult(tr) => {
                let _ = db.update_tool_call_output(&tr.tool_use_id, tr.output_size_bytes);
            }
            ParseEvent::Anomaly(a) => {
                let _ = db.insert_anomaly(&a.session_id, a.turn_number, a.timestamp, "high_cost_turn",
                    &format!("Turn {} cost ${:.4} ({:.1}x avg)", a.turn_number, a.actual_cost, a.multiplier),
                    a.actual_cost, a.expected_cost, a.multiplier);
            }
            ParseEvent::ContextSnapshot(cs) => {
                let _ = db.insert_context_snapshot(&cs.session_id, cs.turn_number, cs.timestamp,
                    cs.system_prompt_tokens, cs.config_file_tokens, cs.agent_memory_tokens,
                    cs.memory_topic_tokens, cs.conversation_tokens, cs.tool_result_tokens, cs.available_tokens);
            }
            ParseEvent::Compaction(c) => {
                let _ = db.insert_compaction_event(&c.session_id, c.timestamp, c.tokens_before, c.tokens_after, c.tokens_saved);
            }
        }
    }

    fn process_events(db: &Database, events: &[ParseEvent], app_handle: &AppHandle) {
        for event in events {
            Self::process_event(db, event, app_handle);
        }
    }

    fn process_event(db: &Database, event: &ParseEvent, app_handle: &AppHandle) {
        match event {
            ParseEvent::Turn(turn) => {
                let _ = db.insert_turn(
                    &turn.session_id,
                    turn.turn_number,
                    turn.timestamp,
                    Some(&turn.model),
                    turn.input_tokens,
                    turn.output_tokens,
                    turn.cache_read_tokens,
                    turn.cache_write_tokens,
                    turn.cost_usd,
                    turn.context_tokens_estimate,
                    turn.stop_reason.as_deref(),
                    turn.is_background_process,
                    turn.background_process_type.as_deref(),
                );
                let _ = app_handle.emit("turn", turn);
            }
            ParseEvent::ToolCall(tc) => {
                let _ = db.insert_tool_call(
                    &tc.id,
                    &tc.session_id,
                    tc.turn_number,
                    &tc.name,
                    Some(&tc.input_summary),
                    tc.timestamp,
                );
                let _ = app_handle.emit("tool_call", tc);
            }
            ParseEvent::ToolResult(tr) => {
                let _ = db.update_tool_call_output(&tr.tool_use_id, tr.output_size_bytes);
            }
            ParseEvent::Anomaly(a) => {
                let _ = db.insert_anomaly(
                    &a.session_id,
                    a.turn_number,
                    a.timestamp,
                    "high_cost_turn",
                    &format!(
                        "Turn {} cost ${:.4} ({:.1}x avg)",
                        a.turn_number, a.actual_cost, a.multiplier
                    ),
                    a.actual_cost,
                    a.expected_cost,
                    a.multiplier,
                );
                let _ = app_handle.emit("anomaly", a);
            }
            ParseEvent::ContextSnapshot(cs) => {
                let _ = db.insert_context_snapshot(
                    &cs.session_id,
                    cs.turn_number,
                    cs.timestamp,
                    cs.system_prompt_tokens,
                    cs.config_file_tokens,
                    cs.agent_memory_tokens,
                    cs.memory_topic_tokens,
                    cs.conversation_tokens,
                    cs.tool_result_tokens,
                    cs.available_tokens,
                );
                let _ = app_handle.emit("context_snapshot", cs);
            }
            ParseEvent::Compaction(c) => {
                let _ = db.insert_compaction_event(
                    &c.session_id,
                    c.timestamp,
                    c.tokens_before,
                    c.tokens_after,
                    c.tokens_saved,
                );
                let _ = app_handle.emit("compaction", c);
            }
        }
    }
}
