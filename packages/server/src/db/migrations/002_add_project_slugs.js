// Inline slug generation to avoid importing from @smudge/shared —
// Knex runs migrations via Node's native ESM loader which cannot
// resolve TypeScript source files.  Logic mirrors generateSlug().
function generateSlug(title) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "untitled";
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // Add slug column — nullable because SQLite doesn't support adding NOT NULL
  // columns to existing tables. Application code always sets slug, so this is
  // a known SQLite limitation, not a gap in enforcement.
  await knex.schema.alterTable("projects", (table) => {
    table.string("slug").nullable();
  });

  // Backfill existing projects
  const projects = await knex("projects").select("id", "title");
  for (const project of projects) {
    const baseSlug = generateSlug(project.title);
    let slug = baseSlug;
    let suffix = 2;
    while (true) {
      const existing = await knex("projects")
        .where({ slug })
        .whereNot({ id: project.id })
        .whereNull("deleted_at")
        .first();
      if (!existing) break;
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }
    await knex("projects").where({ id: project.id }).update({ slug });
  }

  // Partial unique index on slug — only enforces uniqueness among non-deleted rows.
  // This allows reuse of slugs after soft-deleting a project.
  // Title uniqueness is enforced at the application level (not via a DB index)
  // to avoid migration failures on databases with pre-existing duplicate titles.
  await knex.raw(`
    CREATE UNIQUE INDEX idx_projects_slug_active
    ON projects(slug)
    WHERE deleted_at IS NULL
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS idx_projects_slug_active");
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("slug");
  });
}
