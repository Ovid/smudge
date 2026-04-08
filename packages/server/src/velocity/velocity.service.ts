import type { VelocityResponse } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as VelocityRepo from "./velocity.repository";
import * as SettingsRepo from "../settings/settings.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";

// --- Pure business logic (exported for unit testing) ---

interface SaveEvent {
  id: string;
  chapter_id: string | null;
  project_id: string;
  word_count: number;
  saved_at: string;
}

interface Session {
  start: string;
  end: string;
  duration_minutes: number;
  chapters_touched: string[];
  net_words: number;
}

export function deriveSessions(
  events: SaveEvent[],
  preWindowBaselines: Record<string, number> = {},
): Session[] {
  if (events.length === 0) return [];

  const SESSION_GAP_MS = 30 * 60 * 1000;

  const sessionGroups: SaveEvent[][] = [];
  const firstEvent = events[0];
  if (!firstEvent) return [];
  let currentGroup: SaveEvent[] = [firstEvent];

  for (let i = 1; i < events.length; i++) {
    const prevEvent = events[i - 1];
    const currEvent = events[i];
    if (!prevEvent || !currEvent) continue;
    const prev = new Date(prevEvent.saved_at).getTime();
    const curr = new Date(currEvent.saved_at).getTime();
    if (curr - prev > SESSION_GAP_MS) {
      sessionGroups.push(currentGroup);
      currentGroup = [currEvent];
    } else {
      currentGroup.push(currEvent);
    }
  }
  sessionGroups.push(currentGroup);

  const lastSeenWordCount: Record<string, number> = { ...preWindowBaselines };
  const sessionBaselines: Record<string, number>[] = [];
  for (const group of sessionGroups) {
    sessionBaselines.push({ ...lastSeenWordCount });
    for (const evt of group) {
      const key = evt.chapter_id ?? `_purged_${evt.id}`;
      lastSeenWordCount[key] = evt.word_count;
    }
  }

  return sessionGroups.map((group, groupIdx) => {
    const groupFirst = group[0];
    const groupLast = group[group.length - 1];
    if (!groupFirst || !groupLast) {
      return { start: "", end: "", duration_minutes: 0, chapters_touched: [], net_words: 0 };
    }
    const start = groupFirst.saved_at;
    const end = groupLast.saved_at;
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    const durationMinutes = Math.round(durationMs / 60000);

    const lastInSessionByChapter: Record<string, SaveEvent> = {};
    for (const evt of group) {
      const key = evt.chapter_id ?? `_purged_${evt.id}`;
      lastInSessionByChapter[key] = evt;
    }
    const chapterIds = Object.keys(lastInSessionByChapter);

    const baselines = sessionBaselines[groupIdx] ?? {};
    let netWords = 0;
    for (const chapterId of chapterIds) {
      const lastInSession = lastInSessionByChapter[chapterId];
      if (!lastInSession) continue;
      const baseline = baselines[chapterId] ?? 0;
      netWords += lastInSession.word_count - baseline;
    }

    return {
      start,
      end,
      duration_minutes: durationMinutes,
      chapters_touched: chapterIds.filter((id) => !id.startsWith("_purged_")),
      net_words: netWords,
    };
  });
}

export function calculateStreaks(
  dates: string[],
  today: string,
): { current: number; best: number } {
  if (dates.length === 0) return { current: 0, best: 0 };

  const sorted = [...dates].sort((a, b) => b.localeCompare(a));

  function prevDay(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  let current = 0;
  let checkDate = today;
  const mostRecent = sorted[0];

  if (mostRecent !== undefined && mostRecent !== today) {
    checkDate = prevDay(today);
  }

  const dateSet = new Set(sorted);
  while (dateSet.has(checkDate)) {
    current++;
    checkDate = prevDay(checkDate);
  }

  let best = 0;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prevDate = sorted[i - 1];
    const currDate = sorted[i];
    if (!prevDate || !currDate) continue;
    const expected = prevDay(prevDate);
    if (currDate === expected) {
      run++;
    } else {
      best = Math.max(best, run);
      run = 1;
    }
  }
  best = Math.max(best, run);

  return { current, best };
}

export function calculateProjection(
  targetWordCount: number | null,
  targetDeadline: string | null,
  dailyAvg30d: number,
  currentTotal: number,
  today: string,
): {
  target_word_count: number | null;
  target_deadline: string | null;
  projected_date: string | null;
  daily_average_30d: number;
} {
  if (targetWordCount == null) {
    return {
      target_word_count: targetWordCount,
      target_deadline: targetDeadline,
      projected_date: null,
      daily_average_30d: dailyAvg30d,
    };
  }

  let projectedDate: string | null = null;
  if (dailyAvg30d > 0 && currentTotal < targetWordCount) {
    const daysRemaining = Math.ceil((targetWordCount - currentTotal) / dailyAvg30d);
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + daysRemaining);
    projectedDate = d.toISOString().slice(0, 10);
  }

  return {
    target_word_count: targetWordCount,
    target_deadline: targetDeadline,
    projected_date: projectedDate,
    daily_average_30d: dailyAvg30d,
  };
}

// --- Timezone helper ---

import { safeTimezone } from "../timezone";
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

