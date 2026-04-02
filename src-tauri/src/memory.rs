use crate::db::Database;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct MemoryFileInfo {
    pub path: String,
    pub name: String,
    pub memory_type: Option<String>,
    pub description: Option<String>,
    pub size_bytes: i64,
    pub age_days: i64,
}

/// Watches memory directories for all active projects.
pub struct MemoryWatcher {
    db: Arc<Database>,
    /// project_dir -> set of known memory files (path -> mtime_ms)
    known_files: HashMap<String, HashMap<String, u64>>,
}

impl MemoryWatcher {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            known_files: HashMap::new(),
        }
    }

    /// Scan memory directories using pre-resolved paths from agent backends.
    pub fn scan_dirs(
        &mut self,
        memory_dirs: &HashMap<String, PathBuf>,
        active_session_ids: &HashMap<String, String>, // project_dir -> session_id
        app_handle: &AppHandle,
    ) {
        for (project_dir, memory_dir) in memory_dirs {
            if !memory_dir.exists() {
                continue;
            }

            let session_id = match active_session_ids.get(project_dir) {
                Some(id) => id.clone(),
                None => continue,
            };

            let current_files = scan_directory(memory_dir);
            let prev_files = self
                .known_files
                .entry(project_dir.clone())
                .or_default();

            let mut new_or_updated: Vec<(String, bool)> = Vec::new();
            for (path, mtime) in &current_files {
                let is_new = !prev_files.contains_key(path);
                let is_updated = prev_files.get(path).map(|m| m != mtime).unwrap_or(false);
                if is_new || is_updated {
                    new_or_updated.push((path.clone(), is_new));
                }
            }

            let mut deleted_paths: Vec<String> = Vec::new();
            for path in prev_files.keys() {
                if !current_files.contains_key(path) {
                    deleted_paths.push(path.clone());
                }
            }

            *prev_files = current_files;

            for (path, is_new) in &new_or_updated {
                let file_path = Path::new(path);
                if let Some(info) = read_memory_file(file_path) {
                    let event_type = if *is_new { "written" } else { "updated" };
                    let _ = self.db.insert_memory_event(
                        &session_id,
                        chrono::Utc::now().timestamp_millis(),
                        event_type,
                        &info.path,
                        &info.name,
                        None,
                        info.memory_type.as_deref(),
                        info.description.as_deref(),
                        Some(info.size_bytes),
                        Some(info.age_days),
                    );
                    let _ = app_handle.emit(
                        "memory_event",
                        serde_json::json!({
                            "sessionId": session_id,
                            "eventType": event_type,
                            "fileName": info.name,
                            "memoryType": info.memory_type,
                            "description": info.description,
                            "sizeBytes": info.size_bytes,
                            "ageDays": info.age_days,
                        }),
                    );
                }
            }

            for path in &deleted_paths {
                let file_name = Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let _ = self.db.insert_memory_event(
                    &session_id,
                    chrono::Utc::now().timestamp_millis(),
                    "deleted",
                    path,
                    &file_name,
                    None,
                    None,
                    None,
                    None,
                    None,
                );
                let _ = app_handle.emit(
                    "memory_event",
                    serde_json::json!({
                        "sessionId": session_id,
                        "eventType": "deleted",
                        "fileName": file_name,
                    }),
                );
            }
        }
    }

    /// Initial scan of a memory directory — emit "loaded" events for existing files.
    pub fn initial_scan_dir(
        &mut self,
        project_dir: &str,
        session_id: &str,
        memory_dir: &Path,
        _app_handle: &AppHandle,
    ) {
        if !memory_dir.exists() {
            return;
        }

        let files = scan_directory(memory_dir);
        for (path, _) in &files {
            if let Some(info) = read_memory_file(Path::new(path)) {
                let _ = self.db.insert_memory_event(
                    session_id,
                    chrono::Utc::now().timestamp_millis(),
                    "loaded",
                    &info.path,
                    &info.name,
                    Some("session_start"),
                    info.memory_type.as_deref(),
                    info.description.as_deref(),
                    Some(info.size_bytes),
                    Some(info.age_days),
                );
            }
        }

        self.known_files
            .insert(project_dir.to_string(), files);
    }
}

fn scan_directory(dir: &Path) -> HashMap<String, u64> {
    let mut files = HashMap::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                let mtime = path
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                files.insert(path.to_string_lossy().to_string(), mtime);
            }
        }
    }
    files
}

fn read_memory_file(path: &Path) -> Option<MemoryFileInfo> {
    let content = std::fs::read_to_string(path).ok()?;
    let metadata = path.metadata().ok()?;
    let size = metadata.len() as i64;

    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let age_days = ((now - mtime) / 86_400_000) as i64;

    let (memory_type, description) = parse_frontmatter(&content);

    Some(MemoryFileInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        memory_type,
        description,
        size_bytes: size,
        age_days,
    })
}

/// Parse YAML frontmatter from a memory file.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    if !content.starts_with("---\n") {
        return (None, None);
    }
    let end = content[4..].find("\n---");
    if let Some(end_pos) = end {
        let frontmatter = &content[4..4 + end_pos];
        let mut memory_type = None;
        let mut description = None;
        for line in frontmatter.lines() {
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                match key {
                    "type" => memory_type = Some(value.to_string()),
                    "description" => description = Some(value.to_string()),
                    _ => {}
                }
            }
        }
        (memory_type, description)
    } else {
        (None, None)
    }
}
