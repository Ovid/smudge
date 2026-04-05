import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

export function safeTimezone(tz: string): string {
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function getTodayDate(db: Knex): Promise<string> {
  const row = await db("settings").where({ key: "timezone" }).first();
  const tz = safeTimezone(row?.value || "UTC");
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export async function insertSaveEvent(
  db: Knex,
  chapterId: string,
  projectId: string,
  wordCount: number,
  today: string,
): Promise<void> {
  try {
    await db("save_events").insert({
      id: uuid(),
      chapter_id: chapterId,
      project_id: projectId,
      word_count: wordCount,
      saved_at: new Date().toISOString(),
      save_date: today,
    });
  } catch (err) {
    console.error(
      `Failed to insert save event for chapter=${chapterId} project=${projectId}:`,
      err,
    );
  }
}

export async function upsertDailySnapshot(
  db: Knex,
  projectId: string,
  today: string,
): Promise<void> {
  try {
    const result = await db("chapters")
      .where({ project_id: projectId })
      .whereNull("deleted_at")
      .sum("word_count as total");
    const totalWordCount = Number(result[0]?.total) || 0;

    await db.raw(
      `INSERT INTO daily_snapshots (id, project_id, date, total_word_count, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, date) DO UPDATE SET total_word_count = excluded.total_word_count`,
      [uuid(), projectId, today, totalWordCount, new Date().toISOString()],
    );
  } catch (err) {
    console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
  }
}
