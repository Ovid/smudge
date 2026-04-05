import type { Knex } from "knex";
import type { ProjectRow } from "./projects.types";

export async function findBySlug(
  trx: Knex.Transaction | Knex,
  slug: string,
): Promise<ProjectRow | undefined> {
  return trx("projects").where({ slug }).whereNull("deleted_at").first();
}
