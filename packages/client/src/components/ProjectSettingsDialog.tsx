import { useState, useEffect, useRef } from "react";
import type { CompletionThresholdValue } from "@smudge/shared";
import { api } from "../api/client";
import { STRINGS } from "../strings";

const TIMEZONES = (() => {
  try {
    const tzs = Intl.supportedValuesOf("timeZone");
    // "UTC" is valid for Intl.DateTimeFormat but may not appear in supportedValuesOf
    if (!tzs.includes("UTC")) tzs.unshift("UTC");
    return tzs;
  } catch {
    return ["UTC"];
  }
})();

interface ProjectSettingsDialogProps {
  open: boolean;
  project: {
    slug: string;
    target_word_count: number | null;
    target_deadline: string | null;
    completion_threshold: CompletionThresholdValue;
  };
  onClose: () => void;
  onUpdate: () => void;
}

const THRESHOLD_OPTIONS = [
  { value: "outline", label: STRINGS.projectSettings.thresholdOutline },
  { value: "rough_draft", label: STRINGS.projectSettings.thresholdRoughDraft },
  { value: "revised", label: STRINGS.projectSettings.thresholdRevised },
  { value: "edited", label: STRINGS.projectSettings.thresholdEdited },
  { value: "final", label: STRINGS.projectSettings.thresholdFinal },
];

export function ProjectSettingsDialog({
  open,
  project,
  onClose,
  onUpdate,
}: ProjectSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [wordCountTarget, setWordCountTarget] = useState(
    project.target_word_count != null ? String(project.target_word_count) : "",
  );
  const [deadline, setDeadline] = useState(project.target_deadline ?? "");
  const [threshold, setThreshold] = useState(project.completion_threshold ?? "final");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [saveError, setSaveError] = useState<string | null>(null);
  const userChangedTimezoneRef = useRef(false);
  const latestTimezoneRequestRef = useRef<string | null>(null);

  // Re-sync project fields from props when the dialog opens.
  // Uses state (not a ref) to track previous open value — this is the
  // React-approved "adjusting state during render" pattern.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setWordCountTarget(
        project.target_word_count != null ? String(project.target_word_count) : "",
      );
      setDeadline(project.target_deadline ?? "");
      setThreshold(project.completion_threshold ?? "final");
      setSaveError(null);
    }
  }

  useEffect(() => {
    if (open) {
      let cancelled = false;
      userChangedTimezoneRef.current = false;
      api.settings
        .get()
        .then((settings) => {
          if (!cancelled && !userChangedTimezoneRef.current)
            setTimezone(settings.timezone || "UTC");
        })
        .catch(() => {
          if (!cancelled && !userChangedTimezoneRef.current) setTimezone("UTC");
        });
      return () => {
        cancelled = true;
      };
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // happy-dom does not support showModal — open attribute handles visibility
        }
      }
    } else {
      try {
        dialog.close();
      } catch {
        // happy-dom does not support close
      }
    }
  }, [open]);

  async function saveField(data: Parameters<typeof api.projects.update>[1]) {
    setSaveError(null);
    try {
      await api.projects.update(project.slug, data);
      onUpdate();
    } catch (err) {
      console.error("Failed to save project setting:", err);
      setSaveError(STRINGS.projectSettings.saveError);
      // Revert only the specific field that failed
      if ("target_word_count" in data) {
        setWordCountTarget(
          project.target_word_count != null ? String(project.target_word_count) : "",
        );
      }
      if ("target_deadline" in data) {
        setDeadline(project.target_deadline ?? "");
      }
      if ("completion_threshold" in data) {
        setThreshold(project.completion_threshold ?? "final");
      }
    }
  }

  function handleWordCountBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Skip save when focus is moving to the Clear button to avoid racing PATCHes
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.dataset.clearWordCount) return;
    const parsed = wordCountTarget.trim() === "" ? null : parseInt(wordCountTarget, 10);
    if (parsed !== null && (Number.isNaN(parsed) || parsed <= 0)) {
      setWordCountTarget(
        project.target_word_count != null ? String(project.target_word_count) : "",
      );
      return;
    }
    saveField({ target_word_count: parsed });
  }

  function handleDeadlineChange(value: string) {
    setDeadline(value);
    saveField({ target_deadline: value || null });
  }

  function handleThresholdChange(value: CompletionThresholdValue) {
    setThreshold(value);
    saveField({ completion_threshold: value });
  }

  async function handleTimezoneChange(value: string) {
    const previous = timezone;
    userChangedTimezoneRef.current = true;
    latestTimezoneRequestRef.current = value;
    setTimezone(value);
    setSaveError(null);
    try {
      await api.settings.update([{ key: "timezone", value }]);
    } catch (err) {
      console.error("Failed to save timezone:", err);
      // Only revert if no newer timezone save has started since this one.
      if (latestTimezoneRequestRef.current === value) {
        setSaveError(STRINGS.projectSettings.saveError);
        setTimezone(previous);
      }
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-full max-w-sm rounded-none rounded-l-xl bg-bg-primary p-6 shadow-xl backdrop:bg-black/50 overflow-y-auto"
      style={{
        position: "fixed",
        right: "0",
        top: "0",
        left: "auto",
        margin: "0",
        height: "100vh",
        maxHeight: "100vh",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary font-sans">
          {STRINGS.projectSettings.heading}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-secondary rounded-md p-1 focus:outline-none focus:ring-2 focus:ring-focus-ring"
          aria-label={STRINGS.projectSettings.close}
        >
          ✕
        </button>
      </div>

      {saveError && (
        <p className="mb-4 text-sm text-status-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <label
            className="block text-sm font-medium text-text-secondary mb-1 font-sans"
            htmlFor="project-word-count-target"
          >
            {STRINGS.projectSettings.wordCountTarget}
          </label>
          <div className="flex gap-2">
            <input
              id="project-word-count-target"
              type="number"
              min="1"
              step="1"
              value={wordCountTarget}
              onChange={(e) => setWordCountTarget(e.target.value)}
              onBlur={handleWordCountBlur}
              className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
              placeholder={STRINGS.projectSettings.wordCountPlaceholder}
            />
            <button
              type="button"
              data-clear-word-count
              onClick={() => {
                setWordCountTarget("");
                saveField({ target_word_count: null });
              }}
              className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-secondary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {STRINGS.projectSettings.clear}
            </button>
          </div>
        </div>

        <div>
          <label
            className="block text-sm font-medium text-text-secondary mb-1 font-sans"
            htmlFor="project-deadline"
          >
            {STRINGS.projectSettings.deadline}
          </label>
          <div className="flex gap-2">
            <input
              id="project-deadline"
              type="date"
              value={deadline}
              onChange={(e) => handleDeadlineChange(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <button
              type="button"
              onClick={() => {
                setDeadline("");
                saveField({ target_deadline: null });
              }}
              className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-secondary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {STRINGS.projectSettings.clear}
            </button>
          </div>
        </div>

        <div>
          <label
            className="block text-sm font-medium text-text-secondary mb-1 font-sans"
            htmlFor="project-completion-threshold"
          >
            {STRINGS.projectSettings.completionThreshold}
          </label>
          <select
            id="project-completion-threshold"
            value={threshold}
            onChange={(e) => handleThresholdChange(e.target.value as CompletionThresholdValue)}
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {THRESHOLD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t border-border/40 pt-4">
          <label
            className="block text-sm font-medium text-text-secondary mb-1 font-sans"
            htmlFor="settings-timezone"
          >
            {STRINGS.settings.timezoneLabel}
          </label>
          <select
            id="settings-timezone"
            value={timezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>
    </dialog>
  );
}
