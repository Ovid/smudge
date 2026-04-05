/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // SQLite doesn't support ALTER CONSTRAINT, so we must recreate the tables
  // with ON DELETE CASCADE. Copy data, drop, recreate, restore.
  // Wrapped in a transaction so a crash mid-migration won't leave the DB broken.

  await knex.transaction(async (trx) => {
    // --- save_events ---
    await trx.raw(`CREATE TABLE save_events_new (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      word_count INTEGER NOT NULL,
      saved_at TEXT NOT NULL
    )`);
    await trx.raw(`INSERT INTO save_events_new SELECT id, chapter_id, project_id, word_count, saved_at FROM save_events`);
    await trx.raw(`DROP TABLE save_events`);
    await trx.raw(`ALTER TABLE save_events_new RENAME TO save_events`);
    await trx.raw(`CREATE INDEX save_events_project_id_saved_at_index ON save_events (project_id, saved_at)`);

    // --- daily_snapshots ---
    await trx.raw(`CREATE TABLE daily_snapshots_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      total_word_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, date)
    )`);
    await trx.raw(`INSERT INTO daily_snapshots_new SELECT id, project_id, date, total_word_count, created_at FROM daily_snapshots`);
    await trx.raw(`DROP TABLE daily_snapshots`);
    await trx.raw(`ALTER TABLE daily_snapshots_new RENAME TO daily_snapshots`);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Recreate without CASCADE (original schema)
  await knex.transaction(async (trx) => {
    await trx.raw(`CREATE TABLE save_events_new (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      word_count INTEGER NOT NULL,
      saved_at TEXT NOT NULL
    )`);
    await trx.raw(`INSERT INTO save_events_new SELECT id, chapter_id, project_id, word_count, saved_at FROM save_events`);
    await trx.raw(`DROP TABLE save_events`);
    await trx.raw(`ALTER TABLE save_events_new RENAME TO save_events`);
    await trx.raw(`CREATE INDEX save_events_project_id_saved_at_index ON save_events (project_id, saved_at)`);

    await trx.raw(`CREATE TABLE daily_snapshots_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      date TEXT NOT NULL,
      total_word_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, date)
    )`);
    await trx.raw(`INSERT INTO daily_snapshots_new SELECT id, project_id, date, total_word_count, created_at FROM daily_snapshots`);
    await trx.raw(`DROP TABLE daily_snapshots`);
    await trx.raw(`ALTER TABLE daily_snapshots_new RENAME TO daily_snapshots`);
  });
}
