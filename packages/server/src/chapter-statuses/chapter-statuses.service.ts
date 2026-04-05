import type { ChapterStatusRow as SharedChapterStatusRow } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterStatusRepo from "./chapter-statuses.repository";
import type { ChapterStatusRow } from "./chapter-statuses.types";

function toChapterStatus(row: ChapterStatusRow): SharedChapterStatusRow {
  return {
    status: row.status,
    sort_order: row.sort_order,
    label: row.label,
  };
}

export async function listStatuses(): Promise<SharedChapterStatusRow[]> {
  const db = getDb();
  const rows = await ChapterStatusRepo.list(db);
  return rows.map(toChapterStatus);
}
