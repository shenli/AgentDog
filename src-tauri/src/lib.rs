mod agent;
mod agents;
mod config;
mod db;
mod discovery;
mod memory;
mod parser;
mod pricing;
mod tray;
mod watcher;

use db::{
    AnomalyRow, CompactionEventRow, ContextSnapshotRow, DailyCostRow, Database, MemoryEventRow,
    SessionRow, ToolCallRow, TurnRow,
};
use std::sync::Arc;
use tauri::Manager;
use watcher::SessionWatcher;

// App state shared across commands
struct AppState {
    db: Arc<Database>,
}

// ─── Tauri commands ───

#[tauri::command]
fn get_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<SessionRow>, String> {
    state.db.get_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session(state: tauri::State<'_, AppState>, id: String) -> Result<Option<SessionRow>, String> {
    state.db.get_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_turns(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<TurnRow>, String> {
    state
        .db
        .get_session_turns(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_tools(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ToolCallRow>, String> {
    state
        .db
        .get_session_tools(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_anomalies(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<AnomalyRow>, String> {
    state
        .db
        .get_session_anomalies(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_context(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ContextSnapshotRow>, String> {
    state
        .db
        .get_session_context(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_compactions(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<CompactionEventRow>, String> {
    state
        .db
        .get_session_compactions(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session_memory_events(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<MemoryEventRow>, String> {
    state
        .db
        .get_session_memory_events(&session_id)
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct MemoryFileInfo {
    file_name: String,
    file_path: String,
    memory_type: Option<String>,
    description: Option<String>,
    size_bytes: i64,
    age_days: i64,
}

/// Scan the project's memory directory on disk — shows current files regardless of session.
/// Uses the agent backend to resolve the memory directory path.
#[tauri::command]
fn get_project_memory_files(state: tauri::State<'_, AppState>, session_id: String) -> Result<Vec<MemoryFileInfo>, String> {
    let session = state.db.get_session(&session_id).map_err(|e| e.to_string())?;
    let session = match session {
        Some(s) => s,
        None => return Ok(vec![]),
    };

    // Resolve memory dir using the agent backend
    let cfg = config::load_config();
    let backends = agents::all_backends(&cfg);
    let memory_dir = backends
        .iter()
        .find(|b| b.agent_type().as_str() == session.agent_type)
        .and_then(|b| b.memory_dir(&session.project_dir));

    let memory_dir = match memory_dir {
        Some(d) if d.exists() => d,
        _ => return Ok(vec![]),
    };

    let mut files = Vec::new();
    let entries = std::fs::read_dir(&memory_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            let metadata = match path.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let content = std::fs::read_to_string(&path).unwrap_or_default();

            // Parse frontmatter
            let (mem_type, description) = if content.starts_with("---\n") {
                if let Some(end) = content[4..].find("\n---") {
                    let fm = &content[4..4 + end];
                    let mut t = None;
                    let mut d = None;
                    for line in fm.lines() {
                        if let Some((k, v)) = line.split_once(':') {
                            match k.trim() {
                                "type" => t = Some(v.trim().to_string()),
                                "description" => d = Some(v.trim().to_string()),
                                _ => {}
                            }
                        }
                    }
                    (t, d)
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            };

            let mtime = metadata.modified().ok()
                .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            files.push(MemoryFileInfo {
                file_name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                file_path: path.to_string_lossy().to_string(),
                memory_type: mem_type,
                description,
                size_bytes: metadata.len() as i64,
                age_days: ((now - mtime) / 86_400_000) as i64,
            });
        }
    }

    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(files)
}

#[tauri::command]
fn get_context_window(state: tauri::State<'_, AppState>, session_id: String) -> Result<i64, String> {
    let session = state.db.get_session(&session_id).map_err(|e| e.to_string())?;
    let model = session.and_then(|s| s.model).unwrap_or_default();
    let cfg = config::load_config();
    Ok(pricing::get_context_window(&model, &cfg.plan))
}

#[tauri::command]
fn get_daily_cost_summary(state: tauri::State<'_, AppState>) -> Result<Vec<DailyCostRow>, String> {
    state.db.get_daily_cost_summary().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config() -> Result<config::AppConfig, String> {
    Ok(config::load_config())
}

#[tauri::command]
fn set_plan(plan: String) -> Result<config::AppConfig, String> {
    let mut cfg = config::load_config();
    cfg.plan = plan;
    config::save_config(&cfg);
    Ok(cfg)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Arc::new(Database::new().expect("Failed to initialize database"));
    let session_watcher = SessionWatcher::new(db.clone());

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(AppState { db })
        .setup(move |app| {
            // Set up system tray with dynamic session info
            let tray = tray::build_tray(app.handle())
                .expect("Failed to build tray");

            // Store tray handle for periodic updates
            app.manage(TrayHandle(Arc::new(std::sync::Mutex::new(tray))));

            // Intercept window close — hide instead of quit
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // Start session watcher
            session_watcher.start(app.handle().clone());

            log::info!("AgentDog started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            get_session,
            get_session_turns,
            get_session_tools,
            get_session_anomalies,
            get_session_context,
            get_session_compactions,
            get_session_memory_events,
            get_project_memory_files,
            get_context_window,
            get_daily_cost_summary,
            get_config,
            set_plan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Wrapper so we can store TrayIcon in Tauri state
pub struct TrayHandle(pub Arc<std::sync::Mutex<tauri::tray::TrayIcon>>);
