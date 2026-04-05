/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // Add target columns to projects
  await knex.schema.alterTable("projects", (table) => {
    table.integer("target_word_count").nullable().defaultTo(null);
    table.text("target_deadline").nullable().defaultTo(null);
    table.text("completion_threshold").notNullable().defaultTo("final");
  });

  // Add target_word_count to chapters
  await knex.schema.alterTable("chapters", (table) => {
    table.integer("target_word_count").nullable().defaultTo(null);
  });

  // Create settings table
  await knex.schema.createTable("settings", (table) => {
    table.text("key").primary();
    table.text("value").notNullable();
  });

  // Create save_events table
  await knex.schema.createTable("save_events", (table) => {
    table.uuid("id").primary();
    table.uuid("chapter_id").notNullable().references("id").inTable("chapters");
    table.uuid("project_id").notNullable().references("id").inTable("projects");
    table.integer("word_count").notNullable();
    table.text("saved_at").notNullable();
    table.index(["project_id", "saved_at"]);
  });

  // Create daily_snapshots table
  await knex.schema.createTable("daily_snapshots", (table) => {
    table.uuid("id").primary();
    table
      .uuid("project_id")
      .notNullable()
      .references("id")
      .inTable("projects");
    table.text("date").notNullable();
    table.integer("total_word_count").notNullable();
    table.text("created_at").notNullable();
    table.unique(["project_id", "date"]);
  });

  // Add indexes on chapters table
  await knex.schema.alterTable("chapters", (table) => {
    table.index("project_id", "idx_chapters_project_id");
    table.index("deleted_at", "idx_chapters_deleted_at");
  });

  // Seed baseline SaveEvents and DailySnapshots for existing chapters/projects
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const { v4: uuid } = await import("uuid");

  const chapters = await knex("chapters")
    .whereNull("deleted_at")
    .select("id", "project_id", "word_count");

  for (const chapter of chapters) {
    await knex("save_events").insert({
      id: uuid(),
      chapter_id: chapter.id,
      project_id: chapter.project_id,
      word_count: chapter.word_count || 0,
      saved_at: now,
    });
  }

  const projects = await knex("projects").whereNull("deleted_at").select("id");

  for (const project of projects) {
    const result = await knex("chapters")
      .where({ project_id: project.id })
      .whereNull("deleted_at")
      .sum("word_count as total");
    const total = Number(result[0]?.total) || 0;

    await knex("daily_snapshots").insert({
      id: uuid(),
      project_id: project.id,
      date: today,
      total_word_count: total,
      created_at: now,
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists("daily_snapshots");
  await knex.schema.dropTableIfExists("save_events");
  await knex.schema.dropTableIfExists("settings");

  await knex.schema.alterTable("chapters", (table) => {
    table.dropIndex("project_id", "idx_chapters_project_id");
    table.dropIndex("deleted_at", "idx_chapters_deleted_at");
    table.dropColumn("target_word_count");
  });

  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("target_word_count");
    table.dropColumn("target_deadline");
    table.dropColumn("completion_threshold");
  });
}
