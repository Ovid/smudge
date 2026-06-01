import { useState, useRef, useEffect } from "react";

export interface InlineTitleGates {
  isActionBusy: () => boolean;
  isEditorLocked: () => boolean;
}

export interface InlineTitleOptions<T> {
  // true ⇒ bail and keep edit mode open (e.g. the project slug-drift window).
  driftCheck?: () => boolean;
  // Runs on success only, with the defined save result.
  onAfterSave?: (result: T) => void;
  // Called on edit-start AND on entity (currentId) change.
  clearError?: () => void;
}

export interface InlineTitleEditing {
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  start: () => void;
  save: () => Promise<void>;
  cancel: () => void;
}

// Canonical inline edit/cancel/commit machine shared by useChapterTitleEditing
// and useProjectTitleEditing. Entity-agnostic: takes the current id + title as
// plain values and a unified onSave callback. Returns undefined from onSave to
// signal failure (edit mode stays open); any defined value is success and runs
// options.onAfterSave.
export function useInlineTitleEditing<T>(
  currentId: string | undefined,
  currentTitle: string | undefined,
  onSave: (id: string, title: string) => Promise<T | undefined>,
  gates: InlineTitleGates,
  options?: InlineTitleOptions<T>,
): InlineTitleEditing {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const isSavingRef = useRef(false);
  const prevIdRef = useRef<string | undefined>(currentId);

  // Hold the latest options so the entity-change effect can read clearError
  // without taking `options` (a fresh object each render) as a dependency,
  // which would refire the effect every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Cancel editing when the entity changes (e.g. keyboard navigation) so a
  // pending blur cannot save the draft to the wrong entity. Skip the initial
  // undefined → first id transition: nothing to cancel, and it can race a
  // double-click that enters edit mode before the effect flushes.
  useEffect(() => {
    if (prevIdRef.current !== undefined && prevIdRef.current !== currentId) {
      escapePressedRef.current = true;
      // Normalization (Phase 4b.15): reset the in-flight latch and clear the
      // error on entity change. Both are safety-positive — escapePressedRef is
      // also set here, so the next save() bails before any mutation.
      isSavingRef.current = false;
      setEditing(false);
      optionsRef.current?.clearError?.();
    }
    prevIdRef.current = currentId;
  }, [currentId]);

  function start() {
    if (currentId === undefined || currentTitle === undefined) return;
    escapePressedRef.current = false;
    options?.clearError?.();
    setDraft(currentTitle);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function save() {
    if (isSavingRef.current) return;
    if (escapePressedRef.current) {
      setEditing(false);
      return;
    }
    if (currentId === undefined || !draft.trim()) {
      setEditing(false);
      return;
    }
    // Opt-in drift bail (project slug-drift). Keep edit mode open so the typed
    // draft survives for retry once the entity state settles.
    if (options?.driftCheck?.()) {
      return;
    }
    // Refuse mid-mutation or while the lock banner is up. Keep edit mode open
    // so the draft is preserved for retry — closing here would discard it.
    if (gates.isActionBusy() || gates.isEditorLocked()) {
      return;
    }
    isSavingRef.current = true;
    try {
      const trimmed = draft.trim();
      if (trimmed !== currentTitle) {
        const result = await onSave(currentId, trimmed);
        if (result === undefined) return; // keep edit mode open on failure
        options?.onAfterSave?.(result);
      }
      // Prevent the blur handler (fired when the input unmounts) from
      // re-entering save().
      escapePressedRef.current = true;
      setEditing(false);
    } finally {
      isSavingRef.current = false;
    }
  }

  function cancel() {
    escapePressedRef.current = true;
    setEditing(false);
  }

  // Plain per-render closures: do NOT useCallback-wrap start/save. They must
  // read the latest draft, entity, gates, and options (notably driftCheck)
  // each render; a useCallback with an incomplete dep array would capture a
  // stale draft or stale draftCheck and silently save the wrong text or skip
  // the drift bail. setDraft and inputRef are already stable. (Design Finding 2.)
  return {
    editing,
    draft,
    setDraft,
    inputRef,
    start,
    save,
    cancel,
  };
}
