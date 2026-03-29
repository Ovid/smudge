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
    const MAX_SUFFIX = 100;
    let slug = baseSlug;
    const baseQuery = knex("projects")
      .where({ slug })
      .whereNot({ id: project.id })
      .whereNull("deleted_at");
    if (!(await baseQuery.first())) {
      // Base slug is available
    } else {
      let found = false;
      for (let suffix = 2; suffix <= MAX_SUFFIX; suffix++) {
        slug = `${baseSlug}-${suffix}`;
        const existing = await knex("projects")
          .where({ slug })
          .whereNot({ id: project.id })
          .whereNull("deleted_at")
          .first();
        if (!existing) {
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(
          `Migration: cannot generate unique slug for "${project.title}" after ${MAX_SUFFIX} attempts`,
        );
      }
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
