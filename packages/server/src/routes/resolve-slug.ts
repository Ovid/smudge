import type { Knex } from "knex";

export async function resolveUniqueSlug(
  db: Knex,
  baseSlug: string,
  excludeProjectId?: string,
): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  const MAX_SUFFIX = 100;

  while (suffix <= MAX_SUFFIX + 2) {
    const query = db("projects").where({ slug }).whereNull("deleted_at");
    if (excludeProjectId) {
      query.whereNot({ id: excludeProjectId });
    }
    const existing = await query.first();
    if (!existing) return slug;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  throw new Error(`Cannot generate unique slug for "${baseSlug}" after ${MAX_SUFFIX} attempts`);
}
