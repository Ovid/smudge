/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // Change save_events.chapter_id from NOT NULL CASCADE to nullable SET NULL.
  // This preserves velocity history when chapters are hard-purged.
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

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.transaction(async (trx) => {
    // Restore NOT NULL CASCADE (events with null chapter_id are dropped)
    await trx.raw(`CREATE TABLE save_events_new (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      word_count INTEGER NOT NULL,
      saved_at TEXT NOT NULL
    )`);
    await trx.raw(
      `INSERT INTO save_events_new SELECT id, chapter_id, project_id, word_count, saved_at FROM save_events WHERE chapter_id IS NOT NULL`,
    );
    await trx.raw(`DROP TABLE save_events`);
    await trx.raw(`ALTER TABLE save_events_new RENAME TO save_events`);
    await trx.raw(
      `CREATE INDEX save_events_project_id_saved_at_index ON save_events (project_id, saved_at)`,
    );
  });
}
