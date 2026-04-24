import { useState, useCallback, useRef, useEffect } from "react";
import { SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { api, ApiRequestError } from "../api/client";
import { mapApiError } from "../errors";
import { clearCachedContent } from "./useContentCache";
import { useAbortableSequence } from "./useAbortableSequence";
import type { SnapshotPanelHandle } from "../components/SnapshotPanel";

// Synthetic ApiRequestErrors for failure paths where the hook caught a
// non-ApiRequestError (or wants to remap a real ApiRequestError to a
// different classification). The caller only ever inspects the failure arm
// via mapApiError, so these need to produce the right MappedError fields:
//   - NETWORK (status 0, code "NETWORK") → `transient: true` via the
//     snapshot.{restore,view} scope's `network:` entry. apiFetch wraps
//     every real network/fetch failure in ApiRequestError, so a bare
//     non-ApiRequestError throw is a purely-client bug (the request never
//     reached the server) — synthesizing NETWORK gives the caller the
//     dismissible transient-retry copy rather than the possibly-committed
//     lock banner.
//   - CORRUPT_SNAPSHOT code → scope's byCode entry for the "this snapshot
//     is corrupt" copy.
// Keeping the synthesis inside the hook means EditorPage never has to
// reason about non-ApiRequestError throws — every failure arm carries a
// real ApiRequestError that the scope registry knows how to classify.
// S13 (2026-04-23 review): synthetic ApiRequestError.message values are
// DEVELOPER-facing only. The mapper never reads them, but any future
// log surface that does must not mistake them for user-facing copy.
// The `[dev]` prefix pins that intent visually so a log leak is
// immediately recognizable.
function makeClientNetworkError(): ApiRequestError {
  return new ApiRequestError("[dev] Client-side failure before request reached server", 0, "NETWORK");
}
// I2 (2026-04-23 review): synthesize a 200 BAD_JSON for post-success
// throws (localStorage.removeItem in Safari private mode, setState on
// a torn-down boundary, etc.) so mapApiError routes through the
// possiblyCommitted arm — the server likely committed the mutation,
// retrying would double-commit. Paired with restoreSnapshot's catch.
function makeClientCommittedError(): ApiRequestError {
  return new ApiRequestError(
    "[dev] Client-side failure after request reached server; response state unknown",
    200,
    "BAD_JSON",
  );
}
function makeCorruptViewError(): ApiRequestError {
  return new ApiRequestError(
    "[dev] Snapshot content could not be parsed as a TipTap document",
    400,
    SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT,
  );
}

interface ViewingSnapshot {
  id: string;
  label: string | null;
  content: Record<string, unknown>;
  created_at: string;
}

// Why this view request's result was discarded. Separated from the failure
// arm because a superseded view is not a failure — the server may have
// returned 200 with a valid snapshot, we just don't want to surface it.
// Review S6 (2026-04-22) split this from a single `staleChapterSwitch`
// boolean so the panel can show "belongs to a different chapter" copy
// ONLY on actual chapter switches, not on rapid same-chapter reclicks
// where the newer click is already updating the UI.
export type ViewSupersededReason =
  // User switched chapters during the GET — the response applies to a
  // chapter that is no longer active. Panel surfaces an info banner
  // telling the user to select that chapter.
  | "chapter"
  // User clicked View again on the same chapter before this one resolved —
  // the newer click is winning. Panel should stay silent; the fresh view
  // is already updating the UI.
  | "sameChapterNewer";

// Discriminated union: the failure arm carries the caught ApiRequestError
// verbatim so the caller can run it through mapApiError("snapshot.restore")
// to get `{ message, possiblyCommitted, transient }` — one mapping table
// lives in errors/scopes.ts instead of duplicated ladders across the hook
// and EditorPage. Non-ApiRequestError throws are normalized into a synthetic
// NETWORK ApiRequestError in the hook so the caller only ever branches on
// MappedError fields; see the restoreSnapshot catch block.
export type RestoreResult =
  | {
      ok: true;
      // Set when the user switched chapters while the restore was in flight.
      // The restore did land on the server, but reloading the now-active
      // chapter would pull in the wrong content — callers should skip
      // reloadActiveChapter in this branch.
      staleChapterSwitch?: boolean;
      // The chapter id whose content was restored. Callers can compare this
      // to the currently-active chapter id (which may differ from the one
      // the restore was initiated on after an A→B→A round trip) to decide
      // whether to reload the editor.
      restoredChapterId?: string;
    }
  | { ok: false; error: ApiRequestError };

// Same discriminated-union shape as RestoreResult. The failure arm carries
// an ApiRequestError; the success arm preserves `superseded` verbatim —
// recent commits (8ae123b, a2d0f09, 894f0ac) depend on both discriminant
// values of ViewSupersededReason, so the success-arm shape is load-bearing.
export type ViewResult =
  | {
      ok: true;
      superseded?: ViewSupersededReason;
    }
  | { ok: false; error: ApiRequestError };

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
  // Monotonic epoch to discard stale list responses after a chapter switch.
  const chapterSeq = useAbortableSequence();
  // Per-request epoch for viewSnapshot: guards against rapid successive
  // View clicks on the SAME chapter (where chapterSeq doesn't bump)
  // resolving out of order — an older response would otherwise land after
  // a newer one and pin the wrong snapshot as the current view.
  const viewSeq = useAbortableSequence();
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
    chapterSeq.abort(); // invalidate the prior chapter's list response
    const token = chapterSeq.capture();
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
        if (!token.isStale()) setSnapshotCount(data.length);
      })
      .catch(() => {
        // Leave count as null so the badge stays hidden. The next panel
        // interaction will retry via refreshCount.
      });
  }, [chapterId, chapterSeq]);

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
      const cToken = chapterSeq.capture();
      // Per-request epoch for same-chapter rapid clicks: two View
      // clicks on the same chapter share the chapter epoch but need
      // their own ordering so the later request "wins" regardless of
      // network resolve order. start() bumps so any in-flight View
      // response from an older click is invalidated.
      const vToken = viewSeq.start();
      try {
        const full = await api.snapshots.get(snapshot.id);
        if (cToken.isStale()) return { ok: true, superseded: "chapter" };
        if (vToken.isStale()) return { ok: true, superseded: "sameChapterNewer" };
        // S11 (2026-04-23 review): defensive undefined guard. apiFetch
        // returns `undefined as T` for 204 No Content, and while the
        // snapshots GET route has never returned 204, a future handler
        // change could. Reading `full.content` in that case would throw
        // a TypeError, which the catch below would remap as NETWORK —
        // misleading. Treat an empty body as a corrupt-snapshot response.
        if (!full) {
          return { ok: false, error: makeCorruptViewError() };
        }
        // SnapshotRow.content is typed as a JSON string on the wire.
        // A parse failure, or a non-object payload (valid JSON like "42",
        // "null", or "[1,2,3]"), means the stored snapshot is not a TipTap
        // document and would crash the read-only preview editor. Mirror the
        // server-side restore path (which gates on TipTapDocSchema.safeParse)
        // by synthesizing a CORRUPT_SNAPSHOT ApiRequestError so the
        // snapshot.view scope's byCode entry maps it to the
        // "this snapshot is corrupt" copy.
        let content: unknown;
        try {
          content = JSON.parse(full.content);
        } catch {
          return { ok: false, error: makeCorruptViewError() };
        }
        if (content === null || typeof content !== "object" || Array.isArray(content)) {
          return { ok: false, error: makeCorruptViewError() };
        }
        setViewingSnapshot({
          id: snapshot.id,
          label: snapshot.label,
          content: content as Record<string, unknown>,
          created_at: snapshot.created_at,
        });
        return { ok: true };
      } catch (err) {
        // Mirror the success-path stale-epoch guards: a chapter switch (or a
        // newer View click on the same chapter) during the in-flight GET
        // should not surface the response's error on the now-active panel.
        // Without this, a 404 from the old chapter's snapshot lands as a
        // "snapshot no longer exists" banner attributed to the new chapter.
        if (cToken.isStale()) return { ok: true, superseded: "chapter" };
        if (vToken.isStale()) return { ok: true, superseded: "sameChapterNewer" };
        if (err instanceof ApiRequestError) {
          // S14 (2026-04-23 review): use mapApiError's `message === null`
          // signal as the canonical "silent bail" check, matching
          // useFindReplaceState's convention. ABORTED is not a user-
          // visible error — mirror the supersession path with
          // sameChapterNewer (abort is always same-chapter-triggered in
          // this hook; a chapter switch would have surfaced via
          // cToken.isStale() above). Routing through the mapper means
          // call sites don't need to know the specific "ABORTED" code
          // string — the contract lives in the mapper.
          if (mapApiError(err, "snapshot.view").message === null) {
            return { ok: true, superseded: "sameChapterNewer" };
          }
          // 2xx BAD_JSON on a GET has no "maybe committed" ambiguity —
          // GETs don't commit server-side state. Remap the synthetic code
          // to CORRUPT_SNAPSHOT so the snapshot.view scope routes it to the
          // "this snapshot is corrupt" copy rather than the network scope's
          // "check your connection" banner that invites a pointless retry.
          if (err.code === "BAD_JSON" && err.status >= 200 && err.status < 300) {
            return { ok: false, error: makeCorruptViewError() };
          }
          return { ok: false, error: err };
        }
        // Non-ApiRequestError (TypeError, rejectors that bypass apiFetch).
        // apiFetch wraps every real network failure in ApiRequestError, so a
        // bare throw here is a purely-client problem — synthesize a NETWORK
        // ApiRequestError so the caller sees the transient-retry copy from
        // the snapshot.view scope rather than silently dropping to the
        // generic fallback.
        return { ok: false, error: makeClientNetworkError() };
      }
    },
    [chapterSeq, viewSeq],
  );

  const exitSnapshotView = useCallback(() => {
    setViewingSnapshot(null);
  }, []);

  const restoreSnapshot = useCallback(
    async (snapshotId: string): Promise<RestoreResult> => {
      // Capture the epoch before the restore await. If the user switches
      // chapters during the restore, we must not apply the follow-up list
      // response to the new chapter's state (wrong count) and must not
      // reset viewingSnapshot for the new chapter.
      const token = chapterSeq.capture();
      const restoringChapterId = chapterId;
      try {
        await api.snapshots.restore(snapshotId);
        // A→B→A round-trip: epoch moved but the current chapter is once
        // again the one we restored. Treat that as a NOT-stale completion
        // — the caller should reload the editor because the restore
        // landed on what the user is viewing now.
        const seqMoved = token.isStale();
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
          // Capture the CURRENT epoch for the follow-up list, since the
          // original token is stale after an A→B→A round-trip. The list
          // still needs to be keyed to the current chapter epoch so a
          // later switch can discard it.
          const freshToken = chapterSeq.capture();
          api.snapshots
            .list(restoringChapterId)
            .then((data) => {
              if (!freshToken.isStale()) setSnapshotCount(data.length);
            })
            .catch(() => {});
        }
        return {
          ok: true,
          ...(restoringChapterId ? { restoredChapterId: restoringChapterId } : {}),
        };
      } catch (err) {
        if (err instanceof ApiRequestError) {
          // I7: ABORTED stays a silent no-op. mapApiError already returns
          // `message: null` for ABORTED, so forwarding the error is enough —
          // the caller reads MappedError.message and bails when it's null
          // without needing a dedicated discriminant.
          return { ok: false, error: err };
        }
        // I2 (2026-04-23): apiFetch wraps every real network/fetch error
        // in ApiRequestError, so any bare throw here is either a pre-send
        // client bug (vanishingly rare) or a post-success bookkeeping
        // throw (realistic: localStorage.removeItem can throw in Safari
        // private mode at line 299; setState on a torn-down boundary;
        // extension-proxied storage). For restore the conservative default
        // is post-success — the server likely committed the restore and
        // its auto-snapshot. Synthesize 200 BAD_JSON so mapApiError routes
        // through the possiblyCommitted arm → persistent lock banner, no
        // retry prompt. This matches the EditorPage handler's comment at
        // `handleRestoreSnapshot` ("hook synthesizes a 200 BAD_JSON
        // ApiRequestError for non-ApiRequestError post-success throws").
        return { ok: false, error: makeClientCommittedError() };
      }
    },
    [chapterId, chapterSeq],
  );

  const refreshCount = useCallback(() => {
    if (!chapterId) return;
    const token = chapterSeq.capture();
    api.snapshots
      .list(chapterId)
      .then((data) => {
        if (!token.isStale()) setSnapshotCount(data.length);
      })
      .catch(() => {});
  }, [chapterId, chapterSeq]);

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
