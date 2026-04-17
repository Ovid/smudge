// Wire-shape types live in @smudge/shared so client and server agree.
// Only server-internal types remain here.
export type { SnapshotRow, SnapshotListItem } from "@smudge/shared";
import type { SnapshotRow } from "@smudge/shared";

/** Server-internal insertion shape for the chapter_snapshots row. */
export type CreateSnapshotData = SnapshotRow;
