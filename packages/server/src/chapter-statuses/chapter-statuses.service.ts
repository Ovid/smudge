import type { ChapterStatusRow as SharedChapterStatusRow } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import type { ChapterStatusRow } from "./chapter-statuses.types";

function toChapterStatus(row: ChapterStatusRow): SharedChapterStatusRow {
  return {
    status: row.status,
    sort_order: row.sort_order,
    label: row.label,
  };
}

export async function listStatuses(): Promise<SharedChapterStatusRow[]> {
  const store = getProjectStore();
  const rows = await store.listStatuses();
  return rows.map(toChapterStatus);
}
