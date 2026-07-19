import { randomUUID as uuidv4 } from "node:crypto";
import { stripImageNodes } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import type { OuttakeRow } from "./outtakes.types";

/**
 * Outtakes are a private scratchpad: no word count, no chapter writes, no
 * velocity side effects. Images are stripped on the way in (authoritative) so
 * the drawer never holds image references — this is what keeps outtakes out of
 * every image-refcount and export path structurally.
 *
 * Editor-only `note` marks are DELIBERATELY preserved (review 2026-07-19 S3):
 * an outtake is an editor-trusted round-trip surface — it only ever surfaces as
 * plaintext in the panel (marks don't render) or is re-inserted into the editor
 * (the one surface allowed to show notes). Stripping notes on capture would
 * destroy the writer's private commentary on a stash-and-restash. The stored
 * JSON therefore holds notes, so any FUTURE code that renders outtake content
 * to HTML/export MUST strip them there (see the note-strip discipline in
 * CLAUDE.md). The forcing test in outtakes.service.test.ts pins this decision.
 *
 * Every operation enforces parent-project liveness via findProjectById (which
 * filters deleted_at IS NULL): an outtake under a soft-deleted project reads as
 * gone (404), matching the snapshots-under-trashed-chapter contract.
 */
/**
 * `content` is trusted TipTap JSON: the ROUTE is the sole content-validation
 * trust boundary (it parses CreateOuttakeSchema, whose `content` is
 * TipTapDocSchema) — this service does not re-parse it, to avoid a second walk
 * of a potentially large document. A future non-route caller must validate
 * `content` itself before calling (review 2026-07-19 S4).
 */
export async function createOuttake(
  projectId: string,
  content: Record<string, unknown>,
  label?: string | null,
): Promise<OuttakeRow | null> {
  const store = getProjectStore();
  const stripped = stripImageNodes(content);
  return store.transaction(async (txStore) => {
    const project = await txStore.findProjectById(projectId);
    if (!project) return null;
    const now = new Date().toISOString();
    return txStore.insertOuttake({
      id: uuidv4(),
      project_id: projectId,
      label: label || null,
      content: JSON.stringify(stripped),
      created_at: now,
      updated_at: now,
    });
  });
}

export async function listOuttakes(projectId: string): Promise<OuttakeRow[] | null> {
  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;
  return store.listOuttakesByProject(projectId);
}

export async function updateOuttakeLabel(
  id: string,
  label: string | null,
): Promise<OuttakeRow | null> {
  const store = getProjectStore();
  return store.transaction(async (txStore) => {
    const outtake = await txStore.findOuttakeById(id);
    if (!outtake) return null;
    const project = await txStore.findProjectById(outtake.project_id);
    if (!project) return null;
    return txStore.updateOuttakeLabel(id, label || null, new Date().toISOString());
  });
}

export async function deleteOuttake(id: string): Promise<boolean> {
  const store = getProjectStore();
  return store.transaction(async (txStore) => {
    const outtake = await txStore.findOuttakeById(id);
    if (!outtake) return false;
    const project = await txStore.findProjectById(outtake.project_id);
    if (!project) return false;
    return (await txStore.deleteOuttake(id)) > 0;
  });
}
