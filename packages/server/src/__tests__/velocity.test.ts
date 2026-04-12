import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { v4 as uuid } from "uuid";
import { safeTimezone } from "../timezone";
import { formatDateFromParts } from "../velocity/velocity.service";

describe("safeTimezone", () => {
  it("returns the timezone unchanged when valid", () => {
    expect(safeTimezone("America/New_York")).toBe("America/New_York");
  });

  it("returns UTC for an invalid timezone string", () => {
    expect(safeTimezone("Not/AReal_Zone")).toBe("UTC");
  });
});

describe("formatDateFromParts", () => {
  it("formats valid Intl parts into YYYY-MM-DD", () => {
    const parts: Intl.DateTimeFormatPart[] = [
      { type: "month", value: "04" },
      { type: "literal", value: "/" },
      { type: "day", value: "12" },
      { type: "literal", value: "/" },
      { type: "year", value: "2026" },
    ];
    expect(formatDateFromParts(parts, "UTC")).toBe("2026-04-12");
  });

  it("throws when year part is missing", () => {
    const parts: Intl.DateTimeFormatPart[] = [
      { type: "month", value: "04" },
      { type: "day", value: "12" },
    ];
    expect(() => formatDateFromParts(parts, "UTC")).toThrow(
      'getTodayDate: missing date parts for timezone "UTC"',
    );
  });

  it("throws when month part is missing", () => {
    const parts: Intl.DateTimeFormatPart[] = [
      { type: "year", value: "2026" },
      { type: "day", value: "12" },
    ];
    expect(() => formatDateFromParts(parts, "UTC")).toThrow("missing date parts");
  });

  it("throws when day part is missing", () => {
    const parts: Intl.DateTimeFormatPart[] = [
      { type: "year", value: "2026" },
      { type: "month", value: "04" },
    ];
    expect(() => formatDateFromParts(parts, "UTC")).toThrow("missing date parts");
  });
});

const t = setupTestDb();

/**
 * Freeze time to noon UTC so date-dependent assertions are stable
 * and never flake around midnight UTC boundaries.
 */
