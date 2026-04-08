import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import type { SaveEventRow } from "./velocity.types";

export async function insertSaveEvent(
  db: Knex.Transaction | Knex,
  chapterId: string,
  projectId: string,
  wordCount: number,
  today: string,
): Promise<void> {
  await db("save_events").insert({
    id: uuid(),
    chapter_id: chapterId,
    project_id: projectId,
    word_count: wordCount,
    saved_at: new Date().toISOString(),
    save_date: today,
  });
}

export async function upsertDailySnapshot(
  db: Knex.Transaction | Knex,
  projectId: string,
  today: string,
  totalWordCount: number,
): Promise<void> {
  // Raw SQL: Knex's .onConflict().merge() is unreliable with SQLite; native upsert is atomic
  await db.raw(
    `INSERT INTO daily_snapshots (id, project_id, date, total_word_count, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, date) DO UPDATE SET total_word_count = excluded.total_word_count`,
    [uuid(), projectId, today, totalWordCount, new Date().toISOString()],
  );
}

export async function getDailySnapshots(
  db: Knex.Transaction | Knex,
  projectId: string,
  sinceDate: string,
): Promise<Array<{ date: string; total_word_count: number }>> {
  return db("daily_snapshots")
    .where({ project_id: projectId })
    .where("date", ">=", sinceDate)
    .orderBy("date", "asc")
    .select("date", "total_word_count");
}

export async function getRecentSaveEvents(
  db: Knex.Transaction | Knex,
  projectId: string,
  sinceTimestamp: string,
): Promise<SaveEventRow[]> {
  return db("save_events")
    .where({ project_id: projectId })
    .where("saved_at", ">=", sinceTimestamp)
    .orderBy("saved_at", "asc")
    .select("id", "chapter_id", "project_id", "word_count", "saved_at", "save_date");
}

export async function getPreWindowBaselines(
  db: Knex.Transaction | Knex,
  projectId: string,
  chapterIds: string[],
  beforeTimestamp: string,
): Promise<Record<string, number>> {
  const baselines: Record<string, number> = {};
  if (chapterIds.length === 0) return baselines;

  const rows = await db("save_events as se1")
    .whereIn("se1.chapter_id", chapterIds)
    .where("se1.project_id", projectId)
    .where("se1.saved_at", "<", beforeTimestamp)
    .whereNotExists(
      db("save_events as se2")
        // Raw SQL: column-to-column refs in correlated subquery; Knex .whereColumn() exists
        // at runtime but its TypeScript types don't expose it on subquery builders
        .where("se2.chapter_id", db.raw("se1.chapter_id"))
        .where("se2.project_id", projectId)
        .where("se2.saved_at", "<", beforeTimestamp)
        .where("se2.saved_at", ">", db.raw("se1.saved_at")),
    )
    .select("se1.chapter_id", "se1.word_count");

  for (const row of rows) {
    if (row.chapter_id) baselines[row.chapter_id] = row.word_count;
  }
  return baselines;
}

export async function getWritingDates(
  db: Knex.Transaction | Knex,
  projectId: string,
  limit: number,
): Promise<string[]> {
  const rows: { date: string }[] = await db("daily_snapshots")
    .where("daily_snapshots.project_id", projectId)
    .whereExists(
      db("save_events")
        .where("save_events.project_id", projectId)
        // Raw SQL: column-to-column ref in correlated subquery; Knex .whereColumn()
        // exists at runtime but its TypeScript types don't expose it on subquery builders
        .whereRaw("save_events.save_date = daily_snapshots.date")
        // EXISTS only checks row existence; selecting literal 1 avoids reading actual columns
        .select(db.raw("1")),
    )
    .orderBy("date", "desc")
    .limit(limit)
    .select("daily_snapshots.date");
  return rows.map((r) => r.date);
}
