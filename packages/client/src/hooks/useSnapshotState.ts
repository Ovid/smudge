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

  // Fetch snapshot count when chapterId changes. Reset to 0 first so the
  // badge never briefly shows the previous chapter's count while the
  // list request is in flight.
  useEffect(() => {
    const seq = ++chapterSeqRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: must reset before fetch resolves
    setSnapshotCount(0);
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
      try {
        const full = await api.snapshots.get(snapshot.id);
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
      try {
        await api.snapshots.restore(snapshotId);
        setViewingSnapshot(null);
        if (chapterId) {
          const seq = chapterSeqRef.current;
          api.snapshots
            .list(chapterId)
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
