/** Adds any of `columns` (name → definition) that `table` doesn't have yet. */
export function addMissingColumns(
  sql: SqlStorage,
  table: string,
  columns: Record<string, string>,
): void {
  const existing = new Set(
    sql
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
      .toArray()
      .map((c) => c.name),
  );
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}
