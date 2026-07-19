import { useEffect, useState } from "react";
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

  // Load (and reload on projectId change). ABORTED is silent via the mapper;
  // the per-call signal guards a late resolution after unmount, and the
  // sequence token discards a reload a mutation has superseded.
  useEffect(() => {
    const token = seq.start();
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
      });
  }, [projectId, loadOp, seq]);

  // I1: prepend a toolbar-captured row the moment EditorPage hands it down,
  // exactly as handleCreate does for the blank-note flow. Bump the epoch so an
  // in-flight reload can't clobber the prepend, and dedup by id so a reload
  // that already surfaced the server's copy can't leave a duplicate key. Fires
  // only on a NEW row identity (null on mount / before the first capture).
  useEffect(() => {
    if (!capturedOuttake) return;
    seq.abort();
    setOuttakes((prev) => [capturedOuttake, ...prev.filter((o) => o.id !== capturedOuttake.id)]);
    setError(null);
  }, [capturedOuttake, seq]);

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
      // Bump the epoch so an in-flight reload can't clobber this prepend, and
      // dedup by id so a reload that already surfaced the server's copy can't
      // leave a duplicate React key.
      seq.abort();
      setOuttakes((prev) => [row, ...prev.filter((o) => o.id !== row.id)]);
      setDraft("");
      setShowNew(false);
      setError(null);
    } catch (err) {
      if (signal.aborted) return;
      applyMappedError(mapApiError(err, "outtake.create"), { onMessage: setError });
    } finally {
      if (!signal.aborted) setCreating(false);
    }
  }

  // Reconcile the list by id after a card's own awaited server call succeeds.
  // No api/abort here — the card owns the request (and its per-row op); these
  // only touch local state.
  function handleDeleted(id: string) {
    seq.abort();
    setOuttakes((prev) => prev.filter((o) => o.id !== id));
    setError(null);
  }

  function handleUpdated(row: OuttakeRow) {
    seq.abort();
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
    <div className="border-l border-border/60 bg-bg-sidebar flex flex-col h-full overflow-hidden w-80 min-w-80">
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
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
