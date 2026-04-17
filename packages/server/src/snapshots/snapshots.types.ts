// Wire-shape types live in @smudge/shared so client and server agree.
// Only server-internal types remain here.
export type { SnapshotRow, SnapshotListItem } from "@smudge/shared";

/**
 * Server-internal insertion shape for chapter_snapshots.
 *
 * Deliberately NOT aliased to the outward-facing SnapshotRow: coupling the
 * insert shape to the wire type makes it easy to accidentally widen one and
 * break the other (and obscures the DB boolean/int coercion boundary for
 * is_auto). Keep this shape minimal and explicit.
 */
export interface CreateSnapshotData {
  id: string;
  chapter_id: string;
  label: string | null;
  content: string;
  word_count: number;
  is_auto: boolean;
  created_at: string;
}
