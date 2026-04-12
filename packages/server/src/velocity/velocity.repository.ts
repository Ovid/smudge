import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

export async function upsertDailySnapshot(
  db: Knex.Transaction | Knex,
  projectId: string,
  today: string,
  totalWordCount: number,
): Promise<void> {
  await db.raw(
    `INSERT INTO daily_snapshots (id, project_id, date, total_word_count, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, date) DO UPDATE SET total_word_count = excluded.total_word_count`,
    [uuid(), projectId, today, totalWordCount, new Date().toISOString()],
  );
}

export async function getBaselineSnapshot(
  db: Knex.Transaction | Knex,
  projectId: string,
  targetDate: string,
): Promise<{ date: string; total_word_count: number } | undefined> {
  return db("daily_snapshots")
    .where({ project_id: projectId })
    .where("date", "<=", targetDate)
    .orderBy("date", "desc")
    .first("date", "total_word_count");
}

export async function getLastPriorDaySnapshot(
  db: Knex.Transaction | Knex,
  projectId: string,
  today: string,
): Promise<{ date: string; total_word_count: number } | undefined> {
  return db("daily_snapshots")
    .where({ project_id: projectId })
    .where("date", "<", today)
    .orderBy("date", "desc")
    .first("date", "total_word_count");
}
