import { sanitizeSnapshotLabel } from "@smudge/shared";
import { truncateGraphemes } from "../utils/grapheme";

/**
 * Apply the sanitize + grapheme-truncate pipeline that CreateSnapshotSchema
 * applies to manual labels — kept in one place so search-replace auto
 * snapshots and snapshot-restore auto snapshots stay in sync if the column
 * cap or sanitizer ever changes.
 *
 * The caller is responsible for grapheme-truncating any USER-supplied
 * fragments before embedding in the template (so the 500-cap isn't
 * consumed by an emoji-heavy search string).
 */
export const AUTO_LABEL_MAX = 500;

export function buildAutoSnapshotLabel(template: string, max: number = AUTO_LABEL_MAX): string {
  return truncateGraphemes(sanitizeSnapshotLabel(template), max);
}
