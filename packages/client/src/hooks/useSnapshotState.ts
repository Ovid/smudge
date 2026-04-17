import { useState, useCallback, useRef, useEffect } from "react";
import { api, ApiRequestError } from "../api/client";
import { clearCachedContent } from "./useContentCache";
import type { SnapshotPanelHandle } from "../components/SnapshotPanel";

interface ViewingSnapshot {
  id: string;
  label: string | null;
  content: Record<string, unknown>;
  created_at: string;
}

export type RestoreFailureReason = "corrupt_snapshot" | "not_found" | "network" | "unknown";

export interface RestoreResult {
  ok: boolean;
  reason?: RestoreFailureReason;
  message?: string;
  // Set when the user switched chapters while the restore was in flight. The
  // restore did land on the server, but reloading the now-active chapter
  // would pull in the wrong content — callers should skip reloadActiveChapter
  // in this branch.
  staleChapterSwitch?: boolean;
}

export type ViewFailureReason = "not_found" | "corrupt_snapshot" | "network" | "unknown";

export interface ViewResult {
  ok: boolean;
  reason?: ViewFailureReason;
  // Set when the user switched chapters while the view was in flight.
  // Callers should show no banner — the response belongs to a chapter
  // that is no longer active.
  staleChapterSwitch?: boolean;
}

export interface UseSnapshotStateReturn {
  snapshotPanelOpen: boolean;
  toggleSnapshotPanel: () => void;
  setSnapshotPanelOpen: (open: boolean) => void;
  viewingSnapshot: ViewingSnapshot | null;
  viewSnapshot: (snapshot: {
    id: string;
    label: string | null;
    created_at: string;
  }) => Promise<ViewResult>;
  exitSnapshotView: () => void;
  restoreSnapshot: (snapshotId: string) => Promise<RestoreResult>;
  /**
   * Number of snapshots for the active chapter, or null when the count
   * is unknown — either because a fetch is pending or the last fetch
   * failed. The toolbar badge treats null as "don't display a count"
   * rather than falsely showing zero on a network blip.
   */
  snapshotCount: number | null;
  snapshotPanelRef: React.RefObject<SnapshotPanelHandle | null>;
}

export function useSnapshotState(chapterId: string | null): UseSnapshotStateReturn {
  const [snapshotPanelOpen, setSnapshotPanelOpenState] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<ViewingSnapshot | null>(null);
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null);
  const snapshotPanelRef = useRef<SnapshotPanelHandle>(null);
  // Monotonic counter to discard stale list responses after a chapter switch.
  const chapterSeqRef = useRef(0);

  // Reset per-chapter state when chapterId changes. Without clearing
  // viewingSnapshot here, the snapshot banner & view from chapter A
  // would persist after the user selected chapter B in the sidebar,
  // and a Restore click would silently overwrite chapter A's content.
  useEffect(() => {
    const seq = ++chapterSeqRef.current;
    // Reset to null (unknown) rather than 0 so the badge doesn't claim
    // "no snapshots" during the load gap or after a fetch failure.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: must reset before fetch resolves
    setSnapshotCount(null);

    setViewingSnapshot(null);
    if (!chapterId) return;
    api.snapshots
      .list(chapterId)
      .then((data) => {
        if (seq === chapterSeqRef.current) setSnapshotCount(data.length);
      })
      .catch(() => {
        // Leave count as null so the badge stays hidden. The next panel
        // interaction will retry via refreshCount.
      });
  }, [chapterId]);

  const setSnapshotPanelOpen = useCallback((open: boolean) => {
    setSnapshotPanelOpenState(open);
  }, []);

  const toggleSnapshotPanel = useCallback(() => {
    setSnapshotPanelOpenState((prev) => !prev);
  }, []);

  const viewSnapshot = useCallback(
    async (snapshot: {
      id: string;
      label: string | null;
      created_at: string;
    }): Promise<ViewResult> => {
      // Capture before the await so a chapter switch during the fetch
      // doesn't pin a stale snapshot to the wrong chapter. Without this,
      // a subsequent Restore click would silently overwrite the previous
      // chapter using viewingSnapshot.id.
      const seq = chapterSeqRef.current;
      try {
        const full = await api.snapshots.get(snapshot.id);
        if (seq !== chapterSeqRef.current) return { ok: true, staleChapterSwitch: true };
        let content: unknown;
        try {
          content = typeof full.content === "string" ? JSON.parse(full.content) : full.content;
        } catch {
          return { ok: false, reason: "corrupt_snapshot" };
        }
        setViewingSnapshot({
          id: snapshot.id,
          label: snapshot.label,
          content: content as Record<string, unknown>,
          created_at: snapshot.created_at,
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 404) return { ok: false, reason: "not_found" };
          return { ok: false, reason: "network" };
        }
        return { ok: false, reason: "unknown" };
      }
    },
    [],
  );

  const exitSnapshotView = useCallback(() => {
    setViewingSnapshot(null);
  }, []);

  const restoreSnapshot = useCallback(
    async (snapshotId: string): Promise<RestoreResult> => {
      // Capture seq before the restore await. If the user switches chapters
      // during the restore, we must not apply the follow-up list response
      // to the new chapter's state (wrong count) and must not reset
      // viewingSnapshot for the new chapter.
      const seq = chapterSeqRef.current;
      const restoringChapterId = chapterId;
      try {
        await api.snapshots.restore(snapshotId);
        if (seq !== chapterSeqRef.current) {
          // Chapter switched mid-restore. The server did rewrite the
          // previously-active chapter; clear its cached draft so next
          // navigation loads the restored content rather than stale edits.
          if (restoringChapterId) clearCachedContent(restoringChapterId);
          return { ok: true, staleChapterSwitch: true };
        }
        setViewingSnapshot(null);
        if (restoringChapterId) {
          api.snapshots
            .list(restoringChapterId)
            .then((data) => {
              if (seq === chapterSeqRef.current) setSnapshotCount(data.length);
            })
            .catch(() => {});
        }
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.code === "CORRUPT_SNAPSHOT") {
            return { ok: false, reason: "corrupt_snapshot", message: err.message };
          }
          // Distinguish "snapshot (or its chapter) is gone" from generic
          // network failure — retrying the former will always 404.
          if (err.status === 404) {
            return { ok: false, reason: "not_found", message: err.message };
          }
          return { ok: false, reason: "network", message: err.message };
        }
        return { ok: false, reason: "unknown" };
      }
    },
    [chapterId],
  );

  const refreshCount = useCallback(() => {
    if (!chapterId) return;
    const seq = chapterSeqRef.current;
    api.snapshots
      .list(chapterId)
      .then((data) => {
        if (seq === chapterSeqRef.current) setSnapshotCount(data.length);
      })
      .catch(() => {});
  }, [chapterId]);

  // Refresh count when panel closes (user may have created/deleted snapshots)
  useEffect(() => {
    if (!snapshotPanelOpen) {
      refreshCount();
    }
  }, [snapshotPanelOpen, refreshCount]);

  return {
    snapshotPanelOpen,
    toggleSnapshotPanel,
    setSnapshotPanelOpen,
    viewingSnapshot,
    viewSnapshot,
    exitSnapshotView,
    restoreSnapshot,
    snapshotCount,
    snapshotPanelRef,
  };
}
