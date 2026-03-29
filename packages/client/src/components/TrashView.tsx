import type { Chapter } from "@smudge/shared";
import { STRINGS } from "../strings";

interface TrashViewProps {
  chapters: Chapter[];
  onRestore: (chapterId: string) => void;
  onBack: () => void;
}

export function TrashView({ chapters, onRestore, onBack }: TrashViewProps) {
  return (
    <div className="mx-auto max-w-[720px] py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-text-primary">{STRINGS.sidebar.trash}</h2>
        <button
          onClick={onBack}
          className="text-sm text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
        >
          {STRINGS.sidebar.backToEditor}
        </button>
      </div>

      {chapters.length === 0 ? (
        <p className="text-text-muted text-center py-12">{STRINGS.sidebar.trashEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {chapters.map((chapter) => (
            <li
              key={chapter.id}
              className="flex items-center justify-between rounded border border-border bg-bg-input p-4"
            >
              <div>
                <span className="text-text-primary">{chapter.title}</span>
                {chapter.deleted_at && (
                  <>
                    <span className="ml-3 text-sm text-text-muted">
                      {STRINGS.project.lastDeleted(chapter.deleted_at)}
                    </span>
                    <span className="ml-3 text-sm text-status-error">
                      {STRINGS.sidebar.permanentDeleteDate(chapter.deleted_at)}
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={() => onRestore(chapter.id)}
                className="rounded bg-accent px-3 py-1 text-sm text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
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
