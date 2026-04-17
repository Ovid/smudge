import { useState, useCallback, useRef, useEffect } from "react";
import { api, ApiRequestError } from "../api/client";
import type { SnapshotPanelHandle } from "../components/SnapshotPanel";

interface ViewingSnapshot {
  id: string;
  label: string | null;
  content: Record<string, unknown>;
  created_at: string;
}

export type RestoreFailureReason = "corrupt_snapshot" | "network" | "unknown";

export interface RestoreResult {
  ok: boolean;
  reason?: RestoreFailureReason;
  message?: string;
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
  }) => Promise<void>;
  exitSnapshotView: () => void;
  restoreSnapshot: (snapshotId: string) => Promise<RestoreResult>;
  snapshotCount: number;
  snapshotPanelRef: React.RefObject<SnapshotPanelHandle | null>;
}

export function useSnapshotState(chapterId: string | null): UseSnapshotStateReturn {
  const [snapshotPanelOpen, setSnapshotPanelOpenState] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<ViewingSnapshot | null>(null);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const snapshotPanelRef = useRef<SnapshotPanelHandle>(null);
  // Monotonic counter to discard stale list responses after a chapter switch.
  const chapterSeqRef = useRef(0);

  // Reset per-chapter state when chapterId changes. Without clearing
  // viewingSnapshot here, the snapshot banner & view from chapter A
  // would persist after the user selected chapter B in the sidebar,
  // and a Restore click would silently overwrite chapter A's content.
  useEffect(() => {
    const seq = ++chapterSeqRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: must reset before fetch resolves
    setSnapshotCount(0);

    setViewingSnapshot(null);
    if (!chapterId) return;
    api.snapshots
      .list(chapterId)
      .then((data) => {
        if (seq === chapterSeqRef.current) setSnapshotCount(data.length);
      })
      .catch(() => {
        // Silently fail
      });
  }, [chapterId]);

  const setSnapshotPanelOpen = useCallback((open: boolean) => {
    setSnapshotPanelOpenState(open);
  }, []);

  const toggleSnapshotPanel = useCallback(() => {
    setSnapshotPanelOpenState((prev) => !prev);
  }, []);

  const viewSnapshot = useCallback(
    async (snapshot: { id: string; label: string | null; created_at: string }) => {
      // Capture before the await so a chapter switch during the fetch
      // doesn't pin a stale snapshot to the wrong chapter. Without this,
      // a subsequent Restore click would silently overwrite the previous
      // chapter using viewingSnapshot.id.
      const seq = chapterSeqRef.current;
      try {
        const full = await api.snapshots.get(snapshot.id);
        if (seq !== chapterSeqRef.current) return;
        const content = typeof full.content === "string" ? JSON.parse(full.content) : full.content;
        setViewingSnapshot({
          id: snapshot.id,
          label: snapshot.label,
          content,
          created_at: snapshot.created_at,
        });
      } catch {
        // Silently fail
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
        if (seq !== chapterSeqRef.current) return { ok: true };
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
          if (err.status === 422 && err.code === "CORRUPT_SNAPSHOT") {
            return { ok: false, reason: "corrupt_snapshot", message: err.message };
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
