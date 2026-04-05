/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // Enforce NOT NULL on save_date — the column was added nullable in 007 for
  // the backfill step, but all code paths now set it.  SQLite requires a
  // table rebuild to add a NOT NULL constraint after the fact.
  await knex.transaction(async (trx) => {
    // Safety: backfill any remaining nulls before the rebuild
    await trx.raw(
      `UPDATE save_events SET save_date = date(saved_at) WHERE save_date IS NULL`,
    );

    await trx.raw(`CREATE TABLE save_events_new (
      id TEXT PRIMARY KEY,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      word_count INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      save_date TEXT NOT NULL
    )`);
    await trx.raw(
      `INSERT INTO save_events_new SELECT id, chapter_id, project_id, word_count, saved_at, save_date FROM save_events`,
    );
    await trx.raw(`DROP TABLE save_events`);
    await trx.raw(`ALTER TABLE save_events_new RENAME TO save_events`);

    // Recreate both indexes
    await trx.raw(
      `CREATE INDEX save_events_project_id_saved_at_index ON save_events (project_id, saved_at)`,
    );
    await trx.raw(
      `CREATE INDEX save_events_project_id_save_date_index ON save_events (project_id, save_date)`,
    );
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Revert to nullable save_date
  await knex.transaction(async (trx) => {
    await trx.raw(`CREATE TABLE save_events_new (
      id TEXT PRIMARY KEY,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      word_count INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      save_date TEXT
    )`);
    await trx.raw(
      `INSERT INTO save_events_new SELECT id, chapter_id, project_id, word_count, saved_at, save_date FROM save_events`,
    );
    await trx.raw(`DROP TABLE save_events`);
    await trx.raw(`ALTER TABLE save_events_new RENAME TO save_events`);

    await trx.raw(
      `CREATE INDEX save_events_project_id_saved_at_index ON save_events (project_id, saved_at)`,
    );
    await trx.raw(
      `CREATE INDEX save_events_project_id_save_date_index ON save_events (project_id, save_date)`,
    );
  });
}
