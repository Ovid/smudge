import type { Knex } from "knex";
import type { OuttakeRow, CreateOuttakeData } from "./outtakes.types";
import { logger } from "../logger";

const TABLE = "outtakes";

// The DB stores `content` as a stringified TipTap doc; the wire type
// (OuttakeRow) carries it parsed. Parse on read so callers never see the raw
// column string.
function parseRow(row: Record<string, unknown>): OuttakeRow {
  let content: Record<string, unknown>;
  try {
    content = JSON.parse(row.content as string) as Record<string, unknown>;
  } catch (err) {
    // ponytail: degrade one corrupt row to an empty doc (not a corrupt-flag
    // like chapters). Single-user, unreachable in-app, and keeps content
    // non-null so no client corrupt-branch is needed — the row still lists so
    // it stays deletable, instead of one bad row 500-ing the whole drawer.
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
  // Newest first; secondary `id DESC` breaks ties when two outtakes share the
  // same millisecond ISO timestamp so ordering stays deterministic.
  const rows = await db(TABLE)
    .where({ project_id: projectId })
    .orderBy([
      { column: "created_at", order: "desc" },
      { column: "id", order: "desc" },
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
