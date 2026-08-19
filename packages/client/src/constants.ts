/**
 * Client-wide constants that no single component owns.
 *
 * Sibling of `strings.ts` / `statusColors.ts` / `sanitizer.ts` — top-level
 * modules holding cross-cutting client values.
 */

/**
 * How long an `aria-live` region holds an image announcement before clearing.
 *
 * F-32 (architecture report 2026-08-11): this was `ANNOUNCEMENT_DURATION`,
 * module-private in `ImageGallery`, plus an identical inline `3000` in
 * `EditorPage` for the same concept — two owners of one accessibility-relevant
 * value, free to drift apart.
 *
 * Dwell time is an a11y decision: too short and a screen reader is cut off
 * mid-sentence, too long and stale text is still being read when the next
 * action starts. Change it here and both surfaces move together.
 */
export const ANNOUNCEMENT_DURATION_MS = 3000;

/**
 * How long the chapter-navigation announcement dwells. Deliberately shorter
 * than {@link ANNOUNCEMENT_DURATION_MS}.
 *
 * The difference is preserved as found, NOT justified: F-32 flagged this value
 * as undocumented, and no recorded rationale for the 3x gap was located when
 * the two were brought together here. A plausible story exists — arrow-key
 * navigation repeats, so a long dwell would leave stale destinations queued —
 * but it is a reconstruction, and writing a guess here would launder it into a
 * decision someone made. If you know why, replace this paragraph. If you are
 * about to unify the two values, note that you would be changing a11y timing
 * on the strength of the same missing rationale.
 */
export const NAV_ANNOUNCEMENT_DURATION_MS = 1000;
