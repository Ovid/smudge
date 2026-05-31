import type {
  ChapterStatusRow as SharedChapterStatusRow,
  ChapterStatusValue,
} from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import type { ChapterStatusRow } from "./chapter-statuses.types";

function toChapterStatus(row: ChapterStatusRow): SharedChapterStatusRow {
  return {
    // DB→type boundary: the chapter_statuses rows are seed-controlled and the
    // status column is enum-constrained at every write, so the raw string is a
    // trusted ChapterStatusValue here.
    status: row.status as ChapterStatusValue,
    sort_order: row.sort_order,
    label: row.label,
  };
}

export async function listStatuses(): Promise<SharedChapterStatusRow[]> {
  const store = getProjectStore();
  const rows = await store.listStatuses();
  return rows.map(toChapterStatus);
}
