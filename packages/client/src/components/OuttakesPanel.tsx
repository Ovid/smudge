import { useCallback, useEffect, useRef, useState } from "react";
import type { OuttakeRow } from "@smudge/shared";
import { toPlainText } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError, applyMappedError, STOP } from "../errors";
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
   * prepended optimistically (I1) — mirroring handleCreate — so surfacing the
   * capture never depends on a reload that a concurrent card delete/rename
   * could stale. Null before the first capture.
   */
  capturedOuttake: OuttakeRow | null;
  /**
   * S1: bumped by EditorPage when a toolbar capture came back 2xx BAD_JSON —
   * the server most likely committed the row but there is no body to prepend,
   * so only an authoritative refetch can surface it. The three write paths the
   * panel owns itself route this through `requestReload`; this is the same
   * signal reaching in from the one that lives outside it.
   */
  externalRefreshKey: number;
}

/** Wrap a textarea's plain string into a TipTap doc, one paragraph per line. */
function textToDoc(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: text
      .split("\n")
      .map((line) =>
        line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      ),
  };
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
  const [committedNotice, setCommittedNotice] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

  // I2: read the LIVE draft from inside handleCreate's post-await tail, whose
  // closure captured the value as of the click. Mirrors the projectRef pattern
  // used across the hooks.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const loadOp = useAbortableAsyncOperation();
  // Create owns its op here (blank-note flow). Per-row delete/rename ops live in
  // OuttakeCard so a mutation on one row cannot abort another's in-flight
  // request; the card calls back into the reconcilers below on success.
  const createOp = useAbortableAsyncOperation();
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
  }, [projectId]);

  // Load (on mount, projectId change, and an explicit reload request). ABORTED
  // is silent via the mapper; the per-call signal guards a late resolution after
  // unmount, and the sequence token discards a reload a mutation has superseded.
  useEffect(() => {
    const token = seq.start();
    loadsInFlightRef.current += 1;
    const { promise, signal } = loadOp.run((s) => api.outtakes.list(projectId, s));
    promise
      .then((rows) => {
        if (signal.aborted || token.isStale()) return;
        setOuttakes(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (signal.aborted || token.isStale()) return;
        applyMappedError(mapApiError(err, "outtake.list"), { onMessage: setError });
      })
      .finally(() => {
        loadsInFlightRef.current -= 1;
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

  // S6: one place where a server-confirmed row joins the list, shared by the
  // blank-note create and the toolbar capture. Prepend (newest-first) and dedup
  // by id so a reload that already surfaced the server's copy can't leave a
  // duplicate React key.
  // I1 (agentic-review 2026-08-04): read the LIVE project, not the one this
  // callback closed over. `applyServerRow` is a useCallback keyed on projectId,
  // but handleCreate is a plain function body — its running invocation pins the
  // click-time callback, so the guard below compared A's row against A's
  // captured projectId, passed, and prepended into what was by then B's list.
  // Same ref discipline as draftRef above and the projectRef pattern in the
  // hooks. Returns whether the row was accepted (S2).
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const applyServerRow = useCallback(
    (row: OuttakeRow): boolean => {
      // I1 (review 2026-07-26): the row's OWN project is the authority on
      // whether it belongs here. Neither producer re-checks the project after
      // its await — the capture POST lives in EditorPage and the blank-note
      // POST in handleCreate below — and this panel is not keyed on project, so
      // an A→B switch mid-POST delivers project A's row to a panel showing B.
      // The C1 ref seed only covers the MOUNT path; this covers the prop-change
      // path and the create path too, because every write to the list funnels
      // through here. A leaked row is not cosmetic: its Insert button pastes A's
      // private text into a B chapter, and its Delete HARD-deletes a real
      // project-A outtake (outtakes carry no deleted_at — CLAUDE.md §Data Model).
      if (row.project_id !== projectIdRef.current) return false;
      reconcile();
      setOuttakes((prev) => [row, ...prev.filter((o) => o.id !== row.id)]);
      setError(null);
      return true;
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

  // I1: prepend a toolbar-captured row the moment EditorPage hands it down,
  // exactly as handleCreate does for the blank-note flow. Fires only for a row
  // this panel has not already surfaced.
  useEffect(() => {
    if (!capturedOuttake) return;
    if (surfacedCaptureIdRef.current === capturedOuttake.id) return;
    surfacedCaptureIdRef.current = capturedOuttake.id;
    applyServerRow(capturedOuttake);
  }, [capturedOuttake, applyServerRow]);

  async function handleCreate() {
    if (!draft.trim()) {
      setShowNew(false);
      setDraft("");
      return;
    }
    // I2 (review 2026-07-26): the text we are actually sending. Cancel carries
    // no disabled={creating} — only Save does — so the writer can close the form
    // and start a second note while this POST is still out. Clearing
    // unconditionally on success then erased text the server never saw, with no
    // banner and no undo. Same current === attempted discipline as
    // OuttakeCard.commitLabel; see the S3 note below for why this panel treats
    // the writer's text as the thing it exists to protect.
    const attempted = draft;
    setCreating(true);
    const { promise, signal } = createOp.run((s) =>
      api.outtakes.create(projectId, { content: textToDoc(attempted), label: null }, s),
    );
    try {
      const row = await promise;
      if (signal.aborted) return;
      // S2: the ordinary refusal here is a project switch mid-POST — the row
      // committed, but in the project the writer just left. Tearing the form
      // down would close it, show no card and say nothing, losing the text from
      // the one panel whose job is not losing it. Keep it on screen and name
      // where it went, so the writer can decide rather than retype.
      if (!applyServerRow(row)) {
        setCommittedNotice(S.createdElsewhere);
        return;
      }
      // Only tear down the form when it still holds the text we sent.
      if (draftRef.current === attempted) {
        setDraft("");
        setShowNew(false);
      }
    } catch (err) {
      if (signal.aborted) return;
      const mapped = mapApiError(err, "outtake.create");
      applyMappedError(mapped, {
        onMessage: setError,
        // S3: a 2xx BAD_JSON means the server likely committed the outtake but
        // the response body was unreadable. Refetch so the row (if it landed)
        // appears, and hold the ambiguity notice. Unlike SnapshotPanel we do
        // NOT clear the draft: there the draft is a label, here it is the
        // writer's text, and discarding content the server may never have
        // received is the one failure this panel exists to prevent. A manual
        // retry can mint a duplicate — the accepted trade-off for image upload
        // (F-8), and the row is now visible right below the form.
        onCommitted: () => {
          if (mapped.message !== null) notePossiblyCommitted(mapped.message);
          return STOP;
        },
      });
    } finally {
      if (!signal.aborted) setCreating(false);
    }
  }

  // Reconcile the list by id after a card's own awaited server call succeeds.
  // No api/abort here — the card owns the request (and its per-row op); these
  // only touch local state.
  function handleDeleted(id: string) {
    reconcile();
    setOuttakes((prev) => prev.filter((o) => o.id !== id));
    setError(null);
  }

  function handleUpdated(row: OuttakeRow) {
    reconcile();
    setOuttakes((prev) => prev.map((o) => (o.id === row.id ? row : o)));
    setError(null);
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
        {!showNew ? (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="w-full text-sm font-medium text-accent border border-accent/40 rounded px-3 py-1.5 hover:bg-accent/10 transition-colors font-sans"
          >
            {S.newBlank}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              aria-label={S.newPlaceholder}
              placeholder={S.newPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="text-sm border border-border/40 rounded px-2 py-1 bg-white text-text-primary placeholder:text-text-secondary/60 font-serif focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="text-sm font-medium text-white bg-accent rounded px-3 py-1 hover:bg-accent/90 transition-colors font-sans disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {S.save}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNew(false);
                  setDraft("");
                }}
                className="text-sm text-text-secondary hover:text-text-primary transition-colors font-sans"
              >
                {S.cancel}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
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

        {outtakes.length === 0 && !error && (
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
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
                onError={setError}
                onPossiblyCommitted={notePossiblyCommitted}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
