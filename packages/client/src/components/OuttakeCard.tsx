import { useRef, useState } from "react";
import type { OuttakeRow } from "@smudge/shared";
import { toPlainText, countWords } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError, applyMappedError } from "../errors";
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
import { STRINGS } from "../strings";
import { ConfirmDialog } from "./ConfirmDialog";

const S = STRINGS.outtakes;
const PREVIEW_LIMIT = 160;

interface OuttakeCardProps {
  outtake: OuttakeRow;
  onInsert: (outtake: OuttakeRow) => void;
  /** Reconcile the panel list after THIS card's own delete succeeds. */
  onDeleted: (id: string) => void;
  /** Reconcile the panel list after THIS card's own rename succeeds. */
  onUpdated: (row: OuttakeRow) => void;
  /** Surface a failure on the panel's shared error banner. */
  onError: (message: string) => void;
}

/** Normalize a label draft to the canonical `string | null` the API expects. */
function normalizeLabel(value: string): string | null {
  return value.trim() || null;
}

export function OuttakeCard({ outtake, onInsert, onDeleted, onUpdated, onError }: OuttakeCardProps) {
  const plainText = toPlainText(outtake.content);
  const [labelDraft, setLabelDraft] = useState(outtake.label ?? "");
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Tracks the last COMMITTED value so blur-after-Enter (and blur with no
  // change) does not fire a redundant rename. Advanced only on confirmed
  // success (see commitLabel) so a failed PATCH stays retryable.
  const lastCommittedRef = useRef<string | null>(outtake.label);

  // Per-card ops: a delete/rename on ANOTHER card runs on that card's own op
  // instance, so it can never abort this card's in-flight request. A single
  // shared per-type op would (run() aborts the prior controller) — the
  // same-type sibling-abort lost-update. Both auto-abort when this card
  // unmounts (e.g. after its own delete removes it from the list).
  const deleteOp = useAbortableAsyncOperation();
  const updateOp = useAbortableAsyncOperation();

  const isLong = plainText.length > PREVIEW_LIMIT;
  const shownText =
    isLong && !expanded ? plainText.slice(0, PREVIEW_LIMIT).trimEnd() + "…" : plainText;

  async function commitLabel() {
    const next = normalizeLabel(labelDraft);
    if (lastCommittedRef.current === next) return;
    const { promise, signal } = updateOp.run((s) =>
      api.outtakes.updateLabel(outtake.id, { label: next }, s),
    );
    try {
      const row = await promise;
      if (signal.aborted) return;
      // Advance the committed ref ONLY on success — otherwise a failed rename
      // would block the identical retry on a later blur.
      lastCommittedRef.current = next;
      onUpdated(row);
    } catch (err) {
      if (signal.aborted) return;
      // The server still holds the previous label; revert the visible field to
      // it so the card cannot show a value that never persisted.
      setLabelDraft(lastCommittedRef.current ?? "");
      applyMappedError(mapApiError(err, "outtake.update"), { onMessage: onError });
    }
  }

  async function handleDelete() {
    const { promise, signal } = deleteOp.run((s) => api.outtakes.delete(outtake.id, s));
    try {
      await promise;
      if (signal.aborted) return;
      onDeleted(outtake.id);
    } catch (err) {
      if (signal.aborted) return;
      applyMappedError(mapApiError(err, "outtake.delete"), { onMessage: onError });
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plainText);
    } catch {
      // Clipboard access can be denied; nothing to recover, and surfacing a
      // banner for a best-effort copy is more noise than it's worth.
    }
  }

  return (
    <li className="border border-border/30 rounded p-3 flex flex-col gap-2">
      <input
        type="text"
        aria-label={S.labelAriaLabel}
        placeholder={S.untitled}
        value={labelDraft}
        onChange={(e) => setLabelDraft(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // Blur commits via onBlur; committing here too would double-fire
            // the rename now that commitLabel resolves asynchronously.
            e.currentTarget.blur();
          }
        }}
        className="text-sm font-medium text-text-primary font-sans border border-transparent hover:border-border/40 focus:border-accent rounded px-1 py-0.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <p className="text-sm text-text-secondary font-serif whitespace-pre-wrap break-words">
        {shownText}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-xs text-accent hover:text-accent/80 transition-colors font-sans"
        >
          {expanded ? S.showLess : S.showMore}
        </button>
      )}

      <div className="flex items-center gap-2 text-xs text-text-secondary font-sans">
        <span>{S.created(outtake.created_at)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{S.wordCount(countWords(outtake.content))}</span>
      </div>

      <div className="flex gap-3 text-xs font-sans">
        <button
          type="button"
          onClick={() => onInsert(outtake)}
          className="font-medium text-accent hover:text-accent/80 transition-colors"
        >
          {S.insert}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          {S.copy}
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="text-text-secondary hover:text-red-700 transition-colors"
        >
          {S.delete}
        </button>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title={S.confirmDeleteTitle}
          body={S.confirmDeleteBody}
          confirmLabel={STRINGS.delete.confirmButton}
          cancelLabel={STRINGS.delete.cancelButton}
          onConfirm={() => {
            setConfirmingDelete(false);
            void handleDelete();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </li>
  );
}
