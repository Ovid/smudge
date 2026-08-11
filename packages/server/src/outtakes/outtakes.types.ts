// Wire-shape type lives in @smudge/shared so client and server agree.
// Only the server-internal insertion shape remains here.
export type { OuttakeRow } from "@smudge/shared";

/**
 * Server-internal insertion shape for the outtakes table.
 *
 * Deliberately NOT aliased to the outward-facing OuttakeRow: the wire type
 * carries `content` as a parsed TipTap object, whereas the DB persists it as a
 * stringified JSON column. Keeping the insert shape explicit marks that
 * serialize/parse boundary.
 */
export interface CreateOuttakeData {
  id: string;
  project_id: string;
  label: string | null;
  content: string; // stringified TipTap JSON at the persistence boundary
  created_at: string;
  updated_at: string;
}
