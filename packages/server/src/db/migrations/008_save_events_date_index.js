/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.raw(
    `CREATE INDEX save_events_project_id_save_date_index ON save_events (project_id, save_date)`,
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS save_events_project_id_save_date_index`);
}