const FROZEN_NOW = new Date("2026-06-15T12:00:00Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

/** Return a YYYY-MM-DD date string for N days ago (relative to FROZEN_NOW) */
function daysAgoDate(n: number): string {
  const d = new Date(FROZEN_NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Today's date as YYYY-MM-DD */
function todayDate(): string {
  return "2026-06-15";
}

async function createProjectWithChapter(overrides?: {
  target_word_count?: number;
  target_deadline?: string;
}) {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: `Velocity Test ${uuid().slice(0, 8)}`, mode: "fiction" });
  const project = res.body;
  const chapters = await t.db("chapters").where({ project_id: project.id }).select("id");

  if (overrides) {
    await request(t.app).patch(`/api/projects/${project.slug}`).send(overrides);
  }

  return { projectId: project.id, chapterId: chapters[0].id, slug: project.slug };
}

async function insertSnapshot(projectId: string, date: string, totalWordCount: number) {
  await t.db("daily_snapshots").insert({
    id: uuid(),
    project_id: projectId,
    date,
    total_word_count: totalWordCount,
    created_at: new Date().toISOString(),
  });
}

async function setChapterWordCount(chapterId: string, wordCount: number) {
  await t.db("chapters").where({ id: chapterId }).update({ word_count: wordCount });
}

describe("GET /api/projects/:slug/velocity", () => {
  // --- Empty state ---

  it("returns empty shape for project with no snapshots", async () => {
    const { slug } = await createProjectWithChapter();

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.status).toBe(200);
    expect(res.body.words_today).toBe(0);
    expect(res.body.current_total).toBe(0);
    expect(res.body.daily_average_7d).toBeNull();
    expect(res.body.daily_average_30d).toBeNull();
    expect(res.body.projected_completion_date).toBeNull();
    expect(res.body.target_word_count).toBeNull();
    expect(res.body.remaining_words).toBeNull();
    expect(res.body.target_deadline).toBeNull();
    expect(res.body.days_until_deadline).toBeNull();
    expect(res.body.required_pace).toBeNull();
    expect(res.body.today).toBe(todayDate());
  });

  // --- words_today ---

  it("words_today equals current_total when no prior-day snapshot exists", async () => {
    const { slug, chapterId } = await createProjectWithChapter();
    await setChapterWordCount(chapterId, 500);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.words_today).toBe(500);
    expect(res.body.current_total).toBe(500);
  });

  it("words_today is delta from prior-day snapshot", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    // Yesterday's snapshot: 300 words
    await insertSnapshot(projectId, daysAgoDate(1), 300);
    // Current total: 500 words
    await setChapterWordCount(chapterId, 500);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.words_today).toBe(200); // 500 - 300
    expect(res.body.current_total).toBe(500);
  });

  it("words_today uses the most recent prior-day snapshot", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    await insertSnapshot(projectId, daysAgoDate(3), 100);
    await insertSnapshot(projectId, daysAgoDate(1), 400);
    await setChapterWordCount(chapterId, 600);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    // Should use yesterday's snapshot (400), not 3 days ago (100)
    expect(res.body.words_today).toBe(200); // 600 - 400
  });

  it("words_today clamps to 0 when current total is less than prior snapshot", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    // Yesterday's snapshot: 800 words
    await insertSnapshot(projectId, daysAgoDate(1), 800);
    // Writer deleted content — current total is now 500
    await setChapterWordCount(chapterId, 500);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.words_today).toBe(0); // clamped, not -300
    expect(res.body.current_total).toBe(500);
  });

  // --- Rolling averages (7d) ---

  it("returns daily_average_7d from snapshot 7 days ago", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    // Baseline 7 days ago: 300 words
    await insertSnapshot(projectId, daysAgoDate(7), 300);
    // Current: 1000 words
    await setChapterWordCount(chapterId, 1000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    // (1000 - 300) / 7 = 100
    expect(res.body.daily_average_7d).toBe(100);
  });

  it("returns null daily_average_7d when no baseline snapshot exists", async () => {
    const { slug, chapterId } = await createProjectWithChapter();
    await setChapterWordCount(chapterId, 1000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.daily_average_7d).toBeNull();
  });

  // --- Rolling averages (30d) ---

  it("returns daily_average_30d from snapshot 30 days ago", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    await insertSnapshot(projectId, daysAgoDate(30), 1000);
    await setChapterWordCount(chapterId, 4000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    // (4000 - 1000) / 30 = 100
    expect(res.body.daily_average_30d).toBe(100);
  });

  // --- Rolling average with missing days (uses nearest earlier snapshot) ---

  it("uses nearest earlier snapshot when no snapshot on exact target date", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    // No snapshot exactly 7 days ago; nearest is 10 days ago
    await insertSnapshot(projectId, daysAgoDate(10), 200);
    await setChapterWordCount(chapterId, 1200);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    // (1200 - 200) / 10 = 100 — divisor is actual elapsed days (10), not 7
    expect(res.body.daily_average_7d).toBe(100);
  });

  it("returns 0 average when current total equals baseline", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    await insertSnapshot(projectId, daysAgoDate(7), 500);
    await setChapterWordCount(chapterId, 500);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.daily_average_7d).toBe(0);
  });

  // --- Projection ---

  it("returns projected_completion_date with target and 30d average", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter({
      target_word_count: 10000,
    });

    // 30d baseline: 5000 words 30 days ago; current 8000 => avg 100/day
    await insertSnapshot(projectId, daysAgoDate(30), 5000);
    await setChapterWordCount(chapterId, 8000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.daily_average_30d).toBe(100);
    expect(res.body.remaining_words).toBe(2000);
    // 2000 / 100 = 20 days from today
    const expectedDate = new Date(todayDate() + "T00:00:00Z");
    expectedDate.setUTCDate(expectedDate.getUTCDate() + 20);
    expect(res.body.projected_completion_date).toBe(expectedDate.toISOString().slice(0, 10));
  });

  // --- Projection fallback to 7d ---

  it("uses 7d average for projection when no 30d data available", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter({
      target_word_count: 5000,
    });

    // Only a 7d baseline exists (no snapshot 30+ days ago)
    await insertSnapshot(projectId, daysAgoDate(7), 1000);
    await setChapterWordCount(chapterId, 1700);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.daily_average_30d).toBeNull();
    expect(res.body.daily_average_7d).toBe(100); // (1700-1000)/7
    // remaining = 5000 - 1700 = 3300 => 3300/100 = 33 days
    const expectedDate = new Date(todayDate() + "T00:00:00Z");
    expectedDate.setUTCDate(expectedDate.getUTCDate() + 33);
    expect(res.body.projected_completion_date).toBe(expectedDate.toISOString().slice(0, 10));
  });

  // --- Projection null cases ---

  it("returns null projection when no target is set", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();

    await insertSnapshot(projectId, daysAgoDate(7), 500);
    await setChapterWordCount(chapterId, 1200);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.target_word_count).toBeNull();
    expect(res.body.projected_completion_date).toBeNull();
  });

  it("returns null projection when no average data exists", async () => {
    const { slug, chapterId } = await createProjectWithChapter({
      target_word_count: 80000,
    });
    await setChapterWordCount(chapterId, 1000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.daily_average_7d).toBeNull();
    expect(res.body.daily_average_30d).toBeNull();
    expect(res.body.projected_completion_date).toBeNull();
  });

  it("returns null projection when target is already met", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter({
      target_word_count: 5000,
    });

    await insertSnapshot(projectId, daysAgoDate(7), 3000);
    await setChapterWordCount(chapterId, 6000); // already past target

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.remaining_words).toBe(0);
    expect(res.body.projected_completion_date).toBeNull();
  });

  // --- required_pace ---

  it("calculates required_pace with target and deadline", async () => {
    const deadline = new Date(todayDate() + "T00:00:00Z");
    deadline.setUTCDate(deadline.getUTCDate() + 50);
    const deadlineStr = deadline.toISOString().slice(0, 10);

    const { slug, chapterId } = await createProjectWithChapter({
      target_word_count: 60000,
      target_deadline: deadlineStr,
    });
    await setChapterWordCount(chapterId, 10000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    // remaining = 50000, days = 50 => pace = 1000
    expect(res.body.remaining_words).toBe(50000);
    expect(res.body.days_until_deadline).toBe(50);
    expect(res.body.required_pace).toBe(1000);
  });

  it("returns null required_pace when no deadline is set", async () => {
    const { slug, chapterId } = await createProjectWithChapter({
      target_word_count: 60000,
    });
    await setChapterWordCount(chapterId, 10000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.days_until_deadline).toBeNull();
    expect(res.body.required_pace).toBeNull();
  });

  // --- days_until_deadline ---

  it("calculates days_until_deadline correctly", async () => {
    const deadline = new Date(todayDate() + "T00:00:00Z");
    deadline.setUTCDate(deadline.getUTCDate() + 30);
    const deadlineStr = deadline.toISOString().slice(0, 10);

    const { slug } = await createProjectWithChapter({
      target_word_count: 80000,
      target_deadline: deadlineStr,
    });

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.days_until_deadline).toBe(30);
  });

  it("returns 0 days_until_deadline for past deadline", async () => {
    const { slug } = await createProjectWithChapter({
      target_word_count: 80000,
      target_deadline: daysAgoDate(5),
    });

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.days_until_deadline).toBe(0);
  });

  it("returns null required_pace when deadline has passed (days = 0)", async () => {
    const { slug, chapterId } = await createProjectWithChapter({
      target_word_count: 80000,
      target_deadline: daysAgoDate(5),
    });
    await setChapterWordCount(chapterId, 10000);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.days_until_deadline).toBe(0);
    expect(res.body.required_pace).toBeNull();
  });

  // --- 404 for non-existent project ---

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/no-such-project/velocity");
    expect(res.status).toBe(404);
  });
});
