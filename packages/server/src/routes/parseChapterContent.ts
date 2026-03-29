export function parseChapterContent(chapter: Record<string, unknown>) {
  if (typeof chapter.content === "string") {
    try {
      return { ...chapter, content: JSON.parse(chapter.content) };
    } catch {
      return { ...chapter, content: null };
    }
  }
  return { ...chapter, content: chapter.content ?? null };
}
