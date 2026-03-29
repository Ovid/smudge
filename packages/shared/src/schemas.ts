import { z } from "zod";

export const ProjectMode = z.enum(["fiction", "nonfiction"]);

export const CreateProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  mode: ProjectMode,
});

const TipTapDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const UpdateChapterSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    content: TipTapDocSchema.optional(),
  })
  .refine((data) => data.title !== undefined || data.content !== undefined, {
    message: "Must provide at least title or content",
  });
