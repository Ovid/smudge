import { useEffect, useRef, useState, useCallback } from "react";
import { EXPORT_FILE_EXTENSIONS, type ExportFormatType } from "@smudge/shared";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";

interface ExportDialogProps {
  open: boolean;
  projectSlug: string;
  chapters: Array<{ id: string; title: string; sort_order: number }>;
  onClose: () => void;
}

export function ExportDialog({ open, projectSlug, chapters, onClose }: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [format, setFormat] = useState<ExportFormatType>("html");
  const [includeToc, setIncludeToc] = useState(true);
  const [selectingChapters, setSelectingChapters] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset state only when the dialog opens (open transitions false → true)
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setFormat("html");
      setIncludeToc(true);
      setSelectingChapters(false);
      setSelectedChapterIds(new Set(chapters.map((c) => c.id)));
      setExporting(false);
      exportingRef.current = false;
      setError(null);
    } else if (!open && prevOpenRef.current) {
      // Dialog closing — abort any in-flight export
      abortRef.current?.abort();
      abortRef.current = null;
    }
    prevOpenRef.current = open;
  }, [open, chapters]);

  // Show/close modal
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // happy-dom doesn't fully support showModal
      }
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleExport = useCallback(async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const config: {
        format: ExportFormatType;
        include_toc?: boolean;
        chapter_ids?: string[];
      } = {
        format,
        include_toc: includeToc,
      };

      if (selectingChapters) {
        config.chapter_ids = chapters.filter((c) => selectedChapterIds.has(c.id)).map((c) => c.id);
      }

      const blob = await api.projects.export(projectSlug, config, controller.signal);

      if (controller.signal.aborted) return;

      const filename = `${projectSlug}.${EXPORT_FILE_EXTENSIONS[format]}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);

      onClose();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof ApiRequestError ? err.message : STRINGS.export.errorFailed);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [format, includeToc, selectingChapters, selectedChapterIds, chapters, projectSlug, onClose]);

  const handleChapterToggle = useCallback((chapterId: string) => {
    setSelectedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  }, []);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={STRINGS.export.dialogTitle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-transparent m-0 p-0 w-full h-full border-none backdrop:bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rounded-xl bg-bg-primary p-8 shadow-xl max-w-sm w-full mx-auto mt-[15vh] border border-border/60">
        <h2 className="text-text-primary font-semibold text-base mb-4">
          {STRINGS.export.dialogTitle}
        </h2>

        {error && (
          <p role="alert" className="text-status-error text-sm mb-4">
            {error}
          </p>
        )}

        <fieldset className="mb-4">
          <legend className="text-text-primary text-sm font-medium mb-2">
            {STRINGS.export.formatLabel}
          </legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm text-text-secondary">
              <input
                type="radio"
                name="export-format"
                value="html"
                checked={format === "html"}
                onChange={() => setFormat("html")}
              />
              {STRINGS.export.formatHtml}
            </label>
            <label className="flex items-center gap-1.5 text-sm text-text-secondary">
              <input
                type="radio"
                name="export-format"
                value="markdown"
                checked={format === "markdown"}
                onChange={() => setFormat("markdown")}
              />
              {STRINGS.export.formatMarkdown}
            </label>
            <label className="flex items-center gap-1.5 text-sm text-text-secondary">
              <input
                type="radio"
                name="export-format"
                value="plaintext"
                checked={format === "plaintext"}
                onChange={() => setFormat("plaintext")}
              />
              {STRINGS.export.formatPlainText}
            </label>
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-text-secondary mb-4">
          <input
            type="checkbox"
            checked={includeToc}
            onChange={(e) => setIncludeToc(e.target.checked)}
          />
          {STRINGS.export.includeTocLabel}
        </label>

        <div className="mb-6">
          {!selectingChapters ? (
            <p className="text-sm text-text-secondary">
              {STRINGS.export.chapterSelectionAll}{" "}
              <button
                type="button"
                className="text-accent underline hover:text-accent/80"
                onClick={() => setSelectingChapters(true)}
              >
                {STRINGS.export.chapterSelectionChoose}
              </button>
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto border border-border/40 rounded-lg p-2">
              {chapters.map((chapter) => (
                <label
                  key={chapter.id}
                  className="flex items-center gap-2 text-sm text-text-secondary py-1"
                >
                  <input
                    type="checkbox"
                    checked={selectedChapterIds.has(chapter.id)}
                    onChange={() => handleChapterToggle(chapter.id)}
                  />
                  {chapter.title}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.export.cancelButton}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || (selectingChapters && selectedChapterIds.size === 0)}
            aria-busy={exporting}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm disabled:opacity-50"
          >
            {exporting ? STRINGS.export.exportingButton : STRINGS.export.exportButton}
          </button>
        </div>
      </div>
    </dialog>
  );
}
