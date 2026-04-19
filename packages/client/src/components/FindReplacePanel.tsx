import { useCallback, useEffect, useRef } from "react";
import { STRINGS } from "../strings";
import {
  CONTEXT_RADIUS,
  MAX_QUERY_LENGTH,
  MAX_REPLACE_LENGTH,
  type SearchResult,
} from "@smudge/shared";

const S = STRINGS.findReplace;

export interface FindReplacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  results: SearchResult | null;
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  replacement: string;
  onReplacementChange: (r: string) => void;
  options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
  onToggleOption: (opt: "case_sensitive" | "whole_word" | "regex") => void;
  onReplaceOne: (chapterId: string, matchIndex: number) => void;
  onReplaceAllInChapter: (chapterId: string) => void;
  onReplaceAllInManuscript: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

// Context is `flat.slice(offset - R, offset + length + R)` where R is the
// shared CONTEXT_RADIUS. Match starts at `min(R, offset)` within the
// context, so we highlight by known position rather than re-searching
// (which would mis-highlight for case-sensitive or regex).

function highlightMatch(
  context: string,
  match: { offset: number; length: number },
): React.ReactNode {
  const start = Math.min(CONTEXT_RADIUS, match.offset);
  const end = start + match.length;
  if (start < 0 || end > context.length || start >= end) return context;
  return (
    <>
      {context.slice(0, start)}
      <mark className="bg-amber-200/60 text-text-primary rounded-sm px-0.5">
        {context.slice(start, end)}
      </mark>
      {context.slice(end)}
    </>
  );
}

