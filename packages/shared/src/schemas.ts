import { z } from "zod";

export const ProjectMode = z.enum(["fiction", "nonfiction"]);

export const ChapterStatus = z.enum(["outline", "rough_draft", "revised", "edited", "final"]);

export const CreateProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  mode: ProjectMode,
});

export const UpdateProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
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
    title: z.string().trim().min(1).optional(),
    content: TipTapDocSchema.optional(),
    status: ChapterStatus.optional(),
  })
  .refine(
    (data) => data.title !== undefined || data.content !== undefined || data.status !== undefined,
    {
      message: "Must provide at least title, content, or status",
    },
  );
