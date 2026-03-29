/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable("projects", (table) => {
    table.uuid("id").primary();
    table.string("title").notNullable();
    table.string("mode").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("deleted_at").nullable();
  });

  await knex.schema.createTable("chapters", (table) => {
    table.uuid("id").primary();
    table.uuid("project_id").notNullable().references("id").inTable("projects");
    table.string("title").notNullable().defaultTo("Untitled Chapter");
    table.text("content").nullable();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.integer("word_count").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("deleted_at").nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists("chapters");
  await knex.schema.dropTableIfExists("projects");
}
