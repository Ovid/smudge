import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

export async function getTodayDate(db: Knex): Promise<string> {
  const row = await db("settings").where({ key: "timezone" }).first();
  const tz = row?.value || "UTC";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export async function insertSaveEvent(
  db: Knex,
  chapterId: string,
  projectId: string,
  wordCount: number,
): Promise<void> {
  try {
    await db("save_events").insert({
      id: uuid(),
      chapter_id: chapterId,
      project_id: projectId,
      word_count: wordCount,
      saved_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort: next save retries
  }
}

export async function upsertDailySnapshot(db: Knex, projectId: string): Promise<void> {
  try {
    const today = await getTodayDate(db);
    const result = await db("chapters")
      .where({ project_id: projectId })
      .whereNull("deleted_at")
      .sum("word_count as total");
    const totalWordCount = Number(result[0]?.total) || 0;

    const existing = await db("daily_snapshots")
      .where({ project_id: projectId, date: today })
      .first();

    if (existing) {
      await db("daily_snapshots")
        .where({ id: existing.id })
        .update({ total_word_count: totalWordCount });
    } else {
      await db("daily_snapshots").insert({
        id: uuid(),
        project_id: projectId,
        date: today,
        total_word_count: totalWordCount,
        created_at: new Date().toISOString(),
      });
    }
  } catch {
    // Best-effort: next save retries
  }
}
