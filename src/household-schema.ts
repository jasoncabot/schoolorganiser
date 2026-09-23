import { addMissingColumns } from "./sql";

/** Creates or upgrades the household's tables. Safe to run on every start. */
export function migrate(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      r2_key TEXT NOT NULL,
      received_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      address TEXT PRIMARY KEY,
      joined_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      cost TEXT,
      location TEXT,
      school TEXT,
      child TEXT,
      confidence TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS items_by_date ON items (date);
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      school TEXT NOT NULL,
      year_group INTEGER NOT NULL,
      year_group_as_of INTEGER NOT NULL,
      class_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS unreadable (
      message_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      reason TEXT NOT NULL,
      mentioned_at TEXT
    );
  `);
  // Columns added after the first households were created.
  addMissingColumns(sql, "messages", {
    status: "TEXT NOT NULL DEFAULT 'new'",
    attempts: "INTEGER NOT NULL DEFAULT 0",
    subject: "TEXT",
    sent_at: "TEXT",
    body_text: "TEXT",
    processed_at: "TEXT",
    extraction_version: "INTEGER NOT NULL DEFAULT 1",
    children_version: "INTEGER NOT NULL DEFAULT 0",
    failure_mentioned_at: "TEXT",
  });
  addMissingColumns(sql, "items", {
    child_ids: "TEXT",
    maybe_child_ids: "TEXT",
    date_unsure: "INTEGER NOT NULL DEFAULT 0",
  });
  addMissingColumns(sql, "members", { digest_stopped_at: "TEXT" });
}
