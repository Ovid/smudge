import type { Knex } from "knex";
import { asyncHandler } from "../app";
import { getTodayDate } from "./velocityHelpers";

interface SaveEvent {
  id: string;
  chapter_id: string;
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

  const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

  // Split into session groups
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

  // Build per-chapter baseline tracking: walk all events once,
  // recording the last word_count seen per chapter before each session starts.
  // This replaces the previous O(n²) approach of scanning backwards per chapter per session.
  const lastSeenWordCount: Record<string, number> = { ...preWindowBaselines };
  // Single pass: snapshot baselines at each session boundary
  const sessionBaselines: Record<string, number>[] = [];
  for (const group of sessionGroups) {
    // Capture baselines before this session starts
    sessionBaselines.push({ ...lastSeenWordCount });
    // Update lastSeenWordCount with all events in this session
    for (const evt of group) {
      lastSeenWordCount[evt.chapter_id] = evt.word_count;
    }
  }

  // For each session, calculate net_words using precomputed baselines
  return sessionGroups.map((group, groupIdx) => {
    const groupFirst = group[0];
    const groupLast = group[group.length - 1];
    if (!groupFirst || !groupLast) {
      return {
        start: "",
        end: "",
        duration_minutes: 0,
        chapters_touched: [],
        net_words: 0,
      };
    }
    const start = groupFirst.saved_at;
    const end = groupLast.saved_at;
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    const durationMinutes = Math.round(durationMs / 60000);

    // Track last event per chapter in this session and unique chapter IDs
    const lastInSessionByChapter: Record<string, SaveEvent> = {};
    for (const evt of group) {
      lastInSessionByChapter[evt.chapter_id] = evt;
    }
    const chapterIds = Object.keys(lastInSessionByChapter);

    // Calculate net_words using precomputed baselines
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
      chapters_touched: chapterIds,
      net_words: netWords,
    };
  });
}

