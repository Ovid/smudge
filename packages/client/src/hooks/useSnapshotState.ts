import { useState, useCallback, useRef, useEffect } from "react";
import { SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { api, ApiRequestError } from "../api/client";
import { clearCachedContent } from "./useContentCache";
import type { SnapshotPanelHandle } from "../components/SnapshotPanel";

interface ViewingSnapshot {
  id: string;
  label: string | null;
  content: Record<string, unknown>;
  created_at: string;
}

export type RestoreFailureReason =
  | "corrupt_snapshot"
  | "cross_project_image"
  | "not_found"
  | "network"
  // 2xx BAD_JSON: apiFetch threw ApiRequestError(status=2xx, code="BAD_JSON")
  // because a 2xx response body failed to parse. The server almost certainly
  // committed the restore (and its auto-snapshot) but the client cannot
  // verify. Callers MUST treat this as "possibly committed" and lock the
  // editor — re-enabling would let auto-save silently revert the committed
  // restore (C2).
  | "possibly_committed"
  | "unknown";

export interface RestoreResult {
  ok: boolean;
  reason?: RestoreFailureReason;
  message?: string;
  // Set when the user switched chapters while the restore was in flight. The
  // restore did land on the server, but reloading the now-active chapter
  // would pull in the wrong content — callers should skip reloadActiveChapter
  // in this branch.
  staleChapterSwitch?: boolean;
  // The chapter id whose content was restored. Callers can compare this to
  // the currently-active chapter id (which may differ from the one the
  // restore was initiated on after an A→B→A round trip) to decide whether
  // to reload the editor.
  restoredChapterId?: string;
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
  /**
   * Imperatively re-fetch the snapshot count for the active chapter.
   * Used by flows that create auto-snapshots while the panel is closed
   * (replace-all, replace-one), since SnapshotPanelHandle.refreshSnapshots
   * is a no-op when the panel is unmounted.
   */
  refreshCount: () => void;
  /**
   * Callback passed to SnapshotPanel so its list fetches feed the count
   * badge without triggering a second GET on chapter change. Pass this
   * to SnapshotPanel as `onSnapshotsChange`.
   */
  onSnapshotsChange: (count: number) => void;
}

export function useSnapshotState(chapterId: string | null): UseSnapshotStateReturn {
  const [snapshotPanelOpen, setSnapshotPanelOpenState] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<ViewingSnapshot | null>(null);
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null);
  const snapshotPanelRef = useRef<SnapshotPanelHandle>(null);
  // Monotonic counter to discard stale list responses after a chapter switch.
  const chapterSeqRef = useRef(0);
  // Per-request sequence for viewSnapshot: guards against rapid successive
  // View clicks on the SAME chapter (where chapterSeqRef doesn't change)
  // resolving out of order — an older response would otherwise land after
  // a newer one and pin the wrong snapshot as the current view.
  const viewSeqRef = useRef(0);
  // Mirror the current chapterId so async handlers can check the live value
  // against their captured one (needed for A→B→A restore detection).
  const currentChapterIdRef = useRef<string | null>(chapterId);
  // When the panel is open it owns the list fetch and feeds the count back
  // via onSnapshotsChange — the hook skips its own fetch to avoid two GETs
  // per chapter switch.
  const panelOpenRef = useRef(snapshotPanelOpen);
  useEffect(() => {
    currentChapterIdRef.current = chapterId;
  }, [chapterId]);
  useEffect(() => {
    panelOpenRef.current = snapshotPanelOpen;
  }, [snapshotPanelOpen]);

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
    // When the panel is open its own effect is about to fetch the list —
    // delegate the count update to its onSnapshotsChange callback rather
    // than firing a parallel GET.
    if (panelOpenRef.current) return;
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
      // Per-request sequence for same-chapter rapid clicks: two View
      // clicks on the same chapter share chapterSeqRef but need their
      // own ordering so the later request "wins" regardless of network
      // resolve order.
      const vseq = ++viewSeqRef.current;
      try {
        const full = await api.snapshots.get(snapshot.id);
        if (seq !== chapterSeqRef.current) return { ok: true, staleChapterSwitch: true };
        if (vseq !== viewSeqRef.current) return { ok: true, staleChapterSwitch: true };
        // SnapshotRow.content is typed as a JSON string on the wire.
        let content: unknown;
        try {
          content = JSON.parse(full.content);
        } catch {
          return { ok: false, reason: "corrupt_snapshot" };
        }
        // Reject anything that is not a plain object: valid JSON like
        // "42", "null", or "[1,2,3]" parses successfully but is not a
        // TipTap document and would crash the read-only preview editor
        // when we hand it to TipTap downstream. The server's restore path
        // gates on TipTapDocSchema.safeParse for the same reason; surface
        // a clean corrupt_snapshot here rather than letting the editor
        // throw.
        if (content === null || typeof content !== "object" || Array.isArray(content)) {
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
        // Mirror the success-path stale-seq guards: a chapter switch (or a
        // newer View click on the same chapter) during the in-flight GET
        // should not surface the response's error on the now-active panel.
        // Without this, a 404 from the old chapter's snapshot lands as a
        // "snapshot no longer exists" banner attributed to the new chapter.
        if (seq !== chapterSeqRef.current) return { ok: true, staleChapterSwitch: true };
        if (vseq !== viewSeqRef.current) return { ok: true, staleChapterSwitch: true };
        if (err instanceof ApiRequestError) {
          // ABORTED is not a user-visible error — treat it like a stale
          // chapter-switch: silent no-op.
          if (err.code === "ABORTED") return { ok: true, staleChapterSwitch: true };
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
        // A→B→A round-trip: seq moved but the current chapter is once
        // again the one we restored. Treat that as a NOT-stale completion
        // — the caller should reload the editor because the restore
        // landed on what the user is viewing now.
        const seqMoved = seq !== chapterSeqRef.current;
        const stillOnRestoredChapter = currentChapterIdRef.current === restoringChapterId;
        if (seqMoved && !stillOnRestoredChapter) {
          // True stale switch: user navigated away and stayed away. Clear
          // the restoring chapter's cached draft so next navigation loads
          // restored content rather than stale edits, but don't reload.
          if (restoringChapterId) clearCachedContent(restoringChapterId);
          return {
            ok: true,
            staleChapterSwitch: true,
            ...(restoringChapterId ? { restoredChapterId: restoringChapterId } : {}),
          };
        }
        setViewingSnapshot(null);
        if (restoringChapterId) {
          // Use the CURRENT ref seq for the follow-up list, since the
          // old seq is stale after an A→B→A round-trip. The list still
          // needs to be keyed to the current chapterSeq so a later
          // switch can discard it.
          const freshSeq = chapterSeqRef.current;
          api.snapshots
            .list(restoringChapterId)
            .then((data) => {
              if (freshSeq === chapterSeqRef.current) setSnapshotCount(data.length);
            })
            .catch(() => {});
        }
        return {
          ok: true,
          ...(restoringChapterId ? { restoredChapterId: restoringChapterId } : {}),
        };
      } catch (err) {
        if (err instanceof ApiRequestError) {
          // 2xx BAD_JSON: server likely committed the restore but response
          // body was unreadable. Surface as "possibly_committed" so the
          // caller locks the editor (C2) instead of letting auto-save
          // revert the committed restore via the generic "network" retry
          // path.
          if (err.code === "BAD_JSON" && err.status >= 200 && err.status < 300) {
            return { ok: false, reason: "possibly_committed", message: err.message };
          }
          if (err.code === SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT) {
            return { ok: false, reason: "corrupt_snapshot", message: err.message };
          }
          if (err.code === SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF) {
            return { ok: false, reason: "cross_project_image", message: err.message };
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

  // Feeds the hook's count from the panel's own list fetch so the toolbar
  // badge stays in sync without duplicating the GET.
  const onSnapshotsChange = useCallback((count: number) => {
    setSnapshotCount(count);
  }, []);

  // Refresh count on the open→closed transition (user may have created or
  // deleted snapshots while the panel was open). Tracking the previous
  // state in a ref prevents the mount-time `false` → `false` no-op from
  // firing a redundant list request alongside the chapterId-driven fetch.
  const prevPanelOpenRef = useRef(snapshotPanelOpen);
  useEffect(() => {
    if (prevPanelOpenRef.current && !snapshotPanelOpen) {
      refreshCount();
    }
    prevPanelOpenRef.current = snapshotPanelOpen;
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
    refreshCount,
    onSnapshotsChange,
  };
}
