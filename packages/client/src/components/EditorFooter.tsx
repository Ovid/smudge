import type { ProjectWithChapters } from "@smudge/shared";
import { STRINGS } from "../strings";

interface EditorFooterProps {
  chapterWordCount: number;
  project: ProjectWithChapters;
  saveStatus: string;
  saveErrorMessage: string | null;
  cacheWarning: boolean;
}

export function EditorFooter({
  chapterWordCount,
  project,
  saveStatus,
  saveErrorMessage,
  cacheWarning,
}: EditorFooterProps) {
  return (
    <footer className="border-t border-border/40 bg-bg-primary px-6 py-2 flex items-center justify-between text-xs text-text-muted">
      <div className="flex items-center gap-4">
        <span className="font-medium">{STRINGS.project.wordCount(chapterWordCount)}</span>
        <span className="text-text-secondary">
          {STRINGS.project.wordCount(
            project.chapters.reduce((sum, c) => sum + c.word_count, 0),
          )}{" "}
          {STRINGS.nav.totalSuffix}
        </span>
      </div>
      <div role="status" aria-live="polite">
        {saveStatus === "unsaved" && (
          <span className="text-text-muted">{STRINGS.editor.unsaved}</span>
        )}
        {saveStatus === "saving" && (
          <span className="text-text-muted">{STRINGS.editor.saving}</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-status-success">{STRINGS.editor.saved}</span>
        )}
        {saveStatus === "error" && (
          <span className="text-status-error">
            {saveErrorMessage ?? STRINGS.editor.saveFailed}
          </span>
        )}
        {saveStatus === "idle" && ""}
        {cacheWarning && saveStatus !== "error" && (
          <span className="text-status-warning ml-2">{STRINGS.editor.cacheUnavailable}</span>
        )}
      </div>
    </footer>
  );
}
