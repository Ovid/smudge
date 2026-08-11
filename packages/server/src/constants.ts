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
 * S8 (dedup review 2026-07-26): this used to be TWO constants — the byte
 * count and a "5mb" string for express.json — restating one limit in two
 * representations, with a comment insisting they MUST agree and nothing
 * asserting it. body-parser accepts a numeric byte limit directly
 * (`typeof opts.limit !== 'number' ? bytes.parse(...) : opts.limit`), so the
 * string was deleted and the divergence made unrepresentable rather than
 * merely forbidden.
 */
export const MAX_CHAPTER_CONTENT_BYTES = 5 * 1024 * 1024;
