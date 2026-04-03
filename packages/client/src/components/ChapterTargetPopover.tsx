import { useState, useRef, useEffect } from "react";
import { api } from "../api/client";
import { STRINGS } from "../strings";

interface ChapterTargetPopoverProps {
  chapterId: string;
  currentWordCount: number;
  targetWordCount: number | null;
  onUpdate: () => void;
}

export function ChapterTargetPopover({
  chapterId,
  currentWordCount,
  targetWordCount,
  onUpdate,
}: ChapterTargetPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(targetWordCount?.toString() ?? "");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleSave = async (value: number | null) => {
    try {
      await api.chapters.update(chapterId, { target_word_count: value });
      onUpdate();
    } catch {
      // Best-effort
    }
  };

  const handleBlur = () => {
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed > 0) {
      handleSave(parsed);
    }
  };

  const handleClear = () => {
    setDraft("");
    handleSave(null);
    setOpen(false);
  };

  // Display: "2,500 / 5,000" when target is set, just "2,500" otherwise
  const displayText = targetWordCount
    ? `${currentWordCount.toLocaleString()} / ${targetWordCount.toLocaleString()}`
    : currentWordCount.toLocaleString();

  return (
    <span className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className="text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-1"
      >
        {displayText}
      </button>
      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-lg p-3 min-w-[200px]">
          <label
            htmlFor={`chapter-target-${chapterId}`}
            className="block text-xs text-text-muted mb-1 font-sans"
          >
            {STRINGS.projectSettings.wordCountTarget}
          </label>
          <input
            id={`chapter-target-${chapterId}`}
            type="number"
            min="1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            className="w-full rounded border border-border px-2 py-1 text-sm text-text-primary bg-bg-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
          {targetWordCount !== null && (
            <button
              onClick={handleClear}
              className="mt-2 text-xs text-text-muted hover:text-text-secondary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
            >
              {STRINGS.projectSettings.clear}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
