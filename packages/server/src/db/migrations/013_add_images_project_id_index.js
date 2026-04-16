export async function up(knex) {
  await knex.schema.alterTable("images", (table) => {
    table.index("project_id", "idx_images_project_id");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("images", (table) => {
    table.dropIndex("project_id", "idx_images_project_id");
  });
}
