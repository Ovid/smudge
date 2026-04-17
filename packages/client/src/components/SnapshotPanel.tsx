import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { api } from "../api/client";
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
  onView: (
    snapshot: { id: string; label: string | null; created_at: string },
  ) => void | Promise<void>;
  /**
   * Called before snapshot creation. The panel awaits this so the server
   * snapshots the chapter AFTER any pending editor save has landed —
   * otherwise a snapshot taken right after typing captures stale content.
   * Should resolve true when the pre-save completed (or nothing was dirty)
   * and false when it failed, in which case snapshot creation is skipped.
   */
  onBeforeCreate?: () => Promise<boolean>;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export const SnapshotPanel = forwardRef<SnapshotPanelHandle, SnapshotPanelProps>(
  function SnapshotPanel(
    { chapterId, isOpen, onClose, onView, onBeforeCreate, triggerRef },
    ref,
  ) {
    const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createLabel, setCreateLabel] = useState("");
    const [duplicateMessage, setDuplicateMessage] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const panelRef = useRef<HTMLElement>(null);
    const prevIsOpen = useRef(isOpen);

    const fetchSnapshots = useCallback(async () => {
      if (!chapterId) return;
      try {
        const data = await api.snapshots.list(chapterId);
        setSnapshots(data);
      } catch {
        // Silently fail — panel shows empty state
      }
    }, [chapterId]);

    useImperativeHandle(ref, () => ({ refreshSnapshots: fetchSnapshots }), [fetchSnapshots]);

    // Fetch on mount and when chapterId changes
    useEffect(() => {
      if (!isOpen || !chapterId) return;
      let cancelled = false;
      api.snapshots
        .list(chapterId)
        .then((data) => {
          if (!cancelled) setSnapshots(data);
        })
        .catch(() => {
          // Silently fail — panel shows empty state
        });
      return () => {
        cancelled = true;
      };
    }, [isOpen, chapterId]);

    // Focus management
    useEffect(() => {
      if (isOpen && !prevIsOpen.current) {
        // Panel just opened — focus it
        const raf = requestAnimationFrame(() => {
          panelRef.current?.focus();
        });
        prevIsOpen.current = isOpen;
        return () => cancelAnimationFrame(raf);
      }
      if (!isOpen && prevIsOpen.current && triggerRef?.current) {
        // Panel just closed — return focus to trigger
        triggerRef.current.focus();
      }
      prevIsOpen.current = isOpen;
    }, [isOpen, triggerRef]);

    // Escape key handler
    useEffect(() => {
      if (!isOpen) return;
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
          onClose();
        }
      }
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    // Reset form state when panel closes or chapter changes.
    useEffect(() => {
      setShowCreateForm(false);
      setCreateLabel("");
      setDuplicateMessage(false);
      setConfirmDeleteId(null);
    }, [chapterId, isOpen]);

    const handleCreate = async () => {
      if (!chapterId) return;
      // Ensure any pending editor save has flushed so the server-side
      // snapshot reflects the user's latest keystrokes.
      if (onBeforeCreate) {
        const flushed = await onBeforeCreate();
        if (!flushed) return;
      }
      try {
        const result = await api.snapshots.create(chapterId, createLabel.trim() || undefined);
        if ("message" in result) {
          setDuplicateMessage(true);
          return;
        }
        setShowCreateForm(false);
        setCreateLabel("");
        setDuplicateMessage(false);
        await fetchSnapshots();
      } catch {
        // Silently fail
      }
    };

    const handleDelete = async (id: string) => {
      try {
        await api.snapshots.delete(id);
        setConfirmDeleteId(null);
        await fetchSnapshots();
      } catch {
        // Silently fail
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

          {/* Empty state */}
          {snapshots.length === 0 && (
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
                    <span>{snap.word_count.toLocaleString()} words</span>
                  </div>

                  {/* Actions */}
                  {confirmDeleteId === snap.id ? (
                    <div className="flex flex-col gap-1.5 mt-1">
                      <p className="text-xs text-red-700 font-sans">{S.deleteConfirm}</p>
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
                          onClick={() => setConfirmDeleteId(null)}
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
                        onClick={() =>
                          onView({
                            id: snap.id,
                            label: snap.label,
                            created_at: snap.created_at,
                          })
                        }
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
