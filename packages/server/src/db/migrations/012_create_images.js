export async function up(knex) {
  await knex.schema.createTable("images", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("id").inTable("projects");
    table.text("filename").notNullable();
    table.text("alt_text").notNullable().defaultTo("");
    table.text("caption").notNullable().defaultTo("");
    table.text("source").notNullable().defaultTo("");
    table.text("license").notNullable().defaultTo("");
    table.text("mime_type").notNullable();
    table.integer("size_bytes").notNullable();
    table.integer("reference_count").notNullable().defaultTo(0);
    table.text("created_at").notNullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("images");
}
