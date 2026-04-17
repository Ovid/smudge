// Wire-shape types live in @smudge/shared so client and server agree.
// Only server-internal types remain here.
import type { SnapshotRow } from "@smudge/shared";
export type { SnapshotRow, SnapshotListItem } from "@smudge/shared";

/** Server-internal insertion shape for the chapter_snapshots row. */
export type CreateSnapshotData = SnapshotRow;
