import { sanitizeSnapshotLabel, truncateUnits, LABEL_MAX_UNITS } from "@smudge/shared";
import { truncateGraphemes } from "../utils/grapheme";

/**
 * Apply the sanitize + truncate pipeline that CreateSnapshotSchema applies to
 * manual labels — kept in one place so search-replace auto snapshots and
 * snapshot-restore auto snapshots stay in sync if the column cap or the
 * sanitizer ever changes.
 *
 * The caller is responsible for grapheme-truncating any USER-supplied
 * fragments before embedding in the template (so the cap isn't consumed by an
 * emoji-heavy search string).
 *
 * I4 (dedup review 2026-07-26): the final clamp is in UTF-16 code units,
 * because that is the unit the schema's cap is written in. It used to truncate
 * at 500 GRAPHEMES against a schema that rejects above 500 CODE UNITS — twice
 * as permissive for emoji, and this path never passes through Zod at all
 * (insertAutoSnapshotIfChanged writes straight to the store). A manual label of
 * 250 emoji is exactly at the cap, and embedding it in the restore template
 * added 20 more units, so the server stored a 520-unit label in a column whose
 * own API rejects 501.
 *
 * The grapheme pass runs first so the cut still lands on a whole grapheme
 * cluster in the common case; truncateUnits then guarantees the invariant and
 * is itself surrogate-safe, so neither pass can leave a dangling half-pair.
 */
export function buildAutoSnapshotLabel(template: string): string {
  const sanitized = sanitizeSnapshotLabel(template);
  return truncateUnits(truncateGraphemes(sanitized, LABEL_MAX_UNITS), LABEL_MAX_UNITS);
}
