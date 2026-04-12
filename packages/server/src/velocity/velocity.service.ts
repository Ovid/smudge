import type { VelocityResponse } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as VelocityRepo from "./velocity.repository";
import * as SettingsRepo from "../settings/settings.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import { safeTimezone } from "../timezone";

// --- Timezone helper ---

export { safeTimezone };

export async function getTodayDate(): Promise<string> {
  const db = getDb();
  const row = await SettingsRepo.findByKey(db, "timezone");
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

// --- Side-effect operations (called by chapters service) ---

export async function updateDailySnapshot(projectId: string): Promise<void> {
  try {
    const db = getDb();
    const today = await getTodayDate();
    try {
      const totalWordCount = await ChapterRepo.sumWordCountByProject(db, projectId);
      await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
    } catch (err) {
      console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
    }
  } catch (err) {
    console.error(`Velocity updateDailySnapshot failed for project=${projectId}:`, err);
  }
}

export async function recordSave(projectId: string): Promise<void> {
  await updateDailySnapshot(projectId);
}

// --- Velocity query ---

function daysAgoDate(today: string, days: number): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeRollingAverage(
  currentTotal: number,
  baseline: { date: string; total_word_count: number } | undefined,
  today: string,
): number | null {
  if (!baseline) return null;
  const msPerDay = 86_400_000;
  const actualDays = Math.max(
    1,
    Math.round(
      (new Date(today + "T00:00:00Z").getTime() -
        new Date(baseline.date + "T00:00:00Z").getTime()) /
        msPerDay,
    ),
  );
  const diff = currentTotal - baseline.total_word_count;
  if (diff <= 0) return 0;
  return Math.round(diff / actualDays);
}

export async function getVelocityBySlug(slug: string): Promise<VelocityResponse | null> {
  const db = getDb();

  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const projectId = project.id;
  const today = await getTodayDate();
  const currentTotal = await ChapterRepo.sumWordCountByProject(db, projectId);

  // Words today: current total minus last prior-day snapshot
  const lastPrior = await VelocityRepo.getLastPriorDaySnapshot(db, projectId, today);
  const wordsToday = lastPrior
    ? Math.max(0, currentTotal - lastPrior.total_word_count)
    : currentTotal;

  // Rolling averages: find baseline snapshot on or before N days ago
  const baseline7d = await VelocityRepo.getBaselineSnapshot(db, projectId, daysAgoDate(today, 7));
  const baseline30d = await VelocityRepo.getBaselineSnapshot(db, projectId, daysAgoDate(today, 30));

  const dailyAverage7d = computeRollingAverage(currentTotal, baseline7d, today);
  const dailyAverage30d = computeRollingAverage(currentTotal, baseline30d, today);

  // Projection
  const targetWordCount = project.target_word_count ?? null;
  const targetDeadline = project.target_deadline ?? null;
  const remainingWords =
    targetWordCount !== null ? Math.max(0, targetWordCount - currentTotal) : null;

  let daysUntilDeadline: number | null = null;
  if (targetDeadline) {
    const msPerDay = 86_400_000;
    daysUntilDeadline = Math.max(
      0,
      Math.round(
        (new Date(targetDeadline + "T00:00:00Z").getTime() -
          new Date(today + "T00:00:00Z").getTime()) /
          msPerDay,
      ),
    );
  }

  let requiredPace: number | null = null;
  if (remainingWords !== null && daysUntilDeadline !== null && daysUntilDeadline > 0) {
    requiredPace = Math.ceil(remainingWords / daysUntilDeadline);
  }

  // Use 30d average if positive, fall back to 7d
  const bestAvg =
    dailyAverage30d !== null && dailyAverage30d > 0 ? dailyAverage30d : dailyAverage7d;
  let projectedCompletionDate: string | null = null;
  if (remainingWords !== null && remainingWords > 0 && bestAvg !== null && bestAvg > 0) {
    const daysRemaining = Math.ceil(remainingWords / bestAvg);
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + daysRemaining);
    projectedCompletionDate = d.toISOString().slice(0, 10);
  }

  return {
    words_today: wordsToday,
    daily_average_7d: dailyAverage7d,
    daily_average_30d: dailyAverage30d,
    current_total: currentTotal,
    target_word_count: targetWordCount,
    remaining_words: remainingWords,
    target_deadline: targetDeadline,
    days_until_deadline: daysUntilDeadline,
    required_pace: requiredPace,
    projected_completion_date: projectedCompletionDate,
    today,
  };
}
