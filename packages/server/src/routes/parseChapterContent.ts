export function parseChapterContent(chapter: Record<string, unknown>) {
  if (typeof chapter.content === "string") {
    try {
      return { ...chapter, content: JSON.parse(chapter.content) };
    } catch (err) {
      console.error(
        `[parseChapterContent] corrupt JSON in chapter ${chapter.id ?? "unknown"}: ${err instanceof Error ? err.message : err}`,
      );
      return { ...chapter, content: null };
    }
  }
  return { ...chapter, content: chapter.content ?? null };
}
