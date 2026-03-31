const CACHE_PREFIX = "smudge:draft:";

export function getCachedContent(chapterId: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${chapterId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn("[useContentCache] getCachedContent failed:", err);
    return null;
  }
}

export function setCachedContent(chapterId: string, content: Record<string, unknown>): void {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${chapterId}`, JSON.stringify(content));
  } catch (err) {
    console.warn("[useContentCache] setCachedContent failed:", err);
  }
}

export function clearCachedContent(chapterId: string): void {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${chapterId}`);
  } catch (err) {
    console.warn("[useContentCache] clearCachedContent failed:", err);
  }
}
