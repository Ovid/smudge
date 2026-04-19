export async function up(knex) {
  await knex.schema.createTable("chapter_snapshots", (table) => {
    table.text("id").primary();
    table
      .text("chapter_id")
      .notNullable()
      .references("id")
      .inTable("chapters")
      .onDelete("CASCADE");
    table.text("label");
    table.text("content").notNullable();
    table.integer("word_count").notNullable();
    table.boolean("is_auto").notNullable().defaultTo(false);
    table.text("created_at").notNullable();
    table.index(["chapter_id", "created_at"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("chapter_snapshots");
}
