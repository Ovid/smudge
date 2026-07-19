import { useRef, useState } from "react";
import type { OuttakeRow } from "@smudge/shared";
import { toPlainText, countWords } from "@smudge/shared";
import { STRINGS } from "../strings";
import { ConfirmDialog } from "./ConfirmDialog";

const S = STRINGS.outtakes;
const PREVIEW_LIMIT = 160;

interface OuttakeCardProps {
  outtake: OuttakeRow;
  onInsert: (outtake: OuttakeRow) => void;
  onDelete: (id: string) => void;
  onUpdateLabel: (id: string, label: string | null) => void;
}

/** Normalize a label draft to the canonical `string | null` the API expects. */
function normalizeLabel(value: string): string | null {
  return value.trim() || null;
}

export function OuttakeCard({ outtake, onInsert, onDelete, onUpdateLabel }: OuttakeCardProps) {
  const plainText = toPlainText(outtake.content);
  const [labelDraft, setLabelDraft] = useState(outtake.label ?? "");
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Tracks the last committed value so blur-after-Enter (and blur with no
  // change) does not fire a redundant onUpdateLabel.
  const lastCommittedRef = useRef<string | null>(outtake.label);

  const isLong = plainText.length > PREVIEW_LIMIT;
  const shownText =
    isLong && !expanded ? plainText.slice(0, PREVIEW_LIMIT).trimEnd() + "…" : plainText;

  function commitLabel() {
    const next = normalizeLabel(labelDraft);
    if (lastCommittedRef.current === next) return;
    lastCommittedRef.current = next;
    onUpdateLabel(outtake.id, next);
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
            commitLabel();
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
            onDelete(outtake.id);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </li>
  );
}
