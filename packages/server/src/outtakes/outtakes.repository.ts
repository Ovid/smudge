import type { Knex } from "knex";
import { isTipTapNode } from "@smudge/shared";
import type { OuttakeRow, CreateOuttakeData } from "./outtakes.types";
import { logger } from "../logger";

const TABLE = "outtakes";

// The DB stores `content` as a stringified TipTap doc; the wire type
// (OuttakeRow) carries it parsed. Parse on read so callers never see the raw
// column string.
function parseRow(row: Record<string, unknown>): OuttakeRow {
  let content: Record<string, unknown>;
  let corrupt = false;
  try {
    const parsed: unknown = JSON.parse(row.content as string);
    // S1: "valid JSON, wrong shape" ("null", "42", "[]", '"text"') parses
    // without throwing, so guarding only the throw let a non-object escape as
    // OuttakeRow.content — which callers dereference unguarded (EditorPage
    // reads content.content, OuttakeCard walks it for the word count). Route it
    // through the same degrade, mirroring snapshots.service.ts.
    if (!isTipTapNode(parsed)) {
      throw new TypeError("Outtake content is not a JSON object");
    }
    content = parsed as Record<string, unknown>;
  } catch (err) {
    // Degrade one corrupt row to an empty doc rather than 500-ing the whole
    // drawer: content stays non-null so every walker keeps working and the row
    // still lists, which is what keeps it deletable.
    //
    // S7 (agentic-review 2026-08-04): but the degrade must be VISIBLE. The
    // recorded rationale for the silent version addressed the rendering failure
    // mode and missed the irreversible one — outtakes are hard-deleted (no
    // `deleted_at`, no trash, no 30-day window), so an apparently-empty card
    // invites the writer to delete the last copy of JSON a human could still
    // recover from the DB by hand. Flag it and let the card say so.
    corrupt = true;
    logger.warn(
      {
        parseError: err instanceof Error ? err.name : "UnknownError",
        outtake_id: row.id ?? "unknown",
      },
      "Corrupt JSON in outtake content",
    );
    content = { type: "doc", content: [] };
  }
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    label: (row.label as string | null) ?? null,
    content,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    // Omitted entirely (not `false`) on the happy path, matching the optional
    // `content_corrupt?: true` on the wire type.
    ...(corrupt ? { content_corrupt: true as const } : {}),
  };
}

export async function insert(db: Knex, data: CreateOuttakeData): Promise<OuttakeRow> {
  await db(TABLE).insert(data);
  // Re-read the persisted row rather than echoing the input, mirroring the
  // snapshots repo: any future DB-side default would otherwise diverge from
  // the returned shape, and the re-read confirms the write landed.
  const row = await db(TABLE).where({ id: data.id }).first();
  if (!row) throw new Error(`Outtake ${data.id} not found after insert`);
  return parseRow(row);
}

export async function findById(db: Knex, id: string): Promise<OuttakeRow | null> {
  const row = await db(TABLE).where({ id }).first();
  return row ? parseRow(row) : null;
}

export async function listByProject(db: Knex, projectId: string): Promise<OuttakeRow[]> {
  // Newest first. S8 (agentic-review 2026-08-04): the tie-break is `rowid DESC`,
  // not `id DESC` — ids are v4 UUIDs and carry no ordering information, so two
  // outtakes sharing a millisecond listed in UUID order, as likely oldest-first
  // as newest-first, against a contract that says newest first. rowid is
  // monotonic per insert, so a tie falls back to insertion order, which is what
  // "newest first" means when the timestamps cannot say.
  const rows = await db(TABLE)
    .where({ project_id: projectId })
    .orderBy([
      { column: "created_at", order: "desc" },
      { column: "rowid", order: "desc" },
    ]);
  return rows.map(parseRow);
}

export async function updateLabel(
  db: Knex,
  id: string,
  label: string | null,
  updatedAt: string,
): Promise<OuttakeRow | null> {
  await db(TABLE).where({ id }).update({ label, updated_at: updatedAt });
  return findById(db, id);
}

export async function remove(db: Knex, id: string): Promise<number> {
  return db(TABLE).where({ id }).del();
}
