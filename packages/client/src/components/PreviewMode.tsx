import { useEffect, useRef, useState } from "react";
import { generateHTML } from "@tiptap/html";
import DOMPurify from "dompurify";
import type { Chapter } from "@smudge/shared";
import { editorExtensions } from "../editorExtensions";
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

  function renderChapterHtml(content: Record<string, unknown> | null): string | null {
    if (!content) return null;
    try {
      return generateHTML(content as Parameters<typeof generateHTML>[0], editorExtensions);
    } catch {
      return null;
    }
  }

  return (
    <div className="flex">
      {/* Main content */}
      <div className="flex-1">
        <div className="mx-auto max-w-[680px] px-6 py-8">
          {chapters.map((chapter) => (
            <section
              key={chapter.id}
              id={chapter.id}
              ref={(el) => {
                if (el) chapterRefs.current.set(chapter.id, el);
                else chapterRefs.current.delete(chapter.id);
              }}
              className="mb-16"
            >
              <h2
                className="text-2xl font-serif text-text-primary mb-6 cursor-pointer hover:text-accent"
                onClick={() => onNavigateToChapter(chapter.id)}
              >
                {chapter.title}
              </h2>
              {(() => {
                const html = renderChapterHtml(chapter.content);
                if (html) {
                  return (
                    <div
                      className="prose prose-lg font-serif text-text-primary leading-[1.9] prose-headings:text-text-primary prose-a:text-accent"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
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
        className="hidden lg:block w-[200px] min-w-[200px] sticky top-0 h-screen overflow-y-auto py-8 pr-6"
      >
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">
          {STRINGS.preview.tableOfContents}
        </h3>
        <ul className="flex flex-col gap-1">
          {chapters.map((chapter) => (
            <li key={chapter.id}>
              <a
                href={`#${chapter.id}`}
                aria-current={activeTocId === chapter.id ? "true" : undefined}
                className={`block text-sm py-1 rounded px-2 ${
                  activeTocId === chapter.id
                    ? "text-accent font-medium bg-accent-light"
                    : "text-text-secondary hover:text-text-primary"
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