export function FindReplacePanel({
  isOpen,
  onClose,
  results,
  loading,
  error,
  query,
  onQueryChange,
  replacement,
  onReplacementChange,
  options,
  onToggleOption,
  onReplaceOne,
  onReplaceAllInChapter,
  onReplaceAllInManuscript,
  triggerRef,
}: FindReplacePanelProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevIsOpen = useRef(isOpen);
  // See SnapshotPanel for the identical rationale: panel-exclusivity
  // closes (parent opens a sibling panel) must NOT refocus the trigger,
  // since the sibling is about to acquire focus. Only user-initiated
  // closes (Escape / Close button) should restore focus to the trigger.
  const closedByUserRef = useRef(false);
  const handleUserClose = useCallback(() => {
    closedByUserRef.current = true;
    onClose();
  }, [onClose]);

  // Focus management
  useEffect(() => {
    if (isOpen && !prevIsOpen.current) {
      // Panel just opened — focus search input
      const raf = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      prevIsOpen.current = isOpen;
      return () => cancelAnimationFrame(raf);
    }
    if (!isOpen && prevIsOpen.current && triggerRef?.current) {
      if (closedByUserRef.current) {
        triggerRef.current.focus();
      }
      closedByUserRef.current = false;
    }
    prevIsOpen.current = isOpen;
  }, [isOpen, triggerRef]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closedByUserRef.current = true;
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasResults = results !== null && results.total_count > 0;

  return (
    <aside
      aria-label={S.ariaLabel}
      className="border-l border-border/60 bg-bg-sidebar flex flex-col h-full overflow-hidden w-80 min-w-80"
    >
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary font-sans">{S.panelTitle}</h2>
        <button
          type="button"
          onClick={handleUserClose}
          aria-label={S.closeLabel}
          className="text-text-secondary hover:text-text-primary transition-colors font-sans text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Inputs and options */}
      <div className="px-4 py-3 flex flex-col gap-3 border-b border-border/40">
        {/* Search input */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="find-replace-search"
            className="text-xs font-medium text-text-secondary font-sans"
          >
            {S.findLabel}
          </label>
          <input
            ref={searchInputRef}
            id="find-replace-search"
            type="text"
            placeholder={S.searchPlaceholder}
            value={query}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(e) => onQueryChange(e.target.value)}
            className="text-sm border border-border/40 rounded px-2 py-1.5 bg-white text-text-primary placeholder:text-text-secondary/60 font-sans focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Replace input */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="find-replace-replace"
            className="text-xs font-medium text-text-secondary font-sans"
          >
            {S.replaceLabel}
          </label>
          <input
            id="find-replace-replace"
            type="text"
            placeholder={S.replacePlaceholder}
            value={replacement}
            maxLength={MAX_REPLACE_LENGTH}
            onChange={(e) => onReplacementChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter fires Replace All whenever there are results. An
              // empty replacement is a valid "delete all matches" operation
              // — the confirmation dialog downstream uses explicit delete
              // copy so the user understands the consequences before
              // committing.
              if (e.key === "Enter" && !e.shiftKey && results !== null && results.total_count > 0) {
                e.preventDefault();
                onReplaceAllInManuscript();
              }
            }}
            className="text-sm border border-border/40 rounded px-2 py-1.5 bg-white text-text-primary placeholder:text-text-secondary/60 font-sans focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Option toggles */}
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-pressed={options.case_sensitive}
            aria-label={S.matchCase}
            onClick={() => onToggleOption("case_sensitive")}
            className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
              options.case_sensitive
                ? "bg-accent/20 border-accent text-accent font-semibold"
                : "bg-white border-border/40 text-text-secondary hover:border-border"
            }`}
          >
            Aa
          </button>
          <button
            type="button"
            aria-pressed={options.whole_word}
            aria-label={S.wholeWord}
            onClick={() => onToggleOption("whole_word")}
            className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
              options.whole_word
                ? "bg-accent/20 border-accent text-accent font-semibold"
                : "bg-white border-border/40 text-text-secondary hover:border-border"
            }`}
          >
            ab|
          </button>
          <button
            type="button"
            aria-pressed={options.regex}
            aria-label={S.regex}
            onClick={() => onToggleOption("regex")}
            className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
              options.regex
                ? "bg-accent/20 border-accent text-accent font-semibold"
                : "bg-white border-border/40 text-text-secondary hover:border-border"
            }`}
          >
            .*
          </button>
        </div>
      </div>

      {/* Results summary — aria-live for screen readers */}
      <div aria-live="polite" className="px-4 py-2 text-xs text-text-secondary font-sans">
        {loading && S.searching}
        {error && <span className="text-red-700">{error}</span>}
        {!loading &&
          !error &&
          results !== null &&
          (results.total_count === 0
            ? S.noMatches
            : S.matchCount(results.total_count, results.chapters.length))}
        {!loading &&
          !error &&
          results !== null &&
          results.skipped_chapter_ids &&
          results.skipped_chapter_ids.length > 0 && (
            <div className="mt-1 text-amber-800">
              {S.skippedChapters(results.skipped_chapter_ids.length)}
            </div>
          )}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-4 pb-3">
        {hasResults &&
          results.chapters.map((chapter) => (
            <div key={chapter.chapter_id} className="mb-4">
              {/* Chapter heading */}
              <h3 className="text-xs font-semibold text-text-primary font-sans mb-2">
                {S.chapterMatches(chapter.chapter_title, chapter.matches.length)}
              </h3>

              {/* Individual matches */}
              <ul className="flex flex-col gap-1.5">
                {chapter.matches.map((match) => (
                  <li
                    key={`${chapter.chapter_id}-${match.index}`}
                    className="flex items-start gap-2 text-xs border border-border/30 rounded p-2"
                  >
                    <span className="flex-1 text-text-secondary font-sans break-words">
                      {highlightMatch(match.context, match)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onReplaceOne(chapter.chapter_id, match.index)}
                      className="text-xs font-medium text-accent hover:text-accent/80 transition-colors font-sans flex-shrink-0"
                    >
                      {S.replaceOne}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Replace all in chapter */}
              <button
                type="button"
                onClick={() => onReplaceAllInChapter(chapter.chapter_id)}
                className="mt-2 text-xs font-medium text-accent border border-accent/40 rounded px-2 py-1 hover:bg-accent/10 transition-colors font-sans w-full"
              >
                {S.replaceAllInChapter}
              </button>
            </div>
          ))}
      </div>

      {/* Footer — Replace All in Manuscript */}
      {hasResults && (
        <div className="border-t border-border/40 px-4 py-3">
          <button
            type="button"
            onClick={onReplaceAllInManuscript}
            className="w-full text-sm font-semibold text-white bg-red-700 rounded px-3 py-1.5 hover:bg-red-800 transition-colors font-sans"
          >
            {replacement.length === 0 ? S.replaceAllInManuscriptDelete : S.replaceAllInManuscript}
          </button>
        </div>
      )}
    </aside>
  );
}
