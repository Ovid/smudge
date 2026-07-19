/**
 * Truncate to at most `max` UTF-16 code units without leaving a lone high
 * surrogate at the end. Slicing mid-surrogate-pair yields a dangling high
 * surrogate that renders as U+FFFD; drop it so the cut lands on a whole
 * character. Returns the string unchanged when it already fits.
 */
export function truncateUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  // High surrogate range U+D800–U+DBFF: a code unit here is the first half of
  // a pair whose second half was sliced off.
  if (last >= 0xd800 && last <= 0xdbff) return cut.slice(0, -1);
  return cut;
}
