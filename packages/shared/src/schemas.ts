import { z } from "zod";

export const ProjectMode = z.enum(["fiction", "nonfiction"]);

export const ChapterStatus = z.enum(["outline", "rough_draft", "revised", "edited", "final"]);

export const CreateProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  mode: ProjectMode,
});

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
    author_name: z
      .string()
      .trim()
      .max(500, "Author name is too long")
      .nullable()
      .transform((val) => (val === "" ? null : val)),
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
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const ExportFormat = z.enum(["html", "markdown", "plaintext", "docx", "epub"]);
export type ExportFormatType = z.infer<typeof ExportFormat>;

export const EXPORT_FILE_EXTENSIONS: Record<ExportFormatType, string> = {
  html: "html",
  markdown: "md",
  plaintext: "txt",
  docx: "docx",
  epub: "epub",
};

export const EXPORT_CONTENT_TYPES: Record<ExportFormatType, string> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  plaintext: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  epub: "application/epub+zip",
};

export const ExportSchema = z.object({
  format: ExportFormat,
  include_toc: z.boolean().default(true),
  chapter_ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
  epub_cover_image_id: z.string().uuid().optional(),
});

export const UpdateImageSchema = z
  .object({
    alt_text: z.string().max(1000, "Alt text is too long"),
    caption: z.string().max(2000, "Caption is too long"),
    source: z.string().max(1000, "Source is too long"),
    license: z.string().max(500, "License is too long"),
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

/**
 * Strip characters that would let a label spoof display in the snapshot
 * list:
 *   - C0/C1 control chars (except tab) — corrupt UI logs and terminals
 *   - Bidi overrides (U+202A..U+202E, U+2066..U+2069) — Trojan-Source-style
 *   - Line/paragraph separators (U+2028, U+2029) — break list row layout
 */
function sanitizeSnapshotLabel(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex -- intentionally strips control chars
      .replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, "")
      .replace(/[\u202A-\u202E\u2066-\u2069\u2028\u2029]/g, "")
  );
}

export const CreateSnapshotSchema = z.object({
  label: z
    .string()
    .transform(sanitizeSnapshotLabel)
    .pipe(z.string().trim().max(500, "Label is too long"))
    .optional(),
});
