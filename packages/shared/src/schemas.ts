import { z } from "zod";

export const ProjectMode = z.enum(["fiction", "nonfiction"]);

export const CreateProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  mode: ProjectMode,
});

export const UpdateProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
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
  })
  .refine((data) => data.title !== undefined || data.content !== undefined, {
    message: "Must provide at least title or content",
  });
