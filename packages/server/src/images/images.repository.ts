import type { Knex } from "knex";
import type { ImageRow, CreateImageRow, UpdateImageData } from "./images.types";

export async function insert(db: Knex | Knex.Transaction, data: CreateImageRow): Promise<ImageRow> {
  await db("images").insert(data);
  const row = await db("images").where("id", data.id).first();
  if (!row) throw new Error(`Image ${data.id} not found after insert`);
  return row;
}

export async function findById(db: Knex | Knex.Transaction, id: string): Promise<ImageRow | null> {
  const row = await db("images").where("id", id).first();
  return row ?? null;
}

export async function findByIds(
  db: Knex | Knex.Transaction,
  ids: string[],
): Promise<ImageRow[]> {
  if (ids.length === 0) return [];
  return db("images").whereIn("id", ids);
}

export async function listByProject(
  db: Knex | Knex.Transaction,
  projectId: string,
): Promise<ImageRow[]> {
  return db("images").where("project_id", projectId).orderBy("created_at", "desc");
}

export async function update(
  db: Knex | Knex.Transaction,
  id: string,
  data: UpdateImageData,
): Promise<number> {
  return db("images").where("id", id).update(data);
}

export async function remove(db: Knex | Knex.Transaction, id: string): Promise<number> {
  return db("images").where("id", id).delete();
}

export async function removeByProject(
  db: Knex | Knex.Transaction,
  projectId: string,
): Promise<number> {
  return db("images").where("project_id", projectId).delete();
}

export async function incrementReferenceCount(
  db: Knex | Knex.Transaction,
  id: string,
  delta: number,
): Promise<void> {
  await db("images")
    .where("id", id)
    .update({
      reference_count: db.raw("MAX(0, reference_count + ?)", [delta]),
    });
}

export async function setReferenceCount(
  db: Knex | Knex.Transaction,
  id: string,
  count: number,
): Promise<void> {
  await db("images").where("id", id).update({ reference_count: count });
}
