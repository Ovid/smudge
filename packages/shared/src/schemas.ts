import { z } from "zod";

export const ProjectMode = z.enum(["fiction", "nonfiction"]);

export const ChapterStatus = z.enum(["outline", "rough_draft", "revised", "edited", "final"]);

export const CreateProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  mode: ProjectMode,
});

export const CompletionThreshold = z.enum(["outline", "rough_draft", "revised", "edited", "final"]);

export const UpdateProjectSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
    target_word_count: z.number().int().positive().nullable(),
    target_deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
      .refine((d) => {
        const parts = d.split("-").map(Number);
        const y = parts[0] ?? 0;
        const m = parts[1] ?? 0;
        const day = parts[2] ?? 0;
        const date = new Date(Date.UTC(y, m - 1, day));
        return (
          date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === day
        );
      }, "Must be a valid date")
      .nullable(),
    completion_threshold: CompletionThreshold,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

const TipTapDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const ReorderChaptersSchema = z.object({
  chapter_ids: z.array(z.string().uuid()),
});

export const UpdateChapterSchema = z
  .object({
    title: z.string().trim().min(1).max(500, "Title is too long"),
    content: TipTapDocSchema,
    status: ChapterStatus,
    target_word_count: z.number().int().positive().nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const UpdateSettingsSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string(),
      }),
    )
    .min(1, "At least one setting must be provided"),
});

export function calculateWordsToday(
  currentTotal: number,
  snapshots: Array<{ date: string; total_word_count: number }>,
  today: string,
): number {
  const priorDaySnapshots = snapshots
    .filter((s) => s.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));

  const lastPrior = priorDaySnapshots[0];
  if (!lastPrior) {
    return currentTotal;
  }

  return currentTotal - lastPrior.total_word_count;
}
