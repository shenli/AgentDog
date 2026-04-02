use rusqlite::{params, Connection, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SessionRow {
    pub id: String,
    pub project_dir: String,
    pub project_name: String,
    pub transcript_path: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub status: String,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub total_cache_write_tokens: i64,
    pub total_cost_usd: f64,
    pub compaction_count: i64,
    pub model: Option<String>,
    pub agent_type: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TurnRow {
    pub id: i64,
    pub session_id: String,
    pub turn_number: i64,
    pub timestamp: i64,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost_usd: f64,
    pub context_tokens_used: i64,
    pub stop_reason: Option<String>,
    pub is_background_process: bool,
    pub background_process_type: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ToolCallRow {
    pub id: String,
    pub session_id: String,
    pub turn_number: i64,
    pub tool_name: String,
    pub input_summary: Option<String>,
    pub output_size_bytes: Option<i64>,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct AnomalyRow {
    pub id: i64,
    pub session_id: String,
    pub turn_number: i64,
    pub timestamp: i64,
    pub anomaly_type: String,
    pub description: String,
    pub actual_cost_usd: f64,
    pub expected_cost_usd: f64,
    pub multiplier: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ContextSnapshotRow {
    pub id: i64,
    pub session_id: String,
    pub turn_number: i64,
    pub timestamp: i64,
    pub system_prompt_tokens: Option<i64>,
    pub config_file_tokens: Option<i64>,
    pub agent_memory_tokens: Option<i64>,
    pub memory_topic_tokens: Option<i64>,
    pub conversation_tokens: Option<i64>,
    pub tool_result_tokens: Option<i64>,
    pub available_tokens: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompactionEventRow {
    pub id: i64,
    pub session_id: String,
    pub timestamp: i64,
    pub messages_before: Option<i64>,
    pub messages_after: Option<i64>,
    pub tokens_before: Option<i64>,
    pub tokens_after: Option<i64>,
    pub tokens_saved: Option<i64>,
    pub used_session_memory: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct MemoryEventRow {
    pub id: i64,
    pub session_id: String,
    pub timestamp: i64,
    pub event_type: String,
    pub file_path: String,
    pub file_name: String,
    pub source: Option<String>,
    pub memory_type: Option<String>,
    pub description: Option<String>,
    pub size_bytes: Option<i64>,
    pub age_days: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DailyCostRow {
    pub day: String,
    pub agent_type: Option<String>,
    pub total_cost: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub session_count: i64,
    pub turn_count: i64,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_dir = Self::db_dir();
        std::fs::create_dir_all(&db_dir).ok();
        let db_path = db_dir.join("data.sqlite");
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        db.mark_stale_sessions_ended()?;
        Ok(db)
    }

    fn db_dir() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".agentdog")
    }

    fn run_migrations(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_dir TEXT NOT NULL,
                project_name TEXT NOT NULL,
                transcript_path TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                status TEXT DEFAULT 'active',
                total_input_tokens INTEGER DEFAULT 0,
                total_output_tokens INTEGER DEFAULT 0,
                total_cache_read_tokens INTEGER DEFAULT 0,
                total_cache_write_tokens INTEGER DEFAULT 0,
                total_cost_usd REAL DEFAULT 0,
                compaction_count INTEGER DEFAULT 0,
                model TEXT,
                agent_type TEXT DEFAULT 'claude_code'
            );

            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                turn_number INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                model TEXT,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                cache_write_tokens INTEGER DEFAULT 0,
                cost_usd REAL DEFAULT 0,
                context_tokens_used INTEGER DEFAULT 0,
                stop_reason TEXT,
                is_background_process INTEGER DEFAULT 0,
                background_process_type TEXT
            );

            CREATE TABLE IF NOT EXISTS tool_calls (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                turn_number INTEGER NOT NULL,
                tool_name TEXT NOT NULL,
                input_summary TEXT,
                output_size_bytes INTEGER,
                timestamp INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS context_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                turn_number INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                system_prompt_tokens INTEGER,
                config_file_tokens INTEGER,
                agent_memory_tokens INTEGER,
                memory_topic_tokens INTEGER,
                conversation_tokens INTEGER,
                tool_result_tokens INTEGER,
                available_tokens INTEGER
            );

            CREATE TABLE IF NOT EXISTS memory_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                timestamp INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                source TEXT,
                memory_type TEXT,
                description TEXT,
                size_bytes INTEGER,
                age_days INTEGER
            );

            CREATE TABLE IF NOT EXISTS compaction_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                timestamp INTEGER NOT NULL,
                messages_before INTEGER,
                messages_after INTEGER,
                tokens_before INTEGER,
                tokens_after INTEGER,
                tokens_saved INTEGER,
                used_session_memory INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS cost_anomalies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                turn_number INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                anomaly_type TEXT NOT NULL,
                description TEXT NOT NULL,
                actual_cost_usd REAL,
                expected_cost_usd REAL,
                multiplier REAL
            );

            CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
            CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
            CREATE INDEX IF NOT EXISTS idx_context_snapshots_session ON context_snapshots(session_id);
            CREATE INDEX IF NOT EXISTS idx_cost_anomalies_session ON cost_anomalies(session_id);
            ",
        )?;

        // Migration: add agent_type to sessions (for existing DBs)
        let has_agent_type: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='agent_type'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_agent_type {
            conn.execute_batch("ALTER TABLE sessions ADD COLUMN agent_type TEXT DEFAULT 'claude_code';")?;
        }

        // Migration: rename claude_md_tokens -> config_file_tokens (for existing DBs)
        let has_old_col: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('context_snapshots') WHERE name='claude_md_tokens'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if has_old_col {
            conn.execute_batch(
                "ALTER TABLE context_snapshots RENAME COLUMN claude_md_tokens TO config_file_tokens;
                 ALTER TABLE context_snapshots RENAME COLUMN memory_index_tokens TO agent_memory_tokens;",
            )?;
        }

        Ok(())
    }

    /// On startup, mark any sessions left as "active" or "idle" from a previous run as "ended".
    /// The watcher will re-discover and re-activate any that are actually still running.
    fn mark_stale_sessions_ended(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE sessions SET status = 'ended', ended_at = ?1
             WHERE status IN ('active', 'idle')",
            params![now],
        )?;
        Ok(())
    }

    pub fn upsert_session(
        &self,
        id: &str,
        project_dir: &str,
        project_name: &str,
        transcript_path: &str,
        started_at: i64,
        status: &str,
        model: Option<&str>,
        agent_type: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_dir, project_name, transcript_path, started_at, status, model, agent_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               status = excluded.status,
               model = COALESCE(excluded.model, model),
               project_name = excluded.project_name",
            params![id, project_dir, project_name, transcript_path, started_at, status, model, agent_type],
        )?;
        Ok(())
    }

    pub fn insert_turn(
        &self,
        session_id: &str,
        turn_number: i64,
        timestamp: i64,
        model: Option<&str>,
        input_tokens: i64,
        output_tokens: i64,
        cache_read_tokens: i64,
        cache_write_tokens: i64,
        cost_usd: f64,
        context_tokens_used: i64,
        stop_reason: Option<&str>,
        is_background_process: bool,
        background_process_type: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO turns (session_id, turn_number, timestamp, model, input_tokens, output_tokens,
               cache_read_tokens, cache_write_tokens, cost_usd, context_tokens_used, stop_reason,
               is_background_process, background_process_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                session_id,
                turn_number,
                timestamp,
                model,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_write_tokens,
                cost_usd,
                context_tokens_used,
                stop_reason,
                is_background_process as i32,
                background_process_type,
            ],
        )?;
        // Update session aggregates
        conn.execute(
            "UPDATE sessions SET
               total_input_tokens = total_input_tokens + ?1,
               total_output_tokens = total_output_tokens + ?2,
               total_cache_read_tokens = total_cache_read_tokens + ?3,
               total_cache_write_tokens = total_cache_write_tokens + ?4,
               total_cost_usd = total_cost_usd + ?5,
               model = COALESCE(?6, model)
             WHERE id = ?7",
            params![input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, model, session_id],
        )?;
        Ok(())
    }

    pub fn insert_tool_call(
        &self,
        id: &str,
        session_id: &str,
        turn_number: i64,
        tool_name: &str,
        input_summary: Option<&str>,
        timestamp: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO tool_calls (id, session_id, turn_number, tool_name, input_summary, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, session_id, turn_number, tool_name, input_summary, timestamp],
        )?;
        Ok(())
    }

    pub fn update_tool_call_output(&self, tool_use_id: &str, output_size_bytes: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tool_calls SET output_size_bytes = ?1 WHERE id = ?2",
            params![output_size_bytes, tool_use_id],
        )?;
        Ok(())
    }

    pub fn insert_anomaly(
        &self,
        session_id: &str,
        turn_number: i64,
        timestamp: i64,
        anomaly_type: &str,
        description: &str,
        actual_cost: f64,
        expected_cost: f64,
        multiplier: f64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO cost_anomalies (session_id, turn_number, timestamp, anomaly_type, description, actual_cost_usd, expected_cost_usd, multiplier)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![session_id, turn_number, timestamp, anomaly_type, description, actual_cost, expected_cost, multiplier],
        )?;
        Ok(())
    }

    pub fn update_session_status(&self, session_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET status = ?1 WHERE id = ?2",
            params![status, session_id],
        )?;
        if status == "ended" {
            let now = chrono::Utc::now().timestamp_millis();
            conn.execute(
                "UPDATE sessions SET ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
                params![now, session_id],
            )?;
        }
        Ok(())
    }

    // ─── Queries ───

    pub fn get_sessions(&self) -> Result<Vec<SessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_dir, project_name, transcript_path, started_at, ended_at,
                    status, total_input_tokens, total_output_tokens, total_cache_read_tokens,
                    total_cache_write_tokens, total_cost_usd, compaction_count, model, agent_type
             FROM sessions
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'idle' THEN 1 ELSE 2 END, started_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SessionRow {
                    id: row.get(0)?,
                    project_dir: row.get(1)?,
                    project_name: row.get(2)?,
                    transcript_path: row.get(3)?,
                    started_at: row.get(4)?,
                    ended_at: row.get(5)?,
                    status: row.get(6)?,
                    total_input_tokens: row.get(7)?,
                    total_output_tokens: row.get(8)?,
                    total_cache_read_tokens: row.get(9)?,
                    total_cache_write_tokens: row.get(10)?,
                    total_cost_usd: row.get(11)?,
                    compaction_count: row.get(12)?,
                    model: row.get(13)?,
                    agent_type: row.get::<_, Option<String>>(14)?.unwrap_or_else(|| "claude_code".to_string()),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_session(&self, id: &str) -> Result<Option<SessionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_dir, project_name, transcript_path, started_at, ended_at,
                    status, total_input_tokens, total_output_tokens, total_cache_read_tokens,
                    total_cache_write_tokens, total_cost_usd, compaction_count, model, agent_type
             FROM sessions WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(SessionRow {
                id: row.get(0)?,
                project_dir: row.get(1)?,
                project_name: row.get(2)?,
                transcript_path: row.get(3)?,
                started_at: row.get(4)?,
                ended_at: row.get(5)?,
                status: row.get(6)?,
                total_input_tokens: row.get(7)?,
                total_output_tokens: row.get(8)?,
                total_cache_read_tokens: row.get(9)?,
                total_cache_write_tokens: row.get(10)?,
                total_cost_usd: row.get(11)?,
                compaction_count: row.get(12)?,
                model: row.get(13)?,
                agent_type: row.get::<_, Option<String>>(14)?.unwrap_or_else(|| "claude_code".to_string()),
            })
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn get_session_turns(&self, session_id: &str) -> Result<Vec<TurnRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, turn_number, timestamp, model, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, cost_usd, context_tokens_used,
                    stop_reason, is_background_process, background_process_type
             FROM turns WHERE session_id = ?1 ORDER BY turn_number",
        )?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(TurnRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    turn_number: row.get(2)?,
                    timestamp: row.get(3)?,
                    model: row.get(4)?,
                    input_tokens: row.get(5)?,
                    output_tokens: row.get(6)?,
                    cache_read_tokens: row.get(7)?,
                    cache_write_tokens: row.get(8)?,
                    cost_usd: row.get(9)?,
                    context_tokens_used: row.get(10)?,
                    stop_reason: row.get(11)?,
                    is_background_process: row.get::<_, i32>(12)? != 0,
                    background_process_type: row.get(13)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_session_tools(&self, session_id: &str) -> Result<Vec<ToolCallRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, turn_number, tool_name, input_summary, output_size_bytes, timestamp
             FROM tool_calls WHERE session_id = ?1 ORDER BY timestamp",
        )?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(ToolCallRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    turn_number: row.get(2)?,
                    tool_name: row.get(3)?,
                    input_summary: row.get(4)?,
                    output_size_bytes: row.get(5)?,
                    timestamp: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    // ─── Context snapshots ───

    pub fn insert_context_snapshot(
        &self,
        session_id: &str,
        turn_number: i64,
        timestamp: i64,
        system_prompt_tokens: i64,
        config_file_tokens: i64,
        agent_memory_tokens: i64,
        memory_topic_tokens: i64,
        conversation_tokens: i64,
        tool_result_tokens: i64,
        available_tokens: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO context_snapshots (session_id, turn_number, timestamp, system_prompt_tokens,
               config_file_tokens, agent_memory_tokens, memory_topic_tokens, conversation_tokens,
               tool_result_tokens, available_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                session_id, turn_number, timestamp, system_prompt_tokens, config_file_tokens,
                agent_memory_tokens, memory_topic_tokens, conversation_tokens, tool_result_tokens,
                available_tokens,
            ],
        )?;
        Ok(())
    }

    pub fn get_session_context(&self, session_id: &str) -> Result<Vec<ContextSnapshotRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, turn_number, timestamp, system_prompt_tokens, config_file_tokens,
                    agent_memory_tokens, memory_topic_tokens, conversation_tokens, tool_result_tokens,
                    available_tokens
             FROM context_snapshots WHERE session_id = ?1 ORDER BY turn_number",
        )?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(ContextSnapshotRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    turn_number: row.get(2)?,
                    timestamp: row.get(3)?,
                    system_prompt_tokens: row.get(4)?,
                    config_file_tokens: row.get(5)?,
                    agent_memory_tokens: row.get(6)?,
                    memory_topic_tokens: row.get(7)?,
                    conversation_tokens: row.get(8)?,
                    tool_result_tokens: row.get(9)?,
                    available_tokens: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    // ─── Compaction events ───

    pub fn insert_compaction_event(
        &self,
        session_id: &str,
        timestamp: i64,
        tokens_before: i64,
        tokens_after: i64,
        tokens_saved: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO compaction_events (session_id, timestamp, tokens_before, tokens_after, tokens_saved)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, timestamp, tokens_before, tokens_after, tokens_saved],
        )?;
        conn.execute(
            "UPDATE sessions SET compaction_count = compaction_count + 1 WHERE id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    pub fn get_session_compactions(&self, session_id: &str) -> Result<Vec<CompactionEventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, timestamp, messages_before, messages_after,
                    tokens_before, tokens_after, tokens_saved, used_session_memory
             FROM compaction_events WHERE session_id = ?1 ORDER BY timestamp",
        )?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(CompactionEventRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    messages_before: row.get(3)?,
                    messages_after: row.get(4)?,
                    tokens_before: row.get(5)?,
                    tokens_after: row.get(6)?,
                    tokens_saved: row.get(7)?,
                    used_session_memory: row.get::<_, Option<i32>>(8)?.map(|v| v != 0),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    // ─── Memory events ───

    pub fn insert_memory_event(
        &self,
        session_id: &str,
        timestamp: i64,
        event_type: &str,
        file_path: &str,
        file_name: &str,
        source: Option<&str>,
        memory_type: Option<&str>,
        description: Option<&str>,
        size_bytes: Option<i64>,
        age_days: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO memory_events (session_id, timestamp, event_type, file_path, file_name,
               source, memory_type, description, size_bytes, age_days)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                session_id, timestamp, event_type, file_path, file_name,
                source, memory_type, description, size_bytes, age_days,
            ],
        )?;
        Ok(())
    }

    pub fn get_session_memory_events(&self, session_id: &str) -> Result<Vec<MemoryEventRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, timestamp, event_type, file_path, file_name,
                    source, memory_type, description, size_bytes, age_days
             FROM memory_events WHERE session_id = ?1 ORDER BY timestamp",
        )?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(MemoryEventRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    event_type: row.get(3)?,
                    file_path: row.get(4)?,
                    file_name: row.get(5)?,
                    source: row.get(6)?,
                    memory_type: row.get(7)?,
                    description: row.get(8)?,
                    size_bytes: row.get(9)?,
                    age_days: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    // ─── Aggregate queries ───

    pub fn get_daily_cost_summary(&self) -> Result<Vec<DailyCostRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT
               date(timestamp / 1000, 'unixepoch') as day,
               s.agent_type,
               SUM(t.cost_usd) as total_cost,
               SUM(t.input_tokens) as total_input,
               SUM(t.output_tokens) as total_output,
               SUM(t.cache_read_tokens) as total_cache_read,
               COUNT(DISTINCT t.session_id) as session_count,
               COUNT(*) as turn_count
             FROM turns t
             JOIN sessions s ON t.session_id = s.id
             GROUP BY day, s.agent_type
             ORDER BY day DESC
             LIMIT 90",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DailyCostRow {
                    day: row.get(0)?,
                    agent_type: row.get(1)?,
                    total_cost: row.get(2)?,
                    total_input_tokens: row.get(3)?,
                    total_output_tokens: row.get(4)?,
                    total_cache_read_tokens: row.get(5)?,
                    session_count: row.get(6)?,
                    turn_count: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_session_anomalies(&self, session_id: &str) -> Result<Vec<AnomalyRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, turn_number, timestamp, anomaly_type, description,
                    actual_cost_usd, expected_cost_usd, multiplier
             FROM cost_anomalies WHERE session_id = ?1 ORDER BY turn_number",
        )?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(AnomalyRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    turn_number: row.get(2)?,
                    timestamp: row.get(3)?,
                    anomaly_type: row.get(4)?,
                    description: row.get(5)?,
                    actual_cost_usd: row.get(6)?,
                    expected_cost_usd: row.get(7)?,
                    multiplier: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }
}
