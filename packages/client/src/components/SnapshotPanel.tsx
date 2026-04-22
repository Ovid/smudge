import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import type { SnapshotListItem } from "@smudge/shared";

const S = STRINGS.snapshots;

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return S.relativeTime.justNow;
  if (mins < 60) return S.relativeTime.minutes(mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return S.relativeTime.hours(hrs);
  const days = Math.floor(hrs / 24);
  return S.relativeTime.days(days);
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface SnapshotPanelHandle {
  refreshSnapshots: () => void;
}

interface SnapshotPanelProps {
  chapterId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onView: (snapshot: { id: string; label: string | null; created_at: string }) =>
    | Promise<
        // I6: `staleChapterSwitch` on the ok branch signals that the view was
        // abandoned because the user changed chapters mid-fetch. The panel
        // surfaces a brief info rather than treating ok:true as a success.
        { ok: true; staleChapterSwitch?: boolean } | { ok: false; reason?: string } | undefined
      >
    | undefined;
  /**
   * Called before snapshot creation. The panel awaits this so the server
   * snapshots the chapter AFTER any pending editor save has landed —
   * otherwise a snapshot taken right after typing captures stale content.
   *
   * Result contract (I5 — review 2026-04-21):
   * - `{ ok: true }`: proceed with the snapshot POST.
   * - `{ ok: false, reason: "flush_failed" }`: the pre-save failed; surface
   *   createFailed to the user so they don't think the snapshot landed
   *   when it was silently aborted.
   * - `{ ok: false, reason: "busy" }`: a concurrent mutation (restore /
   *   replace) is in flight. The caller already raised its own
   *   mutationBusy info banner — the panel suppresses createError here
   *   to avoid a contradictory pair of banners.
   * - `{ ok: false, reason: "locked" }`: the editor-lock banner (refresh-the-
   *   page) is showing after a possibly-committed restore/replace. The
   *   persistent lock banner is the sole user-visible signal — the panel
   *   suppresses createError to avoid contradicting "refresh the page" with
   *   "save and try again."
   */
  onBeforeCreate?: () => Promise<
    { ok: true } | { ok: false; reason: "busy" | "flush_failed" | "locked" }
  >;
  /**
   * Fired every time the panel's list fetch succeeds, with the current
   * snapshot count. Lets the parent hook drive the toolbar badge from
   * the panel's single source of truth instead of issuing its own GET.
   */
  onSnapshotsChange?: (count: number) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const SnapshotPanel = forwardRef<SnapshotPanelHandle, SnapshotPanelProps>(
  function SnapshotPanel(
    { chapterId, isOpen, onClose, onView, onBeforeCreate, onSnapshotsChange, triggerRef },
    ref,
  ) {
    const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createLabel, setCreateLabel] = useState("");
    const [duplicateMessage, setDuplicateMessage] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [viewError, setViewError] = useState<string | null>(null);
    const panelRef = useRef<HTMLElement>(null);
    // Seed to `false` (not `isOpen`): the panel is conditionally mounted
    // by the parent, so isOpen is always true on first render. Seeding
    // from isOpen would defeat the `isOpen && !prevIsOpen.current` guard
    // and the focus RAF would never fire on initial open — breaking
    // keyboard entry to the panel.
    const prevIsOpen = useRef(false);
    // Distinguishes "user pressed Escape / clicked Close" from
    // "parent closed us because another panel opened". Panel-exclusivity
    // closes should NOT return focus to this panel's trigger — the sibling
    // panel is about to acquire focus, and racing a focus() call against
    // its focus-acquire produces visible flicker and can land focus on the
    // wrong element for keyboard users.
    const closedByUserRef = useRef(false);
    // Guards async list responses against rapid chapter switches: every
    // chapter change bumps the seq, and stale resolutions check before
    // calling setSnapshots. Without this, the imperative refreshSnapshots()
    // path could overwrite a newer chapter's list with a stale one.
    const chapterSeqRef = useRef(0);

    const fetchSnapshots = useCallback(async () => {
      if (!chapterId) return;
      const seq = chapterSeqRef.current;
      try {
        const data = await api.snapshots.list(chapterId);
        if (seq !== chapterSeqRef.current) return;
        setSnapshots(data);
        setListError(null);
        onSnapshotsChange?.(data.length);
      } catch {
        if (seq !== chapterSeqRef.current) return;
        // Surface the failure instead of silently showing an empty panel;
        // otherwise a network blip makes the user think a chapter with
        // snapshots has none.
        setListError(S.listFailed);
      }
    }, [chapterId, onSnapshotsChange]);

    useImperativeHandle(ref, () => ({ refreshSnapshots: fetchSnapshots }), [fetchSnapshots]);

    // Fetch on mount and when chapterId changes
    useEffect(() => {
      // Bump seq before fetching so any in-flight list response from the
      // prior chapter is discarded by fetchSnapshots' seq check.
      chapterSeqRef.current++;
      if (!isOpen || !chapterId) return;
      const seq = chapterSeqRef.current;
      api.snapshots
        .list(chapterId)
        .then((data) => {
          if (seq !== chapterSeqRef.current) return;
          setSnapshots(data);
          setListError(null);
          onSnapshotsChange?.(data.length);
        })
        .catch(() => {
          if (seq !== chapterSeqRef.current) return;
          setListError(S.listFailed);
        });
    }, [isOpen, chapterId, onSnapshotsChange]);

    // Focus management
    useEffect(() => {
      if (isOpen && !prevIsOpen.current) {
        // Panel just opened — focus it synchronously. The panel element
        // exists by the time this effect runs (useEffect fires after
        // commit), so there's no need to defer via RAF — and deferring
        // introduced an async focus-steal that could race adjacent user
        // interactions (e.g. typing into an input on the same render).
        panelRef.current?.focus();
        prevIsOpen.current = isOpen;
        return;
      }
      if (!isOpen && prevIsOpen.current && triggerRef?.current) {
        // Panel just closed — return focus to trigger ONLY when the
        // close was a user action (Escape / Close button). When the
        // parent closed us for panel exclusivity, another panel is
        // about to take focus and we must not race it.
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

    // Reset form state when panel closes or chapter changes. Uses the
    // "store previous value" pattern from the React docs
    // (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
    // because the project's `react-hooks/set-state-in-effect` lint rule
    // forbids resetting state from inside a useEffect. The conditional
    // setState during render fires once per resetKey change and is safe
    // under StrictMode / concurrent mode.
    const resetKey = `${chapterId}:${isOpen}`;
    const [prevResetKey, setPrevResetKey] = useState(resetKey);
    if (prevResetKey !== resetKey) {
      setPrevResetKey(resetKey);
      setShowCreateForm(false);
      setCreateLabel("");
      setDuplicateMessage(false);
      setCreateError(null);
      setConfirmDeleteId(null);
      setDeleteError(null);
      setListError(null);
      setViewError(null);
    }

    const handleCreate = async () => {
      if (!chapterId) return;
      setCreateError(null);
      // Ensure any pending editor save has flushed so the server-side
      // snapshot reflects the user's latest keystrokes. If the flush
      // failed, surface that to the user so they don't think the snapshot
      // succeeded when it was silently aborted.
      if (onBeforeCreate) {
        // I3: defense-in-depth. EditorPage's onBeforeCreate wraps its
        // flushSave in try/catch, but a future caller that forgets the
        // wrap would otherwise produce an unhandled rejection here (the
        // caller's subsequent try/catch below only wraps api.snapshots.create,
        // not this await).
        let outcome: { ok: true } | { ok: false; reason: "busy" | "flush_failed" | "locked" };
        try {
          outcome = await onBeforeCreate();
        } catch {
          setCreateError(S.createFailed);
          return;
        }
        if (!outcome.ok) {
          // I5 (review 2026-04-21): busy-return is not a failure — the
          // caller has already surfaced its own mutationBusy info banner.
          // Suppressing createError here avoids two contradictory banners
          // ("Unable to create… save your unsaved changes" + "Another
          // action is in progress"). The flush-failed branch still
          // surfaces createFailed because the save genuinely did not
          // land and the user must know before believing the snapshot
          // succeeded. Same treatment for "locked": the persistent lock
          // banner ("refresh the page") is the user-visible signal —
          // stamping createError on top would contradict it.
          if (outcome.reason === "flush_failed") {
            setCreateError(S.createFailed);
          }
          return;
        }
      }
      try {
        const result = await api.snapshots.create(chapterId, createLabel.trim() || undefined);
        if (result.status === "duplicate") {
          setDuplicateMessage(true);
          return;
        }
        setShowCreateForm(false);
        setCreateLabel("");
        setDuplicateMessage(false);
        await fetchSnapshots();
      } catch {
        setCreateError(S.createFailed);
      }
    };

    const handleDelete = async (id: string) => {
      setDeleteError(null);
      try {
        await api.snapshots.delete(id);
        setConfirmDeleteId(null);
        await fetchSnapshots();
      } catch (err) {
        // 404 means the snapshot is already gone (deleted in another tab,
        // or the parent chapter was soft-deleted). The server already
        // agrees with the user's intent; refresh the list and close the
        // dialog rather than looping on the same 404.
        if (err instanceof ApiRequestError && err.status === 404) {
          setConfirmDeleteId(null);
          await fetchSnapshots();
          return;
        }
        // Keep the confirm dialog open and surface an error so the user
        // knows the delete didn't land — silently swallowing it makes
        // users believe a destructive action succeeded when it hadn't.
        setDeleteError(S.deleteFailed);
      }
    };

    if (!isOpen) return null;

    const manualCount = snapshots.filter((s) => !s.is_auto).length;
    const autoCount = snapshots.filter((s) => s.is_auto).length;

    return (
      <aside
        ref={panelRef}
        aria-label={S.ariaLabel}
        tabIndex={-1}
        className="border-l border-border/60 bg-bg-sidebar flex flex-col h-full overflow-hidden w-80 min-w-80 focus:outline-none"
      >
        {/* Header */}
        <div className="border-b border-border/40 px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary font-sans">{S.panelTitle}</h2>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {/* Count summary */}
          {snapshots.length > 0 && (
            <p className="text-xs text-text-secondary font-sans">
              {S.count(manualCount, autoCount)}
            </p>
          )}

          {/* Create button / form */}
          {!showCreateForm ? (
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(true);
                setDuplicateMessage(false);
              }}
              className="w-full text-sm font-medium text-accent border border-accent/40 rounded px-3 py-1.5 hover:bg-accent/10 transition-colors font-sans"
            >
              {S.createButton}
            </button>
          ) : (
            <div className="flex flex-col gap-2 border border-border/40 rounded p-3">
              <input
                type="text"
                placeholder={S.labelPlaceholder}
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                className="text-sm border border-border/40 rounded px-2 py-1 bg-white text-text-primary placeholder:text-text-secondary/60 font-sans focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {duplicateMessage && (
                <p className="text-xs text-amber-700 font-sans">{S.duplicateSkipped}</p>
              )}
              {createError && (
                <p role="alert" className="text-xs text-red-700 font-sans">
                  {createError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  className="text-sm font-medium text-white bg-accent rounded px-3 py-1 hover:bg-accent/90 transition-colors font-sans"
                >
                  {S.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    setCreateLabel("");
                    setDuplicateMessage(false);
                  }}
                  className="text-sm text-text-secondary hover:text-text-primary transition-colors font-sans"
                >
                  {S.cancel}
                </button>
              </div>
            </div>
          )}

          {/* List error */}
          {listError && (
            <p role="alert" className="text-xs text-red-700 font-sans">
              {listError}
            </p>
          )}

          {/* View error */}
          {viewError && (
            <p role="alert" className="text-xs text-red-700 font-sans">
              {viewError}
            </p>
          )}

          {/* Empty state */}
          {snapshots.length === 0 && !listError && (
            <p className="text-sm text-text-secondary text-center py-6 font-sans">{S.emptyState}</p>
          )}

          {/* Snapshot list */}
          {snapshots.length > 0 && (
            <ul className="flex flex-col gap-2">
              {snapshots.map((snap) => (
                <li
                  key={snap.id}
                  className="border border-border/30 rounded p-3 flex flex-col gap-1.5"
                >
                  <div className="flex items-center gap-2">
                    {snap.label ? (
                      <span className="text-sm font-medium text-text-primary font-sans truncate">
                        {snap.label}
                      </span>
                    ) : (
                      <span className="text-sm text-text-secondary/70 italic font-sans truncate">
                        {S.untitled}
                      </span>
                    )}
                    {snap.is_auto && (
                      <span className="text-[10px] uppercase tracking-wide bg-border/30 text-text-secondary px-1.5 py-0.5 rounded font-sans flex-shrink-0">
                        {S.auto}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-text-secondary font-sans">
                    <span title={fullDate(snap.created_at)}>{relativeDate(snap.created_at)}</span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{S.wordCount(snap.word_count)}</span>
                  </div>

                  {/* Actions */}
                  {confirmDeleteId === snap.id ? (
                    <div className="flex flex-col gap-1.5 mt-1">
                      <p className="text-xs text-red-700 font-sans">{S.deleteConfirm}</p>
                      {deleteError && (
                        <p role="alert" className="text-xs text-red-700 font-sans">
                          {deleteError}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(snap.id)}
                          className="text-xs font-medium text-red-700 hover:text-red-900 transition-colors font-sans"
                        >
                          {S.deleteConfirmButton}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(null);
                            setDeleteError(null);
                          }}
                          className="text-xs text-text-secondary hover:text-text-primary transition-colors font-sans"
                        >
                          {S.deleteCancel}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={async () => {
                          setViewError(null);
                          const res = await onView({
                            id: snap.id,
                            label: snap.label,
                            created_at: snap.created_at,
                          });
                          // I6: explicit staleChapterSwitch branch. Without
                          // this the click produced no feedback — the panel
                          // only read the error discriminant, so a benign
                          // chapter-switch race looked identical to a dead
                          // button. Surface the info copy through the same
                          // viewError slot so the row's existing visual
                          // treatment applies.
                          if (res && "ok" in res && res.ok && res.staleChapterSwitch) {
                            setViewError(S.viewStaleChapterSwitch);
                          } else if (res && "ok" in res && !res.ok) {
                            if (res.reason === "not_found") {
                              setViewError(S.viewFailedNotFound);
                              await fetchSnapshots();
                            } else if (res.reason === "corrupt_snapshot") {
                              setViewError(S.viewFailedCorrupt);
                            } else if (res.reason === "save_failed") {
                              setViewError(S.viewFailedSaveFirst);
                            } else if (res.reason === "network") {
                              // S4: mirror restore/replace's dedicated network
                              // copy. The generic viewFailed ("Try again") is
                              // misleading on a connection drop — a retry will
                              // fail identically until the network recovers.
                              setViewError(S.viewFailedNetwork);
                            } else if (res.reason === "locked" || res.reason === "busy") {
                              // S1: caller refused before touching the editor
                              // because the lock banner is up (locked) or a
                              // mutation is in flight (busy). Both surfaces
                              // have their own user-visible signal already —
                              // suppress the panel-local viewError to avoid a
                              // contradictory second banner.
                            } else {
                              setViewError(S.viewFailed);
                            }
                          }
                        }}
                        className="text-xs font-medium text-accent hover:text-accent/80 transition-colors font-sans"
                      >
                        {S.view}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(snap.id)}
                        className="text-xs text-text-secondary hover:text-red-700 transition-colors font-sans"
                      >
                        {S.delete}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    );
  },
);
