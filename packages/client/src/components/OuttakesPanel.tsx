import { useCallback, useEffect, useRef, useState } from "react";
import type { OuttakeRow } from "@smudge/shared";
import { toPlainText } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError, applyMappedError } from "../errors";
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
import { useAbortableSequence } from "../hooks/useAbortableSequence";
import { STRINGS } from "../strings";
import { OuttakeCard } from "./OuttakeCard";

const S = STRINGS.outtakes;

interface OuttakesPanelProps {
  projectId: string;
  onInsert: (outtake: OuttakeRow) => void;
  /**
   * The row EditorPage just captured via the toolbar. A new object identity is
   * prepended optimistically (I1) so surfacing the capture never depends on a
   * reload that a concurrent card delete/rename could stale. Null before the
   * first capture. This is now the ONLY producer of new outtakes: the drawer
   * holds text moved out of the manuscript, and composing fresh prose into it
   * is not a thing it does (design §3 decision 3).
   */
  capturedOuttake: OuttakeRow | null;
  /**
   * S1: bumped by EditorPage when a toolbar capture came back 2xx BAD_JSON —
   * the server most likely committed the row but there is no body to prepend,
   * so only an authoritative refetch can surface it. The write paths the panel
   * owns itself route this through `requestReload`; this is the same signal
   * reaching in from the one that lives outside it.
   */
  externalRefreshKey: number;
}