export function calculateStreaks(
  dates: string[],
  today: string,
): { current: number; best: number } {
  if (dates.length === 0) return { current: 0, best: 0 };

  // dates should be sorted descending
  const sorted = [...dates].sort((a, b) => (a > b ? -1 : 1));

  // Helper to get previous day
  function prevDay(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // Current streak: start from today or yesterday
  let current = 0;
  let checkDate = today;
  const mostRecent = sorted[0];

  if (mostRecent !== undefined && mostRecent !== today) {
    // Today not in list; start from yesterday
    checkDate = prevDay(today);
  }

  const dateSet = new Set(sorted);
  while (dateSet.has(checkDate)) {
    current++;
    checkDate = prevDay(checkDate);
  }

  // Best streak: find longest run of consecutive days
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

export function velocityHandler(db: Knex) {
  return asyncHandler(async (req, res) => {
    // Look up project by slug
    const project = await db("projects")
      .where({ slug: req.params.slug })
      .whereNull("deleted_at")
      .first();

    if (!project) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Project not found." },
      });
      return;
    }

    const today = await getTodayDate(db);

    // Daily snapshots: last 90 days
    const ninetyDaysAgo = new Date(today + "T00:00:00Z");
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().slice(0, 10);

    const dailySnapshots = await db("daily_snapshots")
      .where({ project_id: project.id })
      .where("date", ">=", ninetyDaysAgoStr)
      .orderBy("date", "asc")
      .select("date", "total_word_count");

    // Save events: last 30 days for sessions (includes soft-deleted chapters)
    const thirtyDaysAgo = new Date(today + "T00:00:00Z");
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

    const recentEvents: SaveEvent[] = await db("save_events")
      .where({ project_id: project.id })
      .where("saved_at", ">=", thirtyDaysAgoStr)
      .orderBy("saved_at", "asc")
      .select("id", "chapter_id", "project_id", "word_count", "saved_at");

    // Fetch per-chapter baselines from immediately before the 30-day window
    // to prevent inflated net_words for chapters with older history
    const chapterIdsInWindow = [...new Set(recentEvents.map((e) => e.chapter_id))];
    const preWindowBaselines: Record<string, number> = {};
    if (chapterIdsInWindow.length > 0) {
      try {
        const baselines = await db("save_events as se1")
          .whereIn("se1.chapter_id", chapterIdsInWindow)
          .where("se1.project_id", project.id)
          .where("se1.saved_at", "<", thirtyDaysAgoStr)
          .whereNotExists(
            db("save_events as se2")
              .where("se2.chapter_id", db.raw("se1.chapter_id"))
              .where("se2.project_id", project.id)
              .where("se2.saved_at", "<", thirtyDaysAgoStr)
              .where("se2.saved_at", ">", db.raw("se1.saved_at")),
          )
          .select("se1.chapter_id", "se1.word_count");
        for (const row of baselines) {
          preWindowBaselines[row.chapter_id] = row.word_count;
        }
      } catch {
        // Best-effort: default to no baselines (net_words calculated from first event in window)
      }
    }

    const sessions = deriveSessions(recentEvents, preWindowBaselines);

    // Use daily_snapshots for streak calculation (already one row per day,
    // dates are timezone-correct from getTodayDate). Avoids loading unbounded
    // save_events into memory.
    // Cap at 400 days — sufficient for accurate streak calculation
    const allSnapshotDates: { date: string }[] = await db("daily_snapshots")
      .where({ project_id: project.id })
      .orderBy("date", "desc")
      .limit(400)
      .select("date");

    const allDates = allSnapshotDates.map((s) => s.date);

    const streak = calculateStreaks(allDates, today);

    // 30-day daily average: total change over a fixed 30-day calendar window.
    // Uses snapshot at/before the window start as baseline, divides by 30 days.
    // This avoids inflated averages when gaps exist (days with no writing).
    const thirtyDaysAgoDateStr = thirtyDaysAgo.toISOString().slice(0, 10);
    let dailyAvg30d = 0;
    const newest = dailySnapshots[dailySnapshots.length - 1];
    if (newest) {
      // Find the baseline: latest snapshot at or before 30 days ago
      const baselineSnapshot = [...dailySnapshots]
        .reverse()
        .find((s: { date: string }) => s.date <= thirtyDaysAgoDateStr);
      const baselineTotal = baselineSnapshot ? baselineSnapshot.total_word_count : 0;
      dailyAvg30d = Math.round((newest.total_word_count - baselineTotal) / 30);
    }

    // Current total word count
    const totalResult = await db("chapters")
      .where({ project_id: project.id })
      .whereNull("deleted_at")
      .sum("word_count as total");
    const currentTotal = Number(totalResult[0]?.total) || 0;

    const projection = calculateProjection(
      project.target_word_count ?? null,
      project.target_deadline ?? null,
      dailyAvg30d,
      currentTotal,
      today,
    );

    // Completion stats
    const completionThreshold = project.completion_threshold ?? null;
    const chapters = await db("chapters")
      .where({ project_id: project.id })
      .whereNull("deleted_at")
      .select("id", "title", "status");

    let completedChapters = 0;
    if (completionThreshold) {
      // Get threshold sort_order
      const thresholdRow = await db("chapter_statuses")
        .where({ status: completionThreshold })
        .first();
      const thresholdSortOrder = thresholdRow?.sort_order ?? 999;

      // Get all status sort_orders
      const allStatuses = await db("chapter_statuses").select("status", "sort_order");
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

    // Build chapter ID → title map for client display
    const chapterNames: Record<string, string> = {};
    for (const ch of chapters) {
      chapterNames[ch.id] = ch.title;
    }

    res.json({
      daily_snapshots: dailySnapshots,
      sessions,
      streak,
      projection,
      completion,
      today,
      current_total: currentTotal,
      chapter_names: chapterNames,
    });
  });
}
