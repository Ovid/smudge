/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.dropTableIfExists("save_events");

  // SQLite DROP COLUMN internally rebuilds the table (CREATE → copy → DROP old → rename).
  // The DROP step fails if other tables have FK references to this table and foreign_keys
  // is ON.  Temporarily disable FK enforcement for the column drops.
  await knex.raw("PRAGMA foreign_keys = OFF");
  try {
    await knex.schema.alterTable("projects", (table) => {
      table.dropColumn("completion_threshold");
    });
    await knex.schema.alterTable("chapters", (table) => {
      table.dropColumn("target_word_count");
    });
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