export async function recordSave(
  projectId: string,
  chapterId: string,
  wordCount: number,
): Promise<void> {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const today = await getTodayDate();
    try {
      await VelocityRepo.insertSaveEvent(db, chapterId, projectId, wordCount, today, now);
    } catch (err) {
      console.error(
        `Failed to insert save event for chapter=${chapterId} project=${projectId}:`,
        err,
      );
    }
    try {
      const totalWordCount = await ChapterRepo.sumWordCountByProject(db, projectId);
      await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
    } catch (err) {
      console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
    }
  } catch (err) {
    console.error(`Velocity recordSave failed for project=${projectId}:`, err);
  }
}

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

// --- Velocity dashboard query ---

export async function getVelocityBySlug(slug: string): Promise<VelocityResponse | null> {
  const db = getDb();

  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const projectId = project.id;
  const today = await getTodayDate();

  // Daily snapshots: last 90 days
  const ninetyDaysAgo = new Date(today + "T00:00:00Z");
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
  const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().slice(0, 10);

  const dailySnapshots = await VelocityRepo.getDailySnapshots(db, projectId, ninetyDaysAgoStr);

  // Save events: last 30 days
  const thirtyDaysAgo = new Date(today + "T00:00:00Z");
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

  const recentEvents = await VelocityRepo.getRecentSaveEvents(db, projectId, thirtyDaysAgoStr);

  // Pre-window baselines
  const chapterIdsInWindow = [
    ...new Set(recentEvents.map((e) => e.chapter_id).filter((id): id is string => id !== null)),
  ];
  let preWindowBaselines: Record<string, number> = {};
  try {
    preWindowBaselines = await VelocityRepo.getPreWindowBaselines(
      db,
      projectId,
      chapterIdsInWindow,
      thirtyDaysAgoStr,
    );
  } catch (err) {
    console.error("Failed to fetch pre-window baselines for session net_words:", err);
    for (const evt of recentEvents) {
      const key = evt.chapter_id ?? `_purged_${evt.id}`;
      if (!(key in preWindowBaselines)) {
        preWindowBaselines[key] = evt.word_count;
      }
    }
  }

  const sessions = deriveSessions(recentEvents, preWindowBaselines);

  // Streaks
  const allDates = await VelocityRepo.getWritingDates(db, projectId, 400);
  const streak = calculateStreaks(allDates, today);

  // 30-day daily average
  const thirtyDaysAgoDateStr = thirtyDaysAgo.toISOString().slice(0, 10);
  let dailyAvg30d = 0;
  const newest = dailySnapshots[dailySnapshots.length - 1];
  if (newest) {
    const firstSnapshot = dailySnapshots[0];
    const baselineSnapshot = [...dailySnapshots]
      .reverse()
      .find((s) => s.date <= thirtyDaysAgoDateStr);
    const baselineTotal = baselineSnapshot
      ? baselineSnapshot.total_word_count
      : firstSnapshot
        ? firstSnapshot.total_word_count
        : 0;
    const baselineDate = baselineSnapshot
      ? baselineSnapshot.date
      : firstSnapshot
        ? firstSnapshot.date
        : newest.date;
    const msPerDay = 86_400_000;
    const daysCovered = Math.min(
      30,
      Math.max(
        1,
        Math.round(
          (new Date(newest.date + "T00:00:00Z").getTime() -
            new Date(baselineDate + "T00:00:00Z").getTime()) /
            msPerDay,
        ),
      ),
    );
    dailyAvg30d = Math.max(0, Math.round((newest.total_word_count - baselineTotal) / daysCovered));
  }

  // Current total (via chapters repository)
  const currentTotal = await ChapterRepo.sumWordCountByProject(db, projectId);

  const projection = calculateProjection(
    project.target_word_count ?? null,
    project.target_deadline ?? null,
    dailyAvg30d,
    currentTotal,
    today,
  );

  // Completion stats (via repositories)
  const chapters = await ChapterRepo.listIdTitleStatusByProject(db, projectId);
  let completedChapters = 0;
  const completionThreshold = project.completion_threshold;

  if (completionThreshold) {
    const thresholdRow = await ChapterStatusRepo.findByStatus(db, completionThreshold);
    const thresholdSortOrder = thresholdRow?.sort_order ?? 999;
    const allStatuses = await ChapterStatusRepo.list(db);
    const statusSortMap: Record<string, number> = {};
    for (const s of allStatuses) {
      statusSortMap[s.status] = s.sort_order;
    }
    for (const ch of chapters) {
      const chSortOrder = statusSortMap[ch.status] ?? 0;
      if (chSortOrder >= thresholdSortOrder) {
        completedChapters++;
      }
    }
  }

  const completion = {
    threshold_status: completionThreshold,
    total_chapters: chapters.length,
    completed_chapters: completedChapters,
  };

  // Chapter names (including deleted — via repository)
  const chapterNames = await ChapterRepo.getChapterNamesMapIncludingDeleted(db, projectId);

  return {
    daily_snapshots: dailySnapshots,
    sessions,
    streak,
    projection,
    completion,
    today,
    current_total: currentTotal,
    chapter_names: chapterNames,
  };
}
