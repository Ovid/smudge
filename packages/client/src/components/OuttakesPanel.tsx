import { useEffect, useState } from "react";
import type { OuttakeRow } from "@smudge/shared";
import { toPlainText } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError, applyMappedError } from "../errors";
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
import { STRINGS } from "../strings";
import { OuttakeCard } from "./OuttakeCard";

const S = STRINGS.outtakes;

interface OuttakesPanelProps {
  projectId: string;
  onInsert: (outtake: OuttakeRow) => void;
  /** EditorPage bumps this after a toolbar capture; a change re-runs the load. */
  refreshNonce: number;
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

export function OuttakesPanel({ projectId, onInsert, refreshNonce }: OuttakesPanelProps) {
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

  // Load (and reload on projectId / refreshNonce change). A bumped
  // refreshNonce is how a toolbar capture makes a new outtake appear without
  // this panel owning capture logic. ABORTED is silent via the mapper, and
  // the per-call signal guards a late resolution after unmount / reload.
  useEffect(() => {
    const { promise, signal } = loadOp.run((s) => api.outtakes.list(projectId, s));
    promise
      .then((rows) => {
        if (signal.aborted) return;
        setOuttakes(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        applyMappedError(mapApiError(err, "outtake.list"), { onMessage: setError });
      });
  }, [projectId, refreshNonce, loadOp]);

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
      setOuttakes((prev) => [row, ...prev]);
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
    setOuttakes((prev) => prev.filter((o) => o.id !== id));
    setError(null);
  }

  function handleUpdated(row: OuttakeRow) {
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
