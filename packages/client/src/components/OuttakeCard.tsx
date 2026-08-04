import { useRef, useState } from "react";
import type { OuttakeRow } from "@smudge/shared";
import { toPlainText, countWords, truncateUnits, LABEL_MAX_UNITS } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError, applyMappedError, STOP } from "../errors";
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
  /**
   * S3: the server may have committed this card's write while the response was
   * unreadable (2xx BAD_JSON). Hands the panel the mapped ambiguity copy to
   * display and triggers an authoritative refetch of the list.
   */
  onPossiblyCommitted: (message: string) => void;
}

/** Normalize a label draft to the canonical `string | null` the API expects. */
function normalizeLabel(value: string): string | null {
  return value.trim() || null;
}

export function OuttakeCard({
  outtake,
  onInsert,
  onDeleted,
  onUpdated,
  onError,
  onPossiblyCommitted,
}: OuttakeCardProps) {
  const plainText = toPlainText(outtake.content);
  const [labelDraft, setLabelDraft] = useState(outtake.label ?? "");
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Tracks the last COMMITTED value so blur-after-Enter (and blur with no
  // change) does not fire a redundant rename. Advanced only on confirmed
  // success (see commitLabel) so a failed PATCH stays retryable.
  const lastCommittedRef = useRef<string | null>(outtake.label);

  // I3 (agentic-review 2026-08-04): these mutations carry NO AbortSignal, and
  // that is deliberate. They used to run on per-card useAbortableAsyncOperation
  // instances, whose unmount cleanup aborts — and this card unmounts on an
  // ORDINARY click, not on leaving the app: ReferencePanel renders
  // `{activeTab?.panel ?? null}` and the panel renders only while open, so the
  // Images tab or Ctrl+. takes every card down, and a filter keystroke takes one
  // card down mid-rename (`visible` matches the row's OLD label). The cancelled
  // write may already have committed, and the post-await `if (signal.aborted)
  // return` swallowed it in silence. That is the exact semantic the S4 latch
  // below and EditorPage's captureInFlightRef exist to refuse.
  //
  // Nothing is lost by dropping the ops: the two latches serialise this card's
  // own repeats, and a per-card op could never abort a sibling anyway. Post-await
  // state updates on an unmounted card are React no-ops; onUpdated/onDeleted
  // still reconcile a panel that outlived the card (the filter case).
  //
  // S4: a second confirm during an in-flight DELETE is an ordinary gesture —
  // onConfirm closes the dialog but the card stays until onDeleted. The latch
  // makes it a no-op instead of a duplicate request.
  const deleteInFlightRef = useRef(false);
  // The same for rename: blur-after-Enter and a stray blur can both land, and a
  // second PATCH racing the first has no defined winner.
  const updateInFlightRef = useRef(false);

  const isLong = plainText.length > PREVIEW_LIMIT;
  const shownText =
    isLong && !expanded ? truncateUnits(plainText, PREVIEW_LIMIT).trimEnd() + "…" : plainText;

  async function commitLabel() {
    // The raw field value at send time; used to detect whether the user kept
    // typing during the request so neither settle path clobbers newer edits.
    const attempted = labelDraft;
    const next = normalizeLabel(attempted);
    if (lastCommittedRef.current === next) {
      // S5: no PATCH fires, so normalize the FIELD too. Otherwise a
      // whitespace-only edit ("   " -> null on an untitled card) keeps
      // rendering a value that was never sent and is not on the server, and
      // the success path's re-seed below never runs to correct it.
      setLabelDraft(lastCommittedRef.current ?? "");
      return;
    }
    if (updateInFlightRef.current) return;
    updateInFlightRef.current = true;
    try {
      const row = await api.outtakes.updateLabel(outtake.id, { label: next });
      // Track the SERVER-committed value (server may sanitize) so an identical
      // retry is suppressed but a failed one stays retryable.
      lastCommittedRef.current = row.label;
      // S3: re-seed the field from the server-sanitized label so stripping is
      // visible — but only if the user hasn't typed since, so we don't discard
      // their in-flight edits (S5).
      setLabelDraft((current) => (current === attempted ? (row.label ?? "") : current));
      onUpdated(row);
    } catch (err) {
      const mapped = mapApiError(err, "outtake.update");
      applyMappedError(mapped, {
        // S3: on a 2xx BAD_JSON the server most likely committed the rename.
        // Do NOT revert — that would make the field assert the OLD label as
        // truth while the server holds the new one. Leave what the user typed
        // (the value the server probably has), ask the panel to refetch the
        // authoritative list, and surface the ambiguity. lastCommittedRef is
        // deliberately left un-advanced so a retry still fires.
        onCommitted: () => {
          if (mapped.message !== null) onPossiblyCommitted(mapped.message);
          return STOP;
        },
        onMessage: (message) => {
          // A definite failure: the server still holds the previous label, so
          // revert the visible field to it — but only if untouched since the
          // request, so newer keystrokes typed during the round-trip survive (S5).
          setLabelDraft((current) =>
            current === attempted ? (lastCommittedRef.current ?? "") : current,
          );
          onError(message);
        },
      });
    } finally {
      updateInFlightRef.current = false;
    }
  }

  async function handleDelete() {
    // S14: name the refusal. The dialog has closed and the card is still here,
    // so a silent no-op looks like the Confirm button did nothing.
    if (deleteInFlightRef.current) {
      onError(S.deleteInFlight);
      return;
    }
    deleteInFlightRef.current = true;
    try {
      await api.outtakes.delete(outtake.id);
      onDeleted(outtake.id);
    } catch (err) {
      const mapped = mapApiError(err, "outtake.delete");
      applyMappedError(mapped, {
        // S3: on a 2xx BAD_JSON the row is probably gone server-side; a refetch
        // reconciles the list so a retry can't 404 against a phantom card.
        onCommitted: () => {
          if (mapped.message !== null) onPossiblyCommitted(mapped.message);
          return STOP;
        },
        onMessage: onError,
      });
    } finally {
      deleteInFlightRef.current = false;
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
        // S5: the schema's cap, enforced where the writer can see it. Never
        // stricter than the server, which trims before measuring, so this
        // cannot reject a label the API would have accepted.
        maxLength={LABEL_MAX_UNITS}
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
