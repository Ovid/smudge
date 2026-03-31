/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable("chapter_statuses", (table) => {
    table.string("status").primary();
    table.integer("sort_order").notNullable();
    table.string("label").notNullable();
  });

  await knex("chapter_statuses").insert([
    { status: "outline", sort_order: 1, label: "Outline" },
    { status: "rough_draft", sort_order: 2, label: "Rough Draft" },
    { status: "revised", sort_order: 3, label: "Revised" },
    { status: "edited", sort_order: 4, label: "Edited" },
    { status: "final", sort_order: 5, label: "Final" },
  ]);

  await knex.schema.alterTable("chapters", (table) => {
    table.string("status").notNullable().defaultTo("outline");
  });

  // Backfill existing chapters
  await knex("chapters").whereNull("status").update({ status: "outline" });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable("chapters", (table) => {
    table.dropColumn("status");
  });
  await knex.schema.dropTableIfExists("chapter_statuses");
}
