import type { VelocityResponse } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { safeTimezone } from "../timezone";

const MS_PER_DAY = 86_400_000;

/** en-US locale gives numeric month/day/year parts via formatToParts */
const DATE_PARTS_LOCALE = "en-US";

// --- Timezone helper ---

export function formatDateFromParts(parts: Intl.DateTimeFormatPart[], tz: string): string {
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`formatDateFromParts: missing date parts for timezone "${tz}"`);
  }
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function getTodayDate(): Promise<string> {
  const store = getProjectStore();
  const row = await store.findSettingByKey("timezone");
  const tz = safeTimezone(row?.value || "UTC");
  const now = new Date();
  const parts = new Intl.DateTimeFormat(DATE_PARTS_LOCALE, {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return formatDateFromParts(parts, tz);
}

// --- Side-effect operations (called by chapters service) ---

/**
 * Snapshot today's word count total for velocity tracking.
 *
 * Opens its own transaction internally — must NOT be called from within
 * a store.transaction() callback (ProjectStore.transaction() does not support nesting).
 *
 * getTodayDate() is called before the transaction because it reads the
 * settings table via the root store. Reading via the root store while
 * a write transaction is active would deadlock on better-sqlite3.
 */
export async function updateDailySnapshot(projectId: string): Promise<void> {
  const store = getProjectStore();
  const today = await getTodayDate();
  await store.transaction(async (txStore) => {
    const totalWordCount = await txStore.sumChapterWordCountByProject(projectId);
    await txStore.upsertDailySnapshot(projectId, today, totalWordCount);
  });
}

/**
 * Record a content save for velocity tracking.
 *
 * Opens its own transaction internally — must NOT be called from within
 * a store.transaction() callback (ProjectStore.transaction() does not support nesting).
 */
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
  const actualDays = Math.max(
    1,
    Math.round(
      (new Date(today + "T00:00:00Z").getTime() -
        new Date(baseline.date + "T00:00:00Z").getTime()) /
        MS_PER_DAY,
    ),
  );
  const diff = currentTotal - baseline.total_word_count;
  if (diff <= 0) return 0;
  return Math.round(diff / actualDays);
}

export async function getVelocityBySlug(slug: string): Promise<VelocityResponse | null> {
  const store = getProjectStore();

  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const projectId = project.id;
  const today = await getTodayDate();
  const currentTotal = await store.sumChapterWordCountByProject(projectId);

  // Words today: current total minus last prior-day snapshot
  const lastPrior = await store.getLastPriorDaySnapshot(projectId, today);
  const wordsToday = lastPrior
    ? Math.max(0, currentTotal - lastPrior.total_word_count)
    : currentTotal;

  // Rolling averages: find baseline snapshot on or before N days ago
  const baseline7d = await store.getBaselineSnapshot(projectId, daysAgoDate(today, 7));
  const baseline30d = await store.getBaselineSnapshot(projectId, daysAgoDate(today, 30));

  const dailyAverage7d = computeRollingAverage(currentTotal, baseline7d, today);
  const dailyAverage30d = computeRollingAverage(currentTotal, baseline30d, today);

  // Projection
  const targetWordCount = project.target_word_count ?? null;
  const targetDeadline = project.target_deadline ?? null;
  const remainingWords =
    targetWordCount !== null ? Math.max(0, targetWordCount - currentTotal) : null;

  let daysUntilDeadline: number | null = null;
  if (targetDeadline) {
    daysUntilDeadline = Math.max(
      0,
      Math.round(
        (new Date(targetDeadline + "T00:00:00Z").getTime() -
          new Date(today + "T00:00:00Z").getTime()) /
          MS_PER_DAY,
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
