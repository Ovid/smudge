import { useEffect, useRef, useState } from "react";
import { sanitizeEditorHtml } from "../sanitizer";
import type { Chapter } from "@smudge/shared";
import { renderEditorHtml } from "@smudge/shared/editor-extensions";
import { clientWarn } from "../errors";
import { STRINGS } from "../strings";

interface PreviewModeProps {
  chapters: Chapter[];
  onNavigateToChapter: (chapterId: string) => void;
}

export function PreviewMode({ chapters, onNavigateToChapter }: PreviewModeProps) {
  const [activeTocId, setActiveTocId] = useState<string>(chapters[0]?.id ?? "");
  const chapterRefs = useRef<Map<string, HTMLElement>>(new Map());

  // IntersectionObserver for TOC scroll tracking
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );

    chapterRefs.current.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [chapters]);

  /**
   * Render a chapter for display, or return `null` if rendering FAILED.
   *
   * I3 (dedup review 2026-07-26): `null` used to mean both "there is no
   * content" and "rendering threw", and the caller below reports null as
   * "Unable to render content". A new project's first chapter is inserted with
   * content: null and DB reads hand that null straight through, so creating a
   * project and clicking Preview told the writer their untouched chapter was
   * broken. An empty chapter renders as empty; only a throw is a failure.
   * renderSnapshotContent (useSnapshotController) is the sibling encoding of
   * this same degrade and never had the conflation — it returns its error copy
   * from the catch alone.
   */
  function renderChapterHtml(content: Record<string, unknown> | null): string | null {
    if (!content) return "";
    try {
      return renderEditorHtml(content);
    } catch (err) {
      // F-35: see renderSnapshotContent, the sibling degrade — the null return
      // is the user-facing half and is correct; this is the developer-facing
      // half that was missing. Only a throw reaches here (the `!content` guard
      // above owns the empty case), so this never fires for an untouched
      // chapter.
      clientWarn("renderChapterHtml: renderEditorHtml threw", err);
      return null;
    }
  }

  return (
    <div className="flex page-enter">
      {/* Main content */}
      <div className="flex-1">
        <div className="mx-auto max-w-[680px] px-8 py-12">
          {chapters.map((chapter, i) => (
            <section
              key={chapter.id}
              id={chapter.id}
              ref={(el) => {
                if (el) chapterRefs.current.set(chapter.id, el);
                else chapterRefs.current.delete(chapter.id);
              }}
              className="mb-20"
            >
              {i > 0 && (
                <div className="mb-12 flex justify-center" aria-hidden="true">
                  <span className="text-border-strong tracking-[0.5em] text-xs">* * *</span>
                </div>
              )}
              <h2
                className="text-3xl font-serif font-semibold text-text-primary mb-8 cursor-pointer hover:text-accent tracking-tight"
                onClick={() => onNavigateToChapter(chapter.id)}
              >
                {chapter.title}
              </h2>
              {(() => {
                const html = renderChapterHtml(chapter.content);
                if (html !== null) {
                  return (
                    <div
                      className="prose prose-xl font-serif text-text-primary leading-[2] prose-headings:text-text-primary prose-headings:tracking-tight prose-a:text-accent prose-blockquote:border-l-accent-light prose-blockquote:text-text-secondary prose-hr:border-border"
                      dangerouslySetInnerHTML={{ __html: sanitizeEditorHtml(html) }}
                    />
                  );
                }
                return <p className="text-text-muted italic">{STRINGS.preview.renderError}</p>;
              })()}
            </section>
          ))}
        </div>
      </div>

      {/* TOC Panel */}
      <nav
        aria-label={STRINGS.preview.tableOfContents}
        className="hidden lg:block w-[200px] min-w-[200px] sticky top-0 h-screen overflow-y-auto py-12 pr-6"
      >
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-[0.15em] mb-5">
          {STRINGS.preview.tableOfContents}
        </h3>
        <ul className="flex flex-col gap-0.5">
          {chapters.map((chapter) => (
            <li key={chapter.id}>
              <a
                href={`#${chapter.id}`}
                aria-current={activeTocId === chapter.id ? "true" : undefined}
                className={`block text-sm font-serif py-1.5 rounded-md px-2.5 transition-all duration-200 ${
                  activeTocId === chapter.id
                    ? "text-accent font-medium bg-accent-light/50"
                    : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {chapter.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
