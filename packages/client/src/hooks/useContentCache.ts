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
 */
export function clearAllCachedContent(chapterIds: string[]): void {
  try {
    for (const id of chapterIds) {
      localStorage.removeItem(`${CACHE_PREFIX}${id}`);
    }
  } catch (err) {
    clientWarn("[useContentCache] clearAllCachedContent failed:", err);
  }
}
