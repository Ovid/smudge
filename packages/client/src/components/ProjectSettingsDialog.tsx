import { useState, useEffect, useRef } from "react";
import type { CompletionThresholdValue } from "@smudge/shared";
import { api } from "../api/client";
import { STRINGS } from "../strings";

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
    try {
      await api.projects.update(project.slug, data);
      onUpdate();
    } catch (err) {
      console.error("Failed to save project setting:", err);
    }
  }

  function handleWordCountBlur() {
    const parsed = wordCountTarget.trim() === "" ? null : Number(wordCountTarget);
    if (parsed !== null && (Number.isNaN(parsed) || parsed <= 0)) return;
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

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-xl bg-bg-primary p-6 shadow-lg backdrop:bg-black/50 max-w-md w-full"
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
              value={wordCountTarget}
              onChange={(e) => setWordCountTarget(e.target.value)}
              onBlur={handleWordCountBlur}
              className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
              placeholder={STRINGS.projectSettings.wordCountPlaceholder}
            />
            <button
              type="button"
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
      </div>
    </dialog>
  );
}
