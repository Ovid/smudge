/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.text("author_name").nullable().defaultTo(null);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("author_name");
  });
}
