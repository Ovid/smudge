import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { STRINGS } from "../strings";
import { mapApiError } from "../errors";

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
    author_name: string | null;
  };
  onClose: () => void;
  onUpdate: () => void;
}

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
  const [authorName, setAuthorName] = useState(project.author_name ?? "");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [fieldSaveError, setFieldSaveError] = useState<string | null>(null);
  const [timezoneSaveError, setTimezoneSaveError] = useState<string | null>(null);
  const userChangedTimezoneRef = useRef(false);
  const timezoneAbortRef = useRef<AbortController | null>(null);
  const confirmedTimezoneRef = useRef<string>("UTC");
  // I1 (review 2026-04-24): rapid edits (type → blur → type → blur)
  // fired overlapping PATCHes with no client-side ordering. Without
  // client abort, SQLite's writer-lock acquisition order determined
  // which value won at the server — the UI's last-typed value and the
  // persisted value could disagree. Mirror timezoneAbortRef: one
  // controller per saveField issue, aborted on the next issue and on
  // unmount, so every dispatch that has been superseded is also
  // cancelled at the network layer.
  const fieldAbortRef = useRef<AbortController | null>(null);

  // Track last confirmed values so reverts go to the right place after
  // successful save + failed second save (I5 fix).
  const confirmedFieldsRef = useRef({
    wordCountTarget: project.target_word_count != null ? String(project.target_word_count) : "",
    deadline: project.target_deadline ?? "",
    authorName: project.author_name ?? "",
  });

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
      setAuthorName(project.author_name ?? "");
      setFieldSaveError(null);
      setTimezoneSaveError(null);
    }
  }

  useEffect(() => {
    if (open) {
      // Re-sync confirmed-values baseline from props when dialog opens
      confirmedFieldsRef.current = {
        wordCountTarget: project.target_word_count != null ? String(project.target_word_count) : "",
        deadline: project.target_deadline ?? "",
        authorName: project.author_name ?? "",
      };
      // I4 (2026-04-24 review): wire an AbortController so the fetch
      // actually drops on unmount. The previous `let cancelled = false`
      // guard stopped the .then/.catch from writing state but left the
      // browser-side fetch to finish and (on failure) still fire the
      // promise — setTimezoneSaveError would run on an unmounted
      // component, logging a setState-on-unmount warning in tests and
      // violating CLAUDE.md's "zero warnings in test output" rule.
      const controller = new AbortController();
      userChangedTimezoneRef.current = false;
      api.settings
        .get(controller.signal)
        .then((settings) => {
          if (controller.signal.aborted || userChangedTimezoneRef.current) return;
          const tz = settings.timezone || "UTC";
          setTimezone(tz);
          confirmedTimezoneRef.current = tz;
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || userChangedTimezoneRef.current) return;
          // I9: a silent UTC fallback hid real GET failures — the user
          // would see UTC in the dropdown, choose their real timezone,
          // save, and overwrite whatever-was-stored with the new value.
          // Surface the mapped failure instead so the user can close
          // and retry rather than silently stomp stored state.
          // ABORTED (message: null) stays silent per the mapper
          // contract — a dialog-close triggered unmount is not a
          // failure the user needs to see.
          const { message } = mapApiError(err, "settings.get");
          if (message) {
            setTimezoneSaveError(message);
          }
        });
      return () => {
        controller.abort();
      };
    }
    // Intentionally only re-run when `open` changes — project props are read
    // as initial values when the dialog opens; re-running on every prop change
    // would reset fields the user is actively editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // I4 (2026-04-24 review): the timezone PATCH is only cancelled by a
  // newer timezone click. If the dialog unmounts mid-save (parent
  // navigates away, `key={project.slug}` remount on rename), the
  // in-flight PATCH continues and the .then/.catch runs setTimezone /
  // setTimezoneSaveError on an unmounted component — setState-on-
  // unmount warning in test output. Abort on unmount so the request
  // drops cleanly and state updates cannot fire after teardown. Empty
  // dep array: this is a true unmount-only cleanup, not tied to `open`.
  useEffect(
    () => () => {
      timezoneAbortRef.current?.abort();
      fieldAbortRef.current?.abort();
    },
    [],
  );

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
    setFieldSaveError(null);
    // I1: abort any prior in-flight field PATCH before issuing a new
    // one so overlapping requests can't commit out of typing order.
    fieldAbortRef.current?.abort();
    const controller = new AbortController();
    fieldAbortRef.current = controller;
    try {
      await api.projects.update(project.slug, data, controller.signal);
      if (controller.signal.aborted) return; // superseded by a newer save
      // Update confirmed values on success before triggering parent refresh
      if ("target_word_count" in data) {
        confirmedFieldsRef.current.wordCountTarget =
          data.target_word_count != null ? String(data.target_word_count) : "";
      }
      if ("target_deadline" in data) {
        confirmedFieldsRef.current.deadline = data.target_deadline ?? "";
      }
      if ("author_name" in data) {
        confirmedFieldsRef.current.authorName = data.author_name ?? "";
      }
      onUpdate();
    } catch (err) {
      if (controller.signal.aborted) return; // superseded by a newer save
      console.error("Failed to save project setting:", err);
      // I7 (2026-04-23): route through the unified mapper instead of
      // hardcoding STRINGS.projectSettings.saveError — VALIDATION_ERROR,
      // 404, NETWORK, 2xx BAD_JSON were all collapsed to one string
      // before, violating the CLAUDE.md invariant that every user-
      // visible message goes through the scope registry.
      const { message, possiblyCommitted } = mapApiError(err, "project.updateFields");
      if (message) setFieldSaveError(message);
      // On possiblyCommitted the server likely saved the value — a
      // revert to the prior confirmed value would contradict the
      // committed state. Promote the optimistic input to "confirmed"
      // so later saves compare against the correct baseline; the
      // committed copy in the banner tells the user to refresh.
      if (possiblyCommitted) {
        if ("target_word_count" in data) {
          confirmedFieldsRef.current.wordCountTarget =
            data.target_word_count != null ? String(data.target_word_count) : "";
        }
        if ("target_deadline" in data) {
          confirmedFieldsRef.current.deadline = data.target_deadline ?? "";
        }
        if ("author_name" in data) {
          confirmedFieldsRef.current.authorName = data.author_name ?? "";
        }
        // I8: fire onUpdate on the committed branch too. The happy path
        // calls onUpdate, which refreshes the parent's project state
        // (consumed by ProgressStrip, DashboardView, velocity). Without
        // this, the dialog locally promotes the optimistic value but the
        // parent keeps rendering pre-change values — the user closes the
        // dialog and sees the old value elsewhere, concluding the save
        // did not take. The parent GET failure case (404 → navigate home)
        // is correct if the server state has actually diverged.
        onUpdate();
        return;
      }
      // Revert to last confirmed value, not stale props
      if ("target_word_count" in data) {
        setWordCountTarget(confirmedFieldsRef.current.wordCountTarget);
      }
      if ("target_deadline" in data) {
        setDeadline(confirmedFieldsRef.current.deadline);
      }
      if ("author_name" in data) {
        setAuthorName(confirmedFieldsRef.current.authorName);
      }
    }
  }

  function handleWordCountBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Skip save when focus is moving to the Clear button to avoid racing PATCHes
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.dataset.clearWordCount) return;
    const parsed = wordCountTarget.trim() === "" ? null : parseInt(wordCountTarget, 10);
    if (parsed !== null && (Number.isNaN(parsed) || parsed <= 0)) {
      setWordCountTarget(confirmedFieldsRef.current.wordCountTarget);
      return;
    }
    saveField({ target_word_count: parsed });
  }

  function handleAuthorNameBlur() {
    const trimmed = authorName.trim();
    saveField({ author_name: trimmed || null });
  }

  function handleDeadlineChange(value: string) {
    setDeadline(value);
    saveField({ target_deadline: value || null });
  }

  async function handleTimezoneChange(value: string) {
    // Cancel any in-flight timezone save to prevent out-of-order writes
    timezoneAbortRef.current?.abort();
    const controller = new AbortController();
    timezoneAbortRef.current = controller;

    userChangedTimezoneRef.current = true;
    setTimezone(value);
    setTimezoneSaveError(null);
    try {
      await api.settings.update([{ key: "timezone", value }], controller.signal);
      if (!controller.signal.aborted) {
        confirmedTimezoneRef.current = value;
        onUpdate();
      }
    } catch (err) {
      if (controller.signal.aborted) return; // superseded by a newer request
      console.error("Failed to save timezone:", err);
      const { message } = mapApiError(err, "settings.update");
      if (message) setTimezoneSaveError(message);
      setTimezone(confirmedTimezoneRef.current);
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

      {(fieldSaveError || timezoneSaveError) && (
        <p className="mb-4 text-sm text-status-error" role="alert">
          {fieldSaveError || timezoneSaveError}
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
              data-clear-word-count="true"
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
            htmlFor="project-author-name"
          >
            {STRINGS.projectSettings.authorName}
          </label>
          <input
            id="project-author-name"
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            onBlur={handleAuthorNameBlur}
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary font-sans focus:outline-none focus:ring-2 focus:ring-focus-ring"
            placeholder={STRINGS.projectSettings.authorNamePlaceholder}
          />
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
