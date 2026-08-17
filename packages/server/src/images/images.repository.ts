import type { Knex } from "knex";
import type { ImageRow, CreateImageRow, UpdateImageData } from "./images.types";
import { InternalError } from "../errors/appError";
import { READ_AFTER_INSERT_FAILURE } from "../errors/readAfterInsert";

export async function insert(db: Knex | Knex.Transaction, data: CreateImageRow): Promise<ImageRow> {
  await db("images").insert(data);
  // I3 (agentic review 2026-08-17): everything past this line runs with the
  // INSERT already committed (uploadImage calls this outside any
  // transaction), so EVERY way the confirming read can fail means the same
  // thing — the row is there and the file must not be unlinked. Catching the
  // throw here, rather than letting uploadImage discriminate on error
  // identity, puts the decision where the fact lives: a re-read that rejects
  // (SQLITE_BUSY, an I/O error, `Knex: Timeout acquiring a connection` — the
  // pool is max:1 and the connection is released between these two
  // statements) previously escaped the guard and unlinked a live row's file,
  // which nothing repairs: images.reaper only deletes files with no row, never
  // the reverse.
  let row: ImageRow | undefined;
  try {
    row = await db("images").where("id", data.id).first();
  } catch (err) {
    const wrapped = new InternalError(
      `Image ${data.id} was written but could not be read back. Do not retry.`,
      READ_AFTER_INSERT_FAILURE,
    );
    // `cause`, not AppError's `extras` — extras are merged into the client-
    // visible error envelope, and a raw driver message must not go there.
    wrapped.cause = err;
    throw wrapped;
  }
  // F-12: a bare Error was clamped to a generic 500 the client could not
  // discriminate. This one MATTERS: the row exists and a retry would mint a
  // duplicate. The `image.upload` scope therefore lists this code in
  // committedCodes, and uploadImage's cleanup checks it before unlinking the
  // file.
  if (!row) {
    throw new InternalError(
      `Image ${data.id} was written but could not be read back. Do not retry.`,
      READ_AFTER_INSERT_FAILURE,
    );
  }
  return row;
}

export async function findById(db: Knex | Knex.Transaction, id: string): Promise<ImageRow | null> {
  const row = await db("images").where("id", id).first();
  return row ?? null;
}

export async function findByIds(db: Knex | Knex.Transaction, ids: string[]): Promise<ImageRow[]> {
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
