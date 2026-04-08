import type { Knex } from "knex";
import type { ProjectRow, CreateProjectRow, ProjectListRow } from "./projects.types";

export async function insert(
  trx: Knex.Transaction | Knex,
  data: CreateProjectRow,
): Promise<ProjectRow> {
  await trx("projects").insert(data);
  const row = await trx("projects").where({ id: data.id }).first();
  if (!row) throw new Error(`Project ${data.id} not found after insert`);
  return row as ProjectRow;
}

export async function findById(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ProjectRow | null> {
  return (await trx("projects").where({ id }).whereNull("deleted_at").first()) ?? null;
}

export async function findByIdIncludingDeleted(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ProjectRow | null> {
  return (await trx("projects").where({ id }).first()) ?? null;
}

export async function findBySlug(
  trx: Knex.Transaction | Knex,
  slug: string,
): Promise<ProjectRow | null> {
  return (await trx("projects").where({ slug }).whereNull("deleted_at").first()) ?? null;
}

export async function findBySlugIncludingDeleted(
  trx: Knex.Transaction | Knex,
  slug: string,
): Promise<ProjectRow | null> {
  return (await trx("projects").where({ slug }).first()) ?? null;
}

export async function findByTitle(
  trx: Knex.Transaction | Knex,
  title: string,
  excludeId?: string,
): Promise<ProjectRow | null> {
  const query = trx("projects").where({ title }).whereNull("deleted_at");
  if (excludeId) {
    query.whereNot({ id: excludeId });
  }
  return (await query.first()) ?? null;
}

export async function listAll(trx: Knex.Transaction | Knex): Promise<ProjectListRow[]> {
  const result = await trx("projects")
    .leftJoin("chapters", function () {
      this.on("projects.id", "=", "chapters.project_id").andOnNull("chapters.deleted_at");
    })
    .whereNull("projects.deleted_at")
    .groupBy("projects.id")
    .orderBy("projects.updated_at", "desc")
    .orderBy("projects.rowid", "desc")
    .select(
      "projects.id",
      "projects.title",
      "projects.slug",
      "projects.mode",
      "projects.updated_at",
      // Raw SQL: Knex has no COALESCE wrapper; needed to default NULL SUM to 0
      trx.raw("COALESCE(SUM(chapters.word_count), 0) as total_word_count"),
    );

  return result.map((r: Record<string, unknown>) => ({
    ...r,
    total_word_count: Number(r.total_word_count),
  })) as ProjectListRow[];
}

export async function update(
  trx: Knex.Transaction | Knex,
  id: string,
  data: Record<string, unknown>,
): Promise<ProjectRow> {
  await trx("projects").where({ id }).update(data);
  const row = await trx("projects").where({ id }).first();
  if (!row) throw new Error(`Project ${id} not found after update`);
  return row as ProjectRow;
}

export async function updateTimestamp(trx: Knex.Transaction | Knex, id: string): Promise<void> {
  await trx("projects").where({ id }).update({ updated_at: new Date().toISOString() });
}

export async function softDelete(
  trx: Knex.Transaction | Knex,
  id: string,
  now: string,
): Promise<void> {
  await trx("projects").where({ id }).update({ deleted_at: now });
}

export async function resolveUniqueSlug(
  trx: Knex.Transaction | Knex,
  baseSlug: string,
  excludeProjectId?: string,
): Promise<string> {
  const MAX_SUFFIX = 1000;

  const baseQuery = trx("projects").where({ slug: baseSlug }).whereNull("deleted_at");
  if (excludeProjectId) {
    baseQuery.whereNot({ id: excludeProjectId });
  }
  if (!(await baseQuery.first())) return baseSlug;

  for (let suffix = 2; suffix <= MAX_SUFFIX; suffix++) {
    const slug = `${baseSlug}-${suffix}`;
    const query = trx("projects").where({ slug }).whereNull("deleted_at");
    if (excludeProjectId) {
      query.whereNot({ id: excludeProjectId });
    }
    if (!(await query.first())) return slug;
  }

  throw new Error(`Cannot generate unique slug for "${baseSlug}" after ${MAX_SUFFIX} attempts`);
}
