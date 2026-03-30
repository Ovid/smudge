import type { Knex } from "knex";

export async function resolveUniqueSlug(
  db: Knex,
  baseSlug: string,
  excludeProjectId?: string,
): Promise<string> {
  const MAX_SUFFIX = 1000;

  // First, try the base slug with no suffix.
  const baseQuery = db("projects").where({ slug: baseSlug }).whereNull("deleted_at");
  if (excludeProjectId) {
    baseQuery.whereNot({ id: excludeProjectId });
  }
  if (!(await baseQuery.first())) return baseSlug;

  // Then, try suffixed slugs from "-2" through "-MAX_SUFFIX".
  for (let suffix = 2; suffix <= MAX_SUFFIX; suffix++) {
    const slug = `${baseSlug}-${suffix}`;
    const query = db("projects").where({ slug }).whereNull("deleted_at");
    if (excludeProjectId) {
      query.whereNot({ id: excludeProjectId });
    }
    if (!(await query.first())) return slug;
  }

  throw new Error(`Cannot generate unique slug for "${baseSlug}" after ${MAX_SUFFIX} attempts`);
}
