import { clientWarn } from "../errors";

const CACHE_PREFIX = "smudge:draft:";

export function getCachedContent(chapterId: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${chapterId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    clientWarn("[useContentCache] getCachedContent failed:", err);
    return null;
  }
}

export function setCachedContent(chapterId: string, content: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${chapterId}`, JSON.stringify(content));
    return true;
  } catch (err) {
    clientWarn("[useContentCache] setCachedContent failed:", err);
    return false;
  }
}

export function clearCachedContent(chapterId: string): void {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${chapterId}`);
  } catch (err) {
    clientWarn("[useContentCache] clearCachedContent failed:", err);
  }
}

/**
 * Clear cached draft content for the given chapter IDs. Used after a
 * project-wide find-and-replace: any chapter with unsaved client cache
 * would otherwise silently overlay the pre-replace content on top of the
 * server's replaced content when the user navigates to it, un-doing the
 * replacement.
 *
 * Scoped by caller-supplied IDs (rather than nuking every smudge:draft:*
 * key in localStorage) so a replace-all in project A cannot wipe unsaved
 * drafts for project B opened in another tab.
 *
 * OOSS3 (agentic review 2026-08-22): the failure boundary is PER KEY, not per
 * batch. This used to wrap the whole loop in one try, so a removeItem that
 * threw on the n-th of m ids (Safari private mode, SecurityError on a
 * partitioned origin) left ids n+1..m holding their pre-mutation drafts —
 * and the caller, which gets void either way, then raised a lock banner
 * telling the user to refresh, which is precisely what re-hydrates a
 * surviving draft over a server-committed change. Delegating to
 * clearCachedContent gives every id its own try, so one bad key costs one
 * draft rather than the whole tail.
 */
export function clearAllCachedContent(chapterIds: string[]): void {
  for (const id of chapterIds) clearCachedContent(id);
}
