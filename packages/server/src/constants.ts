/**
 * Maximum size in bytes for a single chapter's serialized TipTap JSON.
 * This is the single source of truth for the cap used by:
 *   - express.json() body limit in app.ts (so oversized requests fail
 *     at the parser with a 413 rather than after processing);
 *   - replace-in-project in search.service (prevents amplification DoS
 *     where a tiny pattern explodes content past the write limit);
 *   - restoreSnapshot in snapshots.service (rejects legacy oversized
 *     snapshot rows before parse+schema walk).
 *
 * The numeric value and the "5mb" string passed to express.json MUST
 * agree — changing one without the other silently breaks the request
 * pipeline (either autosave fails with no CONTENT_TOO_LARGE code, or
 * replace writes exceed what autosave can read back).
 */
export const MAX_CHAPTER_CONTENT_BYTES = 5 * 1024 * 1024;
export const MAX_CHAPTER_CONTENT_LIMIT_STRING = "5mb";
