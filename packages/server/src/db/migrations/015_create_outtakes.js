export async function up(knex) {
  await knex.schema.createTable("outtakes", (table) => {
    table.text("id").primary();
    table
      .text("project_id")
      .notNullable()
      .references("id")
      .inTable("projects")
      .onDelete("CASCADE");
    table.text("label");
    table.text("content").notNullable();
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.index(["project_id", "created_at"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("outtakes");
}
