import type { Chapter } from "@smudge/shared";
import { STRINGS } from "../strings";

interface TrashViewProps {
  chapters: Chapter[];
  onRestore: (chapterId: string) => void;
  onBack: () => void;
}

export function TrashView({ chapters, onRestore, onBack }: TrashViewProps) {
  return (
    <div className="mx-auto max-w-[720px] py-10 px-8 page-enter">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-lg font-semibold text-text-primary">
          {STRINGS.sidebar.trash}
        </h2>
        <button
          onClick={onBack}
          className="text-sm text-text-muted hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded-md px-3 py-1.5"
        >
          {STRINGS.sidebar.backToEditor}
        </button>
      </div>

      {chapters.length === 0 ? (
        <p className="text-text-muted text-center py-16">
          {STRINGS.sidebar.trashEmpty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {chapters.map((chapter) => (
            <li
              key={chapter.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-bg-input p-5"
            >
              <div className="min-w-0">
                <span className="text-text-primary font-medium">{chapter.title}</span>
                {chapter.deleted_at && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs">
                    <span className="text-text-muted">
                      {STRINGS.project.lastDeleted(chapter.deleted_at)}
                    </span>
                    <span className="text-status-error/80">
                      {STRINGS.sidebar.permanentDeleteDate(chapter.deleted_at)}
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={() => onRestore(chapter.id)}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm"
              >
                {STRINGS.sidebar.restore}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
