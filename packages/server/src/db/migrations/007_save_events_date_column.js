/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // Add a timezone-aware date column to save_events so streak calculations
  // can join accurately without extracting UTC dates from saved_at timestamps.
  await knex.schema.alterTable("save_events", (table) => {
    table.text("save_date");
  });

  // Backfill existing events: use UTC date extraction as best-effort.
  // Events created after this migration will have the correct timezone date.
  await knex.raw(
    `UPDATE save_events SET save_date = date(saved_at) WHERE save_date IS NULL`,
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // SQLite doesn't support DROP COLUMN before 3.35.0, so recreate the table
  await knex.transaction(async (trx) => {
    await trx.raw(`CREATE TABLE save_events_new (
      id TEXT PRIMARY KEY,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      word_count INTEGER NOT NULL,
      saved_at TEXT NOT NULL
    )`);
    await trx.raw(
      `INSERT INTO save_events_new SELECT id, chapter_id, project_id, word_count, saved_at FROM save_events`,
    );
    await trx.raw(`DROP TABLE save_events`);
    await trx.raw(`ALTER TABLE save_events_new RENAME TO save_events`);
    await trx.raw(
      `CREATE INDEX save_events_project_id_saved_at_index ON save_events (project_id, saved_at)`,
    );
  });
}
