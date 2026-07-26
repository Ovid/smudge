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

export function OuttakesPanel({ projectId, onInsert, capturedOuttake }: OuttakesPanelProps) {
  const [outtakes, setOuttakes] = useState<OuttakeRow[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [committedNotice, setCommittedNotice] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

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
  }, [projectId, reloadKey, loadOp, seq]);

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
  const applyServerRow = useCallback(
    (row: OuttakeRow) => {
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
    setCreating(true);
    const { promise, signal } = createOp.run((s) =>
      api.outtakes.create(projectId, { content: textToDoc(draft), label: null }, s),
    );
    try {
      const row = await promise;
      if (signal.aborted) return;
      applyServerRow(row);
      setDraft("");
      setShowNew(false);
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
