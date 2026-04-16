import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "../api/client";
import type { SnapshotPanelHandle } from "../components/SnapshotPanel";

interface ViewingSnapshot {
  id: string;
  label: string | null;
  content: Record<string, unknown>;
  created_at: string;
}

export interface UseSnapshotStateReturn {
  snapshotPanelOpen: boolean;
  toggleSnapshotPanel: () => void;
  setSnapshotPanelOpen: (open: boolean) => void;
  viewingSnapshot: ViewingSnapshot | null;
  viewSnapshot: (snapshot: { id: string; label: string | null; created_at: string }) => Promise<void>;
  exitSnapshotView: () => void;
  restoreSnapshot: (snapshotId: string) => Promise<boolean>;
  snapshotCount: number;
  snapshotPanelRef: React.RefObject<SnapshotPanelHandle | null>;
}

export function useSnapshotState(chapterId: string | null): UseSnapshotStateReturn {
  const [snapshotPanelOpen, setSnapshotPanelOpenState] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<ViewingSnapshot | null>(null);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const snapshotPanelRef = useRef<SnapshotPanelHandle>(null);

  // Fetch snapshot count when chapterId changes or panel opens
  useEffect(() => {
    if (!chapterId) {
      setSnapshotCount(0);
      return;
    }
    let cancelled = false;
    api.snapshots.list(chapterId).then((data) => {
      if (!cancelled) setSnapshotCount(data.length);
    }).catch(() => {
      // Silently fail
    });
    return () => { cancelled = true; };
  }, [chapterId]);

  const setSnapshotPanelOpen = useCallback((open: boolean) => {
    setSnapshotPanelOpenState(open);
  }, []);

  const toggleSnapshotPanel = useCallback(() => {
    setSnapshotPanelOpenState((prev) => !prev);
  }, []);

  const viewSnapshot = useCallback(async (snapshot: { id: string; label: string | null; created_at: string }) => {
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
  }, []);

  const exitSnapshotView = useCallback(() => {
    setViewingSnapshot(null);
  }, []);

  const restoreSnapshot = useCallback(async (snapshotId: string): Promise<boolean> => {
    try {
      await api.snapshots.restore(snapshotId);
      setViewingSnapshot(null);
      // Refresh the count (the auto-snapshot from restore adds one)
      if (chapterId) {
        api.snapshots.list(chapterId).then((data) => {
          setSnapshotCount(data.length);
        }).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }, [chapterId]);

  const refreshCount = useCallback(() => {
    if (!chapterId) return;
    api.snapshots.list(chapterId).then((data) => {
      setSnapshotCount(data.length);
    }).catch(() => {});
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
