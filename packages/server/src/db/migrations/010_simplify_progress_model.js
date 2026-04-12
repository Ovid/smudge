// Knex wraps migrations in a transaction by default. SQLite cannot change
// PRAGMA foreign_keys inside a transaction, and DROP COLUMN internally
// rebuilds the table which fails when FKs are enforced. Opting out of the
// transaction wrapper lets us toggle the pragma safely.
export const config = { transaction: false };

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.dropTableIfExists("save_events");

  await knex.raw("PRAGMA foreign_keys = OFF");
  try {
    // Check column existence before dropping so re-running after partial
    // failure does not error on already-dropped columns.
    const projectCols = await knex.raw("PRAGMA table_info(projects)");
    if (projectCols.some((c) => c.name === "completion_threshold")) {
      await knex.schema.alterTable("projects", (table) => {
        table.dropColumn("completion_threshold");
      });
    }
    const chapterCols = await knex.raw("PRAGMA table_info(chapters)");
    if (chapterCols.some((c) => c.name === "target_word_count")) {
      await knex.schema.alterTable("chapters", (table) => {
        table.dropColumn("target_word_count");
      });
    }
  } finally {
    await knex.raw("PRAGMA foreign_keys = ON");
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.text("completion_threshold").notNullable().defaultTo("final");
  });
  await knex.schema.alterTable("chapters", (table) => {
    table.integer("target_word_count").nullable().defaultTo(null);
  });
  await knex.schema.createTable("save_events", (table) => {
    table.uuid("id").primary();
    table
      .uuid("chapter_id")
      .nullable()
      .references("id")
      .inTable("chapters")
      .onDelete("SET NULL");
    table
      .uuid("project_id")
      .notNullable()
      .references("id")
      .inTable("projects")
      .onDelete("CASCADE");
    table.integer("word_count").notNullable();
    table.text("saved_at").notNullable();
    table.text("save_date").notNullable();
    table.index(["project_id", "saved_at"]);
    table.index(["project_id", "save_date"]);
  });
}
