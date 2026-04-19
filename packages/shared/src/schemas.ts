import { z } from "zod";
import { MAX_TIPTAP_DEPTH, validateTipTapDepth } from "./tiptap-depth";

// Re-export so existing `import { MAX_TIPTAP_DEPTH, validateTipTapDepth }
// from ".../schemas"` callers continue to work.
export { MAX_TIPTAP_DEPTH, validateTipTapDepth };

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

export const TipTapDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough()
  .refine((doc) => validateTipTapDepth(doc, 0), {
    message: `TipTap document exceeds maximum nesting depth (${MAX_TIPTAP_DEPTH}).`,
  });

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
 *   - All C0 control chars including TAB (U+0000..U+001F), DEL (U+007F)
 *   - C1 control chars (U+0080..U+009F) — non-printing
 *   - Bidi overrides (U+202A..U+202E, U+2066..U+2069) — Trojan-Source-style
 *   - Line/paragraph separators (U+2028, U+2029) — break list row layout
 *   - Zero-width chars (U+200B..U+200D, U+2060, U+FEFF)
 *
 * Exported so server auto-snapshot labels (built from user search/replace
 * strings) share the same sanitization surface as manual snapshots.
 */
export function sanitizeSnapshotLabel(raw: string): string {
  return (
    raw
      // Strip ALL C0 (including TAB U+0009) and C1 control characters. TAB
      // was previously preserved but disrupts list-row column alignment
      // and can be used for crude display spoofing.
      // eslint-disable-next-line no-control-regex -- intentionally strips control chars
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
      // Strip bidi overrides + line/paragraph separators.
      .replace(/[\u202A-\u202E\u2066-\u2069\u2028\u2029]/g, "")
      // Strip zero-width chars (ZWSP, ZWNJ, ZWJ, word joiner, BOM).
      // Left intact these render as nothing but compare/search differently,
      // enabling snapshot-label spoofing in the list view.
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      // Strip Unicode non-characters (U+FDD0..U+FDEF, U+FFFE, U+FFFF) from
      // the BMP. These code points are permanently reserved as
      // non-characters; fonts render them inconsistently (blank, tofu,
      // replacement). Letting them into a label produces display that
      // looks shorter than the stored string — useful for list-view spoof.
      .replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, "")
      // Strip supplementary-plane non-characters (U+nFFFE / U+nFFFF for
      // every plane n in 1..16). In surrogate encoding, those are pairs
      // where (high & 0x3F) === 0x3F AND (low & 0x3FF) ∈ {0x3FE, 0x3FF}
      // — the low 16 bits of the code point equal 0xFFFE / 0xFFFF.
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, (pair) => {
        const hi = pair.charCodeAt(0);
        const lo = pair.charCodeAt(1);
        const lo10 = lo & 0x3ff;
        const isNonChar = (hi & 0x3f) === 0x3f && (lo10 === 0x3fe || lo10 === 0x3ff);
        return isNonChar ? "" : pair;
      })
      // Strip unpaired surrogates. A well-formed JSON string CAN contain
      // lone surrogate code units (RFC 8259 § 8.2), but they don't form a
      // valid UTF-16 code point — stored as-is they render as U+FFFD and
      // break grapheme-aware length clamps downstream.
      .replace(/[\uD800-\uDFFF]/g, (ch, offset, full) => {
        const code = ch.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = full.charCodeAt(offset + 1);
          if (next >= 0xdc00 && next <= 0xdfff) return ch; // valid high surrogate
          return "";
        }
        // Low surrogate: valid only if preceded by a high surrogate.
        const prev = full.charCodeAt(offset - 1);
        if (prev >= 0xd800 && prev <= 0xdbff) return ch;
        return "";
      })
  );
}

export const CreateSnapshotSchema = z
  .object({
    label: z
      .string()
      .transform(sanitizeSnapshotLabel)
      .pipe(z.string().trim().max(500, "Label is too long"))
      .optional(),
  })
  .strict();
