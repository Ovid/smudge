const CACHE_PREFIX = "smudge:draft:";

export function getCachedContent(chapterId: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${chapterId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function setCachedContent(chapterId: string, content: Record<string, unknown>): void {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${chapterId}`, JSON.stringify(content));
  } catch {
    // Storage full or unavailable — best effort
  }
}

export function clearCachedContent(chapterId: string): void {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${chapterId}`);
  } catch {
    // Best effort
  }
}