export function OuttakesPanel({
  projectId,
  onInsert,
  capturedOuttake,
  externalRefreshKey,
}: OuttakesPanelProps) {
  const [outtakes, setOuttakes] = useState<OuttakeRow[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  // S1 (agentic-review 2026-08-05): the list load gets its OWN slot, as
  // SnapshotPanel already does. Sharing `error` with the write channel meant a
  // concurrent load's success arm cleared a write failure the writer had not
  // read — and a card write never calls reconcile(), so it cannot stale the
  // in-flight load that erases it. Same reasoning as committedNotice below,
  // which was given separate state for exactly this hazard and stopped there.
  const [listError, setListError] = useState<string | null>(null);
  const [committedNotice, setCommittedNotice] = useState<string | null>(null);
  // S6 (agentic-review 2026-08-04): the empty state used to render for the FULL
  // duration of every load — there was no loading flag, and the projectId effect
  // empties the list before the new load even starts. A writer with fifty
  // outtakes was told "No outtakes yet. Stash cut text here to find it later."
  // and invited to stash a duplicate. Seeded true so the first paint, which
  // happens before the load effect runs, doesn't flash it either.
  const [loading, setLoading] = useState(true);

  // The LIST GET only. Unmount-abort is right for a read: nothing is lost by
  // discarding rows nobody is looking at, and the next mount refetches.
  //
  // I3 (agentic-review 2026-08-04): writes deliberately do NOT run on an op.
  // This panel unmounts on an ordinary click (ReferencePanel renders
  // `{activeTab?.panel ?? null}`, and the panel renders only while open), so
  // cancelling a possibly-committed write is worse than letting it land.
  // Per-row delete/rename mutations dropped their ops for that reason; see
  // OuttakeCard.
  const loadOp = useAbortableAsyncOperation();
  // Arbitrates reload-vs-mutation staleness (invariant 4). Reloads replace the
  // whole list, so a reload that started BEFORE an optimistic mutation landed
  // would resurrect a deleted row / revert a rename. Each mutation bumps the
  // epoch (seq.abort in the reconcilers), staling any in-flight reload's token.
  const seq = useAbortableSequence();

  // I3: the list GETs this panel has issued but not settled. seq.abort()
  // DISCARDS an outstanding load rather than reconciling it, which is right for
  // the rows a mutation just superseded but throws away everything else in the
  // same response — and the panel has no other refetch trigger, so those rows
  // stayed gone for the session. Counted (not a boolean) so overlapping loads
  // can't leave the flag stuck.
  const loadsInFlightRef = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const requestReload = useCallback(() => setReloadKey((k) => k + 1), []);

  // I3 (review 2026-07-26): drop everything project-scoped the instant the
  // project does. Kept separate from the load effect below because that one
  // also runs on every reloadKey bump, where clearing would throw away the
  // optimistic row a mutation just placed. Only the failure arm of a reload
  // actually needed this — the success arm replaces `outtakes` wholesale — but
  // the failure arm is exactly the one that used to leave project A's rows
  // rendered AND actionable under project B. `committedNotice` is deliberately
  // sticky (cleared only by reconcile), which is right within a project and
  // wrong across one: an ambiguity warning about A's server state says nothing
  // about B's.
  useEffect(() => {
    setOuttakes([]);
    setCommittedNotice(null);
    setError(null);
    setListError(null);
  }, [projectId]);

  // Load (on mount, projectId change, and an explicit reload request). ABORTED
  // is silent via the mapper; the per-call signal guards a late resolution after
  // unmount, and the sequence token discards a reload a mutation has superseded.
  useEffect(() => {
    const token = seq.start();
    loadsInFlightRef.current += 1;
    setLoading(true);
    const { promise, signal } = loadOp.run((s) => api.outtakes.list(projectId, s));
    promise
      .then((rows) => {
        if (signal.aborted || token.isStale()) return;
        setOuttakes(rows);
        setListError(null);
      })
      .catch((err: unknown) => {
        if (signal.aborted || token.isStale()) return;
        applyMappedError(mapApiError(err, "outtake.list"), { onMessage: setListError });
      })
      .finally(() => {
        loadsInFlightRef.current -= 1;
        // Overlapping loads: only the last one out clears the flag (S6), the
        // same reason loadsInFlightRef is a count rather than a boolean.
        if (loadsInFlightRef.current === 0) setLoading(false);
      });
  }, [projectId, reloadKey, externalRefreshKey, loadOp, seq]);

  // Shared prologue for every optimistic reconciliation: stale any in-flight
  // reload so it can't clobber the change, and — since staling discards rows we
  // still want — re-issue the load when one was actually outstanding (I3). In
  // the common case (no load in flight) this is just the epoch bump, so the
  // optimistic update stays the thing that surfaces the row.
  const reconcile = useCallback(() => {
    seq.abort();
    setCommittedNotice(null);
    if (loadsInFlightRef.current > 0) requestReload();
  }, [seq, requestReload]);

  // S3: a possibly-committed write is announced separately from `error` because
  // its own recovery refetch resolves moments later and clears `error`. Held
  // until the next confirmed mutation (see reconcile) so the user actually
  // reads "the server may or may not have this — check before retrying".
  const notePossiblyCommitted = useCallback(
    (message: string) => {
      setCommittedNotice(message);
      requestReload();
    },
    [requestReload],
  );

  // S6: one place where a server-confirmed row joins the list. Prepend
  // (newest-first) and dedup by id so a reload that already surfaced the
  // server's copy can't leave a duplicate React key.
  // I1 (agentic-review 2026-08-04): read the LIVE project, not the one this
  // callback closed over, so a row cannot be matched against a stale projectId.
  const projectIdRef = useRef(projectId);
  // Written during render on purpose, and the only place in components/ that
  // does it — the same live-prop mirror the hooks use (useFindReplaceController's
  // slugRef, useEditorMutation's projectEditorRef). The two readers need the live
  // value for DIFFERENT reasons, and both reasons are load-bearing:
  //
  //   * callbacksFor (below) — OuttakeCard's delete/rename carry no AbortSignal,
  //     so they genuinely settle after a project switch or unmount. The value has
  //     to be current the moment they look, not one effect-flush later.
  //   * applyServerRow (below) — does NOT run from an async settle; its only call
  //     site is the capture effect, which runs post-commit with that commit's
  //     props and no await in between. It needs the ref because its useCallback
  //     dep chain is LIFETIME-STABLE (reconcile ← seq/requestReload, all pinned),
  //     so its identity never changes and a closure over the `projectId` prop
  //     would freeze the FIRST render's project id forever. Adding `projectId` to
  //     its deps would be safe (surfacedCaptureIdRef makes the extra re-run a
  //     no-op) — but closing over the prop WITHOUT that dep would not be, and
  //     that is the mistake this ref forecloses.
  //
  // An effect-based mirror would make correctness depend on this effect being
  // DECLARED before the capture effect, which is a sharper edge than the write it
  // replaces.
  //
  // I1/S1 (agentic-review 2026-08-19): the rule started reporting when
  // `handleCreate`'s BODY was deleted, not when the blank-note form's `draftRef`
  // write was. Verified by piping main's file through `npx eslint --stdin`:
  // unmodified → 0 reports; `draftRef` write deleted only → still 0;
  // `handleCreate` deleted only → the rule fires on both ref writes. That
  // function was making eslint-plugin-react-hooks bail out of analysing the whole
  // component, so any hook violation added while it existed went unreported too.
  // eslint-disable-next-line react-hooks/refs -- live-prop mirror; see the two readers above
  projectIdRef.current = projectId;

  const applyServerRow = useCallback(
    (row: OuttakeRow) => {
      // I1 (review 2026-07-26): the row's OWN project is the authority on
      // whether it belongs here. The capture POST in `useOuttakeCapture` does
      // not re-check the project after its await, and this panel is not keyed
      // on project, so an A→B switch mid-POST delivers project A's row to a
      // panel showing B. The C1 ref seed only covers the MOUNT path; this
      // covers the prop-change path too, because every write to the list
      // funnels through here. A leaked row is not cosmetic: its Insert button
      // pastes A's private text into a B chapter, and its Delete HARD-deletes a
      // real project-A outtake (outtakes carry no deleted_at — CLAUDE.md
      // §Data Model).
      if (row.project_id !== projectIdRef.current) return;
      reconcile();
      setOuttakes((prev) => [row, ...prev.filter((o) => o.id !== row.id)]);
      setError(null);
    },
    [reconcile],
  );

  // C1: the id this panel has already surfaced, seeded at FIRST RENDER so mount
  // is a no-op. The capture POST always completes before the panel mounts (the
  // toolbar button lives outside the panel, and the panel unmounts whenever the
  // drawer closes or another tab is selected), so the mount load already
  // contains the row. Prepending on mount would seq.abort() the panel's only
  // load — the list would collapse to just the capture, hiding every stored
  // outtake until a page refresh, and leaking project A's row into project B.
  const surfacedCaptureIdRef = useRef<string | null>(capturedOuttake?.id ?? null);

  // I1: prepend a toolbar-captured row the moment EditorPage hands it down.
  // Fires only for a row this panel has not already surfaced.
  useEffect(() => {
    if (!capturedOuttake) return;
    if (surfacedCaptureIdRef.current === capturedOuttake.id) return;
    surfacedCaptureIdRef.current = capturedOuttake.id;
    applyServerRow(capturedOuttake);
  }, [capturedOuttake, applyServerRow]);

  // Reconcile the list by id after a card's own awaited server call succeeds.
  // No api/abort here — the card owns the request (and its per-row op); these
  // only touch local state.
  // I3: `message` is how the rename-404 arm says why a card is disappearing.
  // Taking it here makes the drop and the explanation ONE state transition —
  // the card used to call onError first and this function's setError(null) then
  // erased it in the same continuation.
  function handleDeleted(id: string, message?: string) {
    reconcile();
    setOuttakes((prev) => prev.filter((o) => o.id !== id));
    setError(message ?? null);
  }

  function handleUpdated(row: OuttakeRow) {
    reconcile();
    setOuttakes((prev) => prev.map((o) => (o.id === row.id ? row : o)));
    setError(null);
  }

  // I5 (agentic-review 2026-08-05): OuttakeCard's mutations deliberately carry
  // NO AbortSignal (an ordinary tab switch unmounts the card, and cancelling a
  // committed write is worse than letting it land), so a settle can arrive after
  // the writer has moved to another project. The list itself is id-keyed over
  // UUIDs and is emptied on projectId change, so no row aliases — but the two
  // BANNERS are shared, and they are what leaked: project A's "Couldn't rename
  // that outtake." painted B's panel with nothing left to clear it (the
  // projectId effect had already run, and the load-success arm only re-fires on
  // a mutation or reload), while A's reconcile wiped a legitimate B ambiguity
  // notice and A's onPossiblyCommitted fired a reload against B.
  //
  // One guard at the wiring point rather than five call-site guards inside the
  // card: the row's own project_id is the authority, exactly as applyServerRow
  // already uses it, and a new card callback cannot forget to opt in.
  function callbacksFor(row: OuttakeRow) {
    const isCurrent = () => row.project_id === projectIdRef.current;
    return {
      onDeleted: (id: string, message?: string) => {
        if (isCurrent()) handleDeleted(id, message);
      },
      onUpdated: (updated: OuttakeRow) => {
        if (isCurrent()) handleUpdated(updated);
      },
      onError: (message: string) => {
        if (isCurrent()) setError(message);
      },
      onPossiblyCommitted: (message: string) => {
        if (isCurrent()) notePossiblyCommitted(message);
      },
    };
  }

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? outtakes.filter((o) =>
        `${o.label ?? ""} ${toPlainText(o.content)}`.toLowerCase().includes(needle),
      )
    : outtakes;

  return (
    // Frame (border/background/overflow) and width are the owning <aside>'s —
    // re-declaring them here fought the user's panel resize (I2). Matches the
    // sibling tab, ImageGallery.
    <div className="flex flex-col h-full">
      <div className="border-b border-border/40 px-4 py-3 flex flex-col gap-2">
        <input
          type="text"
          aria-label={S.filterPlaceholder}
          placeholder={S.filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm border border-border/40 rounded px-2 py-1 bg-white text-text-primary placeholder:text-text-secondary/60 font-sans focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* UAT (2026-08-11): these three banners used to be the first children of
          the scrolling list below, which put every one of them off-screen the
          moment the writer acted on a card past the fold — and the list is
          deliberately unbounded (§5, design), so that is the ordinary state of a
          drawer in use. A card would then just vanish with its explanation
          printed somewhere the writer never looks, which is precisely the
          "drops without saying why" failure I3 closed. Pinned beside the filter
          instead: outside the scroll container, always on screen. */}
      {(committedNotice || error || listError) && (
        <div className="border-b border-border/40 px-4 py-2 flex flex-col gap-1">
          {committedNotice && (
            <p role="alert" className="text-xs text-red-700 font-sans">
              {committedNotice}
            </p>
          )}

          {error && (
            <p role="alert" className="text-xs text-red-700 font-sans">
              {error}
            </p>
          )}

          {listError && (
            <p role="alert" className="text-xs text-red-700 font-sans">
              {listError}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {outtakes.length === 0 && !listError && !loading && (
          <p className="text-sm text-text-secondary text-center py-6 font-sans">{S.empty}</p>
        )}

        {outtakes.length > 0 && visible.length === 0 && (
          <p className="text-sm text-text-secondary text-center py-6 font-sans">{S.noMatches}</p>
        )}

        {visible.length > 0 && (
          <ul className="flex flex-col gap-2">
            {visible.map((outtake) => (
              <OuttakeCard
                key={outtake.id}
                outtake={outtake}
                onInsert={onInsert}
                {...callbacksFor(outtake)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
